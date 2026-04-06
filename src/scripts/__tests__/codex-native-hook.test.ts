import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { buildManagedCodexHooksConfig } from "../../config/codex-hooks.js";
import {
  dispatchCodexNativeHook,
  mapCodexHookEventToOmxEvent,
  resolveSessionOwnerPidFromAncestry,
} from "../codex-native-hook.js";

describe("codex native hook config", () => {
  it("builds the expected managed hooks.json shape", () => {
    const config = buildManagedCodexHooksConfig("/tmp/omx");
    assert.deepEqual(Object.keys(config.hooks), [
      "SessionStart",
      "PreToolUse",
      "PostToolUse",
      "UserPromptSubmit",
      "Stop",
    ]);

    const preToolUse = config.hooks.PreToolUse[0] as {
      matcher?: string;
      hooks?: Array<Record<string, unknown>>;
    };
    assert.equal(preToolUse.matcher, "Bash");
    assert.match(
      String(preToolUse.hooks?.[0]?.command || ""),
      /codex-native-hook\.js"?$/,
    );

    const stop = config.hooks.Stop[0] as {
      hooks?: Array<Record<string, unknown>>;
    };
    assert.equal(stop.hooks?.[0]?.timeout, 30);
  });
});

describe("codex native hook dispatch", () => {
  it("maps Codex events onto OMX logical surfaces", () => {
    assert.equal(mapCodexHookEventToOmxEvent("SessionStart"), "session-start");
    assert.equal(mapCodexHookEventToOmxEvent("UserPromptSubmit"), "keyword-detector");
    assert.equal(mapCodexHookEventToOmxEvent("PreToolUse"), "pre-tool-use");
    assert.equal(mapCodexHookEventToOmxEvent("PostToolUse"), "post-tool-use");
    assert.equal(mapCodexHookEventToOmxEvent("Stop"), "stop");
  });

  it("writes SessionStart state against the long-lived session owner pid", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "omx-native-hook-session-start-"));
    try {
      const result = await dispatchCodexNativeHook(
        {
          hook_event_name: "SessionStart",
          cwd,
          session_id: "sess-start-1",
        },
        {
          cwd,
          sessionOwnerPid: 43210,
        },
      );

      assert.equal(result.omxEventName, "session-start");
      const sessionState = JSON.parse(
        await readFile(join(cwd, ".omx", "state", "session.json"), "utf-8"),
      ) as { session_id?: string; pid?: number };
      assert.equal(sessionState.session_id, "sess-start-1");
      assert.equal(sessionState.pid, 43210);
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("resolves the Codex owner from ancestry without mistaking codex-native-hook wrappers for Codex", () => {
    const commands = new Map<number, string>([
      [2100, 'sh -c node "/repo/dist/scripts/codex-native-hook.js"'],
      [1100, 'node /usr/local/bin/codex.js'],
      [900, 'bash'],
    ]);
    const parents = new Map<number, number | null>([
      [2100, 1100],
      [1100, 900],
      [900, 1],
    ]);

    const resolved = resolveSessionOwnerPidFromAncestry(2100, {
      readParentPid: (pid) => parents.get(pid) ?? null,
      readProcessCommand: (pid) => commands.get(pid) ?? "",
    });

    assert.equal(resolved, 1100);
  });

  it("records keyword activation from UserPromptSubmit payloads", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "omx-native-hook-"));
    try {
      await mkdir(join(cwd, ".omx", "state"), { recursive: true });
      const result = await dispatchCodexNativeHook(
        {
          hook_event_name: "UserPromptSubmit",
          cwd,
          session_id: "sess-1",
          thread_id: "thread-1",
          turn_id: "turn-1",
          prompt: "$ralplan implement issue #1307",
        },
        { cwd },
      );

      assert.equal(result.omxEventName, "keyword-detector");
      assert.equal(result.skillState?.skill, "ralplan");
      assert.ok(result.outputJson, "UserPromptSubmit should emit developer context");

      const statePath = join(cwd, ".omx", "state", "skill-active-state.json");
      assert.equal(existsSync(statePath), true);
      const state = JSON.parse(await readFile(statePath, "utf-8")) as {
        skill?: string;
        active?: boolean;
      };
      assert.equal(state.skill, "ralplan");
      assert.equal(state.active, true);
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("returns Stop continuation output while Ralph is active", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "omx-native-hook-stop-"));
    try {
      const stateDir = join(cwd, ".omx", "state");
      await mkdir(stateDir, { recursive: true });
      await writeFile(
        join(stateDir, "ralph-state.json"),
        JSON.stringify({
          active: true,
          current_phase: "executing",
        }),
      );

      const result = await dispatchCodexNativeHook(
        {
          hook_event_name: "Stop",
          cwd,
          session_id: "sess-stop",
        },
        { cwd },
      );

      assert.equal(result.omxEventName, "stop");
      assert.deepEqual(result.outputJson, {
        decision: "block",
        reason:
          "OMX Ralph is still active (phase: executing); continue the task and gather fresh verification evidence before stopping.",
        stopReason: "ralph_executing",
        systemMessage:
          "OMX Ralph is still active (phase: executing); continue the task and gather fresh verification evidence before stopping.",
      });
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("returns Stop continuation output for native auto-nudge stall prompts", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "omx-native-hook-auto-nudge-"));
    try {
      const stateDir = join(cwd, ".omx", "state");
      await mkdir(stateDir, { recursive: true });

      const result = await dispatchCodexNativeHook(
        {
          hook_event_name: "Stop",
          cwd,
          session_id: "sess-stop-auto",
          last_assistant_message: "Would you like me to keep going and finish the cleanup?",
        },
        { cwd },
      );

      assert.equal(result.omxEventName, "stop");
      assert.deepEqual(result.outputJson, {
        decision: "block",
        reason: "yes, proceed",
        stopReason: "auto_nudge",
        systemMessage:
          "OMX native Stop detected a stall/permission-style handoff and continued the turn automatically.",
      });
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("does not auto-nudge again when Stop already continued once", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "omx-native-hook-auto-nudge-once-"));
    try {
      const stateDir = join(cwd, ".omx", "state");
      await mkdir(stateDir, { recursive: true });

      const result = await dispatchCodexNativeHook(
        {
          hook_event_name: "Stop",
          cwd,
          session_id: "sess-stop-auto-once",
          stop_hook_active: true,
          last_assistant_message: "Would you like me to continue?",
        },
        { cwd },
      );

      assert.equal(result.omxEventName, "stop");
      assert.equal(result.outputJson, null);
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });
});

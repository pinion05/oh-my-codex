import { execFileSync } from "child_process";
import { existsSync, readFileSync } from "fs";
import { mkdir, readFile, readdir } from "fs/promises";
import { join } from "path";
import {
  detectPrimaryKeyword,
  recordSkillActivation,
  type SkillActiveState,
} from "../hooks/keyword-detector.js";
import {
  detectStallPattern,
  isDeepInterviewStateActive,
  loadAutoNudgeConfig,
} from "./notify-hook/auto-nudge.js";
import {
  buildNativeHookEvent,
} from "../hooks/extensibility/events.js";
import type { HookEventEnvelope } from "../hooks/extensibility/types.js";
import { dispatchHookEvent } from "../hooks/extensibility/dispatcher.js";
import { writeSessionStart } from "../hooks/session.js";

type CodexHookEventName =
  | "SessionStart"
  | "PreToolUse"
  | "PostToolUse"
  | "UserPromptSubmit"
  | "Stop";

type CodexHookPayload = Record<string, unknown>;

interface NativeHookDispatchOptions {
  cwd?: string;
  sessionOwnerPid?: number;
}

export interface NativeHookDispatchResult {
  hookEventName: CodexHookEventName | null;
  omxEventName: string | null;
  skillState: SkillActiveState | null;
  outputJson: Record<string, unknown> | null;
}

const TERMINAL_RALPH_PHASES = new Set(["complete", "failed", "cancelled"]);

function safeString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function safeObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

function safePositiveInteger(value: unknown): number | null {
  if (typeof value === "number" && Number.isInteger(value) && value > 0) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number.parseInt(value.trim(), 10);
    if (Number.isInteger(parsed) && parsed > 0) return parsed;
  }
  return null;
}

function readHookEventName(payload: CodexHookPayload): CodexHookEventName | null {
  const raw = safeString(
    payload.hook_event_name
    ?? payload.hookEventName
    ?? payload.event
    ?? payload.name,
  ).trim();
  if (
    raw === "SessionStart"
    || raw === "PreToolUse"
    || raw === "PostToolUse"
    || raw === "UserPromptSubmit"
    || raw === "Stop"
  ) {
    return raw;
  }
  return null;
}

export function mapCodexHookEventToOmxEvent(
  hookEventName: CodexHookEventName | null,
): string | null {
  switch (hookEventName) {
    case "SessionStart":
      return "session-start";
    case "PreToolUse":
      return "pre-tool-use";
    case "PostToolUse":
      return "post-tool-use";
    case "UserPromptSubmit":
      return "keyword-detector";
    case "Stop":
      return "stop";
    default:
      return null;
  }
}

function readPromptText(payload: CodexHookPayload): string {
  const candidates = [
    payload.prompt,
    payload.input,
    payload.user_prompt,
    payload.userPrompt,
    payload.text,
  ];
  for (const candidate of candidates) {
    const value = safeString(candidate).trim();
    if (value) return value;
  }
  return "";
}

function buildBaseContext(
  cwd: string,
  payload: CodexHookPayload,
  hookEventName: CodexHookEventName,
): Record<string, unknown> {
  return {
    cwd,
    project_path: cwd,
    transcript_path: safeString(payload.transcript_path ?? payload.transcriptPath) || null,
    source: safeString(payload.source),
    payload,
    ...(hookEventName === "UserPromptSubmit"
      ? { prompt: readPromptText(payload) }
      : {}),
  };
}

async function readJsonIfExists(path: string): Promise<Record<string, unknown> | null> {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(await readFile(path, "utf-8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}

async function readActiveRalphState(stateDir: string): Promise<Record<string, unknown> | null> {
  const direct = await readJsonIfExists(join(stateDir, "ralph-state.json"));
  if (direct?.active === true && !TERMINAL_RALPH_PHASES.has(safeString(direct.current_phase).trim().toLowerCase())) {
    return direct;
  }

  const sessionInfo = await readJsonIfExists(join(stateDir, "session.json"));
  const currentOmxSessionId = safeString(sessionInfo?.session_id).trim();
  if (!currentOmxSessionId) return null;

  const sessionScoped = await readJsonIfExists(
    join(stateDir, "sessions", currentOmxSessionId, "ralph-state.json"),
  );
  if (
    sessionScoped?.active === true
    && !TERMINAL_RALPH_PHASES.has(
      safeString(sessionScoped.current_phase).trim().toLowerCase(),
    )
  ) {
    return sessionScoped;
  }

  const sessionsRoot = join(stateDir, "sessions");
  if (!existsSync(sessionsRoot)) return null;
  const entries = await readdir(sessionsRoot, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const candidate = await readJsonIfExists(join(sessionsRoot, entry.name, "ralph-state.json"));
    if (
      candidate?.active === true
      && !TERMINAL_RALPH_PHASES.has(
        safeString(candidate.current_phase).trim().toLowerCase(),
      )
    ) {
      return candidate;
    }
  }

  return null;
}

function readParentPid(pid: number): number | null {
  try {
    if (process.platform === "linux") {
      const stat = readFileSync(`/proc/${pid}/stat`, "utf-8");
      const commandEnd = stat.lastIndexOf(")");
      if (commandEnd === -1) return null;
      const remainder = stat.slice(commandEnd + 1).trim();
      const fields = remainder.split(/\s+/);
      const ppid = Number(fields[1]);
      return Number.isFinite(ppid) && ppid > 0 ? ppid : null;
    }

    const raw = execFileSync("ps", ["-o", "ppid=", "-p", String(pid)], {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    const ppid = Number.parseInt(raw, 10);
    return Number.isFinite(ppid) && ppid > 0 ? ppid : null;
  } catch {
    return null;
  }
}

function readProcessCommand(pid: number): string {
  try {
    if (process.platform === "linux") {
      return readFileSync(`/proc/${pid}/cmdline`, "utf-8")
        .replace(/\u0000+/g, " ")
        .trim();
    }

    return execFileSync("ps", ["-o", "command=", "-p", String(pid)], {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "";
  }
}

function looksLikeShellCommand(command: string): boolean {
  return /(^|[\/\s])(bash|zsh|sh|dash|fish|ksh)(\s|$)/i.test(command);
}

function looksLikeCodexCommand(command: string): boolean {
  if (/codex-native-hook(?:\.js)?/i.test(command)) return false;
  return /\bcodex(?:\.js)?\b/i.test(command);
}

export function resolveSessionOwnerPidFromAncestry(
  startPid: number,
  options: {
    readParentPid?: (pid: number) => number | null;
    readProcessCommand?: (pid: number) => string;
  } = {},
): number | null {
  const readParent = options.readParentPid ?? readParentPid;
  const readCommand = options.readProcessCommand ?? readProcessCommand;
  const lineage: Array<{ pid: number; command: string }> = [];
  let currentPid = startPid;

  for (let i = 0; i < 6 && Number.isInteger(currentPid) && currentPid > 1; i += 1) {
    const command = readCommand(currentPid);
    lineage.push({ pid: currentPid, command });
    const nextPid = readParent(currentPid);
    if (!nextPid || nextPid === currentPid) break;
    currentPid = nextPid;
  }

  const codexAncestor = lineage.find((entry) => looksLikeCodexCommand(entry.command));
  if (codexAncestor) return codexAncestor.pid;

  if (lineage.length >= 2 && looksLikeShellCommand(lineage[0]?.command || "")) {
    return lineage[1].pid;
  }

  if (lineage.length >= 1) return lineage[0].pid;
  return null;
}

function resolveSessionOwnerPid(payload: CodexHookPayload): number {
  const explicitPid = [
    payload.session_pid,
    payload.sessionPid,
    payload.codex_pid,
    payload.codexPid,
    payload.parent_pid,
    payload.parentPid,
  ]
    .map(safePositiveInteger)
    .find((value): value is number => value !== null);
  if (explicitPid) return explicitPid;

  const resolved = resolveSessionOwnerPidFromAncestry(process.ppid);
  if (resolved) return resolved;
  return process.pid;
}

function buildAdditionalContextMessage(payload: CodexHookPayload): string | null {
  const prompt = readPromptText(payload);
  if (!prompt) return null;
  const match = detectPrimaryKeyword(prompt);
  if (!match) return null;

  return `OMX native UserPromptSubmit detected workflow keyword "${match.keyword}" -> ${match.skill}. Follow AGENTS.md routing and preserve ralplan/ralph execution gates.`;
}

async function buildStopHookOutput(
  payload: CodexHookPayload,
  cwd: string,
  stateDir: string,
): Promise<Record<string, unknown> | null> {
  const ralphState = await readActiveRalphState(stateDir);
  if (!ralphState) {
    const stopHookActive = payload.stop_hook_active === true || payload.stopHookActive === true;
    const deepInterviewActive = await isDeepInterviewStateActive(stateDir);
    const lastAssistantMessage = safeString(
      payload.last_assistant_message ?? payload.lastAssistantMessage,
    );
    const autoNudgeConfig = await loadAutoNudgeConfig();

    if (
      !stopHookActive
      && !deepInterviewActive
      && autoNudgeConfig.enabled
      && detectStallPattern(lastAssistantMessage, autoNudgeConfig.patterns)
    ) {
      return {
        decision: "block",
        reason: autoNudgeConfig.response,
        stopReason: "auto_nudge",
        systemMessage:
          "OMX native Stop detected a stall/permission-style handoff and continued the turn automatically.",
      };
    }

    return null;
  }

  const currentPhase = safeString(ralphState?.current_phase).trim() || "executing";
  const stopReason = `ralph_${currentPhase}`;
  const systemMessage =
    `OMX Ralph is still active (phase: ${currentPhase}); continue the task and gather fresh verification evidence before stopping.`;

  return {
    decision: "block",
    reason: systemMessage,
    stopReason,
    systemMessage,
  };
}

export async function dispatchCodexNativeHook(
  payload: CodexHookPayload,
  options: NativeHookDispatchOptions = {},
): Promise<NativeHookDispatchResult> {
  const hookEventName = readHookEventName(payload);
  const cwd = options.cwd ?? (safeString(payload.cwd).trim() || process.cwd());
  const stateDir = join(cwd, ".omx", "state");
  await mkdir(stateDir, { recursive: true });

  const omxEventName = mapCodexHookEventToOmxEvent(hookEventName);
  let skillState: SkillActiveState | null = null;

  const sessionId = safeString(payload.session_id ?? payload.sessionId).trim();
  const threadId = safeString(payload.thread_id ?? payload.threadId).trim();
  const turnId = safeString(payload.turn_id ?? payload.turnId).trim();

  if (hookEventName === "SessionStart" && sessionId) {
    await writeSessionStart(cwd, sessionId, {
      pid: options.sessionOwnerPid ?? resolveSessionOwnerPid(payload),
    });
  }

  if (hookEventName === "UserPromptSubmit") {
    const prompt = readPromptText(payload);
    if (prompt) {
      skillState = await recordSkillActivation({
        stateDir,
        text: prompt,
        sessionId,
        threadId,
        turnId,
      });
    }
  }

  if (omxEventName) {
    const event: HookEventEnvelope = buildNativeHookEvent(
      omxEventName,
      buildBaseContext(cwd, payload, hookEventName!),
      {
        session_id: sessionId || undefined,
        thread_id: threadId || undefined,
        turn_id: turnId || undefined,
        mode: safeString(payload.mode).trim() || undefined,
      },
    );
    await dispatchHookEvent(event, { cwd });
  }

  let outputJson: Record<string, unknown> | null = null;
  if (hookEventName === "SessionStart" || hookEventName === "UserPromptSubmit") {
    const additionalContext = buildAdditionalContextMessage(payload);
    if (additionalContext) {
      outputJson = {
        hookSpecificOutput: {
          hookEventName,
          additionalContext,
        },
      };
    }
  } else if (hookEventName === "Stop") {
    outputJson = await buildStopHookOutput(payload, cwd, stateDir);
  }

  return {
    hookEventName,
    omxEventName,
    skillState,
    outputJson,
  };
}

async function readStdinJson(): Promise<CodexHookPayload> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  }
  const raw = Buffer.concat(chunks).toString("utf-8").trim();
  return raw ? safeObject(JSON.parse(raw)) : {};
}

export async function runCodexNativeHookCli(): Promise<void> {
  const payload = await readStdinJson();
  const result = await dispatchCodexNativeHook(payload);
  if (result.outputJson) {
    process.stdout.write(`${JSON.stringify(result.outputJson)}\n`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runCodexNativeHookCli().catch((error) => {
    process.stderr.write(
      `[omx] codex-native-hook failed: ${
        error instanceof Error ? error.message : String(error)
      }\n`,
    );
    process.exitCode = 1;
  });
}

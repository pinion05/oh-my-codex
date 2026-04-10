import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  approveOmxDaemonItem,
  getOmxDaemonStatus,
  rejectOmxDaemonItem,
  resolveGitHubToken,
  runOmxDaemonOnce,
  scaffoldOmxDaemonFiles,
  startOmxDaemon,
  stopOmxDaemon,
} from "../index.js";

const originalFetch = globalThis.fetch;
const originalGhToken = process.env.GH_TOKEN;
const originalGithubToken = process.env.GITHUB_TOKEN;

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (typeof originalGhToken === "string") process.env.GH_TOKEN = originalGhToken; else delete process.env.GH_TOKEN;
  if (typeof originalGithubToken === "string") process.env.GITHUB_TOKEN = originalGithubToken; else delete process.env.GITHUB_TOKEN;
});

describe("omx daemon runtime", () => {
  it("scaffolds tracked governance inputs", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "omx-daemon-scaffold-"));
    try {
      const changed = await scaffoldOmxDaemonFiles(cwd);
      assert.ok(changed.includes(".omx/daemon/ISSUE_GATE.md"));
      assert.ok(changed.includes(".omx/daemon/daemon.config.json"));
      assert.ok(changed.includes(".gitignore"));
      assert.equal(existsSync(join(cwd, ".omx", "daemon", "RULES.md")), true);
      const gitignore = await readFile(join(cwd, ".gitignore"), "utf-8");
      assert.match(gitignore, /^\.omx\/\*$/m);
      assert.match(gitignore, /^!\.omx\/daemon\/$/m);
      assert.match(gitignore, /^!\.omx\/daemon\/daemon\.config\.json$/m);
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("repairs legacy .gitignore entries during daemon scaffold", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "omx-daemon-scaffold-"));
    try {
      await writeFile(join(cwd, ".gitignore"), ".omx/\nnode_modules/\n");
      const changed = await scaffoldOmxDaemonFiles(cwd);
      assert.ok(changed.includes(".gitignore"));
      const gitignore = await readFile(join(cwd, ".gitignore"), "utf-8");
      assert.doesNotMatch(gitignore, /^\.omx\/$/m);
      assert.match(gitignore, /^node_modules\/$/m);
      assert.match(gitignore, /^!\.omx\/daemon\/$/m);
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("resolves GitHub credentials in the documented order", () => {
    const result = resolveGitHubToken(
      { githubCredentialSource: "config-token-ref", githubTokenEnvVar: "CUSTOM_DAEMON_TOKEN" },
      { CUSTOM_DAEMON_TOKEN: "config-token", GH_TOKEN: "gh-token", GITHUB_TOKEN: "github-token" },
      (() => ({ status: 1, stdout: "", stderr: "" })) as never,
    );
    assert.equal(result.token, "config-token");
    assert.equal(result.source, "config-token-ref");
  });

  it("queues proposals from GitHub issues and publishes approved wiki docs", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "omx-daemon-runonce-"));
    try {
      await scaffoldOmxDaemonFiles(cwd);
      await writeFile(
        join(cwd, ".omx", "daemon", "daemon.config.json"),
        JSON.stringify({
          repository: "octo/example",
          githubCredentialSource: "env",
          githubTokenEnvVar: "GH_TOKEN",
          pollIntervalMs: 10000,
          maxIssuesPerRun: 5,
          knowledgeSink: "docs/project-wiki",
          applyGitHubLabelsOnApprove: true,
        }, null, 2),
      );
      process.env.GH_TOKEN = "token-from-env";
      globalThis.fetch = (async (input: string | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.includes("/issues?")) {
          return new Response(JSON.stringify([
            {
              number: 42,
              title: "Security regression in daemon flow",
              html_url: "https://github.com/octo/example/issues/42",
              body: "Regression needs urgent follow-up.",
              updated_at: "2026-04-09T12:00:00Z",
              labels: [{ name: "bug" }],
              comments: 6,
            },
          ]), { status: 200, headers: { "Content-Type": "application/json" } });
        }
        if (url.includes("/issues/42") && init?.method === "PATCH") {
          return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "Content-Type": "application/json" } });
        }
        throw new Error(`unexpected fetch ${url}`);
      }) as typeof fetch;

      const runResult = await runOmxDaemonOnce(cwd);
      assert.equal(runResult.success, true);
      assert.equal(runResult.queue?.length, 1);
      const item = runResult.queue?.[0];
      assert.ok(item);
      assert.deepEqual(item.transitions.map((entry) => entry.state), ["proposed", "queued"]);
      assert.equal(existsSync(join(cwd, ".omx", "state", "daemon", "outbox", `issue-${item?.id}.md`)), true);

      const approveResult = await approveOmxDaemonItem(cwd, item!.id);
      assert.equal(approveResult.success, true);
      assert.equal(existsSync(join(cwd, "docs", "project-wiki", "issue-42.md")), true);
      const published = await readFile(join(cwd, "docs", "project-wiki", "issue-42.md"), "utf-8");
      assert.match(published, /Approved at:/);
      const approvedItem = approveResult.queue?.find((entry) => entry.id === item?.id);
      assert.ok(approvedItem);
      assert.deepEqual(approvedItem.transitions.map((entry) => entry.state), ["proposed", "queued", "approved", "published"]);
      const log = await readFile(join(cwd, ".omx", "state", "daemon", "daemon.log"), "utf-8");
      assert.match(log, /Applied approved GitHub labels to issue #42/i);
      assert.match(log, /Published approved queue item/i);
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("surfaces actionable insufficient-permission status after a 403 poll failure", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "omx-daemon-perms-"));
    try {
      await scaffoldOmxDaemonFiles(cwd);
      await writeFile(
        join(cwd, ".omx", "daemon", "daemon.config.json"),
        JSON.stringify({
          repository: "octo/example",
          githubCredentialSource: "env",
          githubTokenEnvVar: "GH_TOKEN",
        }, null, 2),
      );
      process.env.GH_TOKEN = "token-from-env";
      globalThis.fetch = (async () => new Response("Resource not accessible by integration", { status: 403 })) as typeof fetch;

      const runResult = await runOmxDaemonOnce(cwd);
      assert.equal(runResult.success, false);
      assert.equal(runResult.state?.statusReason, "insufficient-permissions");
      assert.match(runResult.message, /permissions are insufficient/i);
      assert.match(runResult.error ?? "", /issue-read permission/i);

      const status = getOmxDaemonStatus(cwd);
      assert.equal(status.success, true);
      assert.equal(status.state?.statusReason, "insufficient-permissions");
      assert.match(status.message, /permissions are insufficient/i);
      assert.match(status.message, /issue-read permission/i);
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("reports actionable status before setup", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "omx-daemon-status-"));
    try {
      const status = getOmxDaemonStatus(cwd);
      assert.equal(status.success, true);
      assert.match(status.message, /not initialized/i);
      assert.match(status.message, /\$setup-omx-daemon/i);
      assert.equal(status.state?.statusReason, "not-initialized");
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("reports actionable stopped and missing-credential statuses after scaffold", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "omx-daemon-status-"));
    const originalPath = process.env.PATH;
    try {
      await scaffoldOmxDaemonFiles(cwd);
      await writeFile(
        join(cwd, ".omx", "daemon", "daemon.config.json"),
        JSON.stringify({
          repository: "octo/example",
          githubCredentialSource: "config-token-ref",
          githubTokenEnvVar: "OMX_DAEMON_TEST_TOKEN",
        }, null, 2),
      );

      delete process.env.GH_TOKEN;
      delete process.env.GITHUB_TOKEN;
      delete process.env.OMX_DAEMON_TEST_TOKEN;
      process.env.PATH = "";

      const missingCredentials = getOmxDaemonStatus(cwd);
      assert.equal(missingCredentials.success, true);
      assert.equal(missingCredentials.state?.statusReason, "missing-credentials");
      assert.match(missingCredentials.message, /GitHub credentials are missing/i);
      assert.match(missingCredentials.message, /GITHUB_TOKEN/i);
      assert.match(missingCredentials.message, /gh auth token/i);

      process.env.PATH = originalPath;
      process.env.OMX_DAEMON_TEST_TOKEN = "token-from-env";
      const stopped = getOmxDaemonStatus(cwd);
      assert.equal(stopped.success, true);
      assert.equal(stopped.state?.statusReason, "stopped");
      assert.match(stopped.message, /Daemon is stopped/i);
      assert.match(stopped.message, /omx daemon start/i);
      assert.match(stopped.message, /omx daemon run-once/i);
    } finally {
      if (typeof originalPath === "string") process.env.PATH = originalPath; else delete process.env.PATH;
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("reports missing-repository before start and status when repository cannot be resolved", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "omx-daemon-status-"));
    try {
      await scaffoldOmxDaemonFiles(cwd);
      process.env.GH_TOKEN = "token-from-env";
      const start = startOmxDaemon(cwd);
      assert.equal(start.success, false);
      assert.equal(start.state?.statusReason, "missing-repository");
      assert.match(start.message, /cannot start daemon without a resolvable github repository/i);

      const status = getOmxDaemonStatus(cwd);
      assert.equal(status.success, true);
      assert.equal(status.state?.statusReason, "missing-repository");
      assert.match(status.message, /repository is not resolvable/i);
      assert.match(status.message, /set git remote origin/i);
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("includes last triage activity and rejected counts in status output", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "omx-daemon-status-"));
    try {
      await scaffoldOmxDaemonFiles(cwd);
      await writeFile(
        join(cwd, ".omx", "daemon", "daemon.config.json"),
        JSON.stringify({
          repository: "octo/example",
          githubCredentialSource: "env",
          githubTokenEnvVar: "GH_TOKEN",
          maxIssuesPerRun: 5,
        }, null, 2),
      );
      process.env.GH_TOKEN = "token-from-env";
      globalThis.fetch = (async (input: string | URL) => {
        const url = String(input);
        if (url.includes("/issues?")) {
          return new Response(JSON.stringify([
            {
              number: 7,
              title: "Bug in setup flow",
              html_url: "https://github.com/octo/example/issues/7",
              body: "needs review",
              updated_at: "2026-04-09T12:00:00Z",
              labels: [],
              comments: 0,
            },
          ]), { status: 200, headers: { "Content-Type": "application/json" } });
        }
        throw new Error(`unexpected fetch ${url}`);
      }) as typeof fetch;

      const runOnce = await runOmxDaemonOnce(cwd);
      assert.equal(runOnce.success, true);
      const item = runOnce.queue?.[0];
      assert.ok(item);
      const rejected = rejectOmxDaemonItem(cwd, item!.id);
      assert.equal(rejected.success, true);

      const status = getOmxDaemonStatus(cwd);
      assert.match(status.message, /rejected=1/);
      assert.match(status.message, /last triage=/i);
      assert.match(status.message, /last poll=/i);
      assert.match(status.message, /last issue scan=/i);
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("keeps approvals resumable when local publish or configured GitHub mutation cannot finish", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "omx-daemon-approve-"));
    try {
      await scaffoldOmxDaemonFiles(cwd);
      await writeFile(
        join(cwd, ".omx", "daemon", "daemon.config.json"),
        JSON.stringify({
          repository: "octo/example",
          githubCredentialSource: "env",
          githubTokenEnvVar: "GH_TOKEN",
          maxIssuesPerRun: 5,
          applyGitHubLabelsOnApprove: true,
        }, null, 2),
      );
      process.env.GH_TOKEN = "token-from-env";
      globalThis.fetch = (async (input: string | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.includes("/issues?")) {
          return new Response(JSON.stringify([
            {
              number: 8,
              title: "Approval retry case",
              html_url: "https://github.com/octo/example/issues/8",
              body: "needs review",
              updated_at: "2026-04-09T12:00:00Z",
              labels: [],
              comments: 0,
            },
          ]), { status: 200, headers: { "Content-Type": "application/json" } });
        }
        if (url.includes("/issues/8") && init?.method === "PATCH") {
          return new Response("forbidden", { status: 403 });
        }
        throw new Error(`unexpected fetch ${url}`);
      }) as typeof fetch;

      const runOnce = await runOmxDaemonOnce(cwd);
      const item = runOnce.queue?.[0];
      assert.ok(item);
      const approval = await approveOmxDaemonItem(cwd, item!.id);
      assert.equal(approval.success, false);
      const retained = approval.queue?.find((entry) => entry.id === item!.id);
      assert.equal(retained?.status, "approved");
      assert.equal(retained?.githubLabelMutationApplied, undefined);
      assert.match(approval.message, /permissions are insufficient/i);
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("treats duplicate reject attempts as idempotent success", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "omx-daemon-reject-"));
    try {
      await scaffoldOmxDaemonFiles(cwd);
      await writeFile(
        join(cwd, ".omx", "daemon", "daemon.config.json"),
        JSON.stringify({
          repository: "octo/example",
          githubCredentialSource: "env",
          githubTokenEnvVar: "GH_TOKEN",
          maxIssuesPerRun: 5,
        }, null, 2),
      );
      process.env.GH_TOKEN = "token-from-env";
      globalThis.fetch = (async (input: string | URL) => {
        const url = String(input);
        if (url.includes("/issues?")) {
          return new Response(JSON.stringify([
            {
              number: 9,
              title: "Duplicate reject",
              html_url: "https://github.com/octo/example/issues/9",
              body: "needs review",
              updated_at: "2026-04-09T12:00:00Z",
              labels: [],
              comments: 0,
            },
          ]), { status: 200, headers: { "Content-Type": "application/json" } });
        }
        throw new Error(`unexpected fetch ${url}`);
      }) as typeof fetch;

      const runOnce = await runOmxDaemonOnce(cwd);
      const item = runOnce.queue?.[0];
      assert.ok(item);
      const first = rejectOmxDaemonItem(cwd, item!.id);
      const second = rejectOmxDaemonItem(cwd, item!.id);
      assert.equal(first.success, true);
      assert.equal(second.success, true);
      assert.match(second.message, /already rejected/i);
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("reports running status when the daemon loop is active", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "omx-daemon-status-"));
    try {
      await scaffoldOmxDaemonFiles(cwd);
      await writeFile(
        join(cwd, ".omx", "daemon", "daemon.config.json"),
        JSON.stringify({
          repository: "octo/example",
          githubCredentialSource: "env",
          githubTokenEnvVar: "GH_TOKEN",
        }, null, 2),
      );
      process.env.GH_TOKEN = "token-from-env";

      const start = startOmxDaemon(cwd);
      assert.equal(start.success, true, start.error ?? start.message);

      const running = getOmxDaemonStatus(cwd);
      assert.equal(running.success, true);
      assert.equal(running.state?.statusReason, "running");
      assert.match(running.message, /Daemon is running/i);
    } finally {
      stopOmxDaemon(cwd);
      await rm(cwd, { recursive: true, force: true });
    }
  });
});

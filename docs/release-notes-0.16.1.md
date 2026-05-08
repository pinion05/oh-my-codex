# Release notes — 0.16.1

## Summary

`0.16.1` is a patch release after `0.16.0` focused on hardening the post-release `dev` train: bounded `omx explore` execution, safer local explore fast-path reads, clean CI dependency-install proof, session-scoped runtime authority, approved Team handoff repair paths, context-pack status visibility, deep-interview flow clarity, and launch/runtime reliability fixes.

This release is prepared from `v0.16.0..HEAD` with `dev` as the source branch. The final local release-prep diff also includes the code-review blocker fixes for explore symlink/large-file handling, CI dependency install integrity, `0.16.1` metadata, and release collateral.

## Highlights

- **Explore safety hardening** — `omx explore` now bounds Codex-backed process storms and output, rejects symlinked explicit local file reads in the fast path, and avoids reading oversized files during local text search.
- **CI release proof restored** — Node jobs keep using the npm cache but run `npm ci` unconditionally, so CI proves the lockfile installs cleanly instead of trusting a restored `node_modules` tree.
- **Session-scoped runtime authority** — runtime state now treats session-scoped ownership as the active authority, with fixes for stale skill-active/HUD state and project-scoped Codex goal durability.
- **Approved Team handoff repair** — approved Team execution preserves bindings, selected handoffs, invalid diagnostics, nonready repair-only behavior, DAG fallback status, and read-only context-pack status reporting.
- **Launch/runtime reliability** — Darwin path-stable worktree launch assertions, Windows OMX root paths, current JS runtime helpers, plugin skill cache refresh, MCP sibling cleanup, and visual Ralph/imagegen recovery were tightened.
- **Deep-interview and CI polish** — interview flow now separates facts from judgment, native hook background output is quieter, launch-policy help is clearer, and CI latency contracts were adjusted.

## Compatibility / migration

- `omx explore` local fast-path file reads no longer follow symlinks; symlinked paths fall back to the harness instead of being read directly.
- Local text-search fast-path skips oversized files and lets the bounded harness path handle broader searches.
- CI jobs no longer cache `node_modules`; this may trade a small install-time cost for stronger release/install verification.

## Verification

Release verification evidence is recorded in `docs/qa/release-readiness-0.16.1.md`. Local gates passed for the reviewed fixes; publication is represented by the `dev` to `main` merge and `v0.16.1` tag.

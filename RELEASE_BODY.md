# oh-my-codex v0.16.1

## Summary

`0.16.1` is a patch release after `0.16.0` focused on reliability and release-safety hardening across `omx explore`, CI dependency proof, session-scoped runtime authority, approved Team handoffs, context-pack status, deep-interview flow, and launch/runtime edge cases.

## Highlights

- **Explore safety hardening** — Codex-backed explore runs are bounded against process storms and output growth; the local fast path now rejects symlinked explicit file reads and avoids unbounded oversized text-search reads.
- **CI install proof restored** — Node CI jobs run `npm ci` every time while keeping npm package caching, so release gates prove lockfile install integrity.
- **Approved Team handoff repairs** — selected handoffs, invalid context-pack diagnostics, nonready repair-only behavior, binding transport, and DAG fallback status remain aligned through follow-up execution.
- **Runtime state durability** — session-scoped runtime authority, project-scoped Codex goal state, stale skill-active/HUD cleanup, and MCP sibling cleanup are more reliable.
- **Launch and UX hardening** — Darwin worktree launch assertions, Windows OMX root paths, current JS runtime helpers, plugin skill cache refresh, visual Ralph recovery, quieter native hooks, clearer launch-policy help, and deep-interview fact/judgment separation are included.

## Merged PRs / notable commits

- #2178 — Keep Darwin worktree launch assertions path-stable
- #2172 — Keep Team DAG fallbacks aligned with handoff status
- #2171 — Close remaining approved handoff fallback gaps
- #2170 — Preserve invalid context-pack role diagnostics
- #2169 — Keep nonready approved handoffs repair-only
- #2168 — Add UI design anti-slop signals
- #2159 — Improve deep-interview flow by separating facts from judgment
- #2158 — Enhance CI latency contract
- #2157 — Fix Windows OMX root launch paths
- #2155 — Quiet native hook background output
- #2154 — Clarify launch-policy help
- #2153 — Use current JS runtime for managed OMX helpers
- #2152 — Fix plugin skill cache refresh
- #2151 — Keep Codex goal state durable in project-scoped OMX sessions
- #2146 / #2120 — Bound explore process storms and execution before semantic fallback
- #2144 — Fix MCP pre-traffic app-server sibling leaks
- #2141 — Make session-scoped runtime state the active authority
- #2135 — Preserve Visual Ralph recovery across imagegen interrupts
- #2134 — Keep disposable launch worktree state durable

## Upgrade notes

- `omx explore` local fast-path file reads no longer follow symlinks. Symlinked file prompts fall back to the harness path.
- Local explore text search skips oversized files in the fast path; use the harness path for broader/large-file investigation.
- CI no longer restores/skips a cached `node_modules` tree; expect `npm ci` to run in each Node job.

## Verification

Release verification evidence is tracked in `docs/qa/release-readiness-0.16.1.md`.

## Contributors

Thanks to @Yeachan-Heo and contributors for the post-`0.16.0` hardening train.

**Full Changelog**: [`v0.16.0...v0.16.1`](https://github.com/Yeachan-Heo/oh-my-codex/compare/v0.16.0...v0.16.1)

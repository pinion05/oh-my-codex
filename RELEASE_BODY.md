# oh-my-codex v0.17.1

`0.17.1` is a patch release after `0.17.0` focused on release readiness and runtime coordination hardening: Team + Ultragoal handoff guidance, structured question bridge events, setup MCP removal confirmation, Team startup readiness, HUD/tmux ownership fixes, native session overlay preservation, and audit-clean release metadata.

## Highlights

- **Team + Ultragoal coordination is explicit** — Ultragoal remains leader-owned durable goal/ledger state while Team runs parallel execution lanes and returns checkpoint-ready evidence.
- **Question bridge events are auditable** — structured question bridge events support bounded Hermes/MCP coordination around pending and answered question state.
- **Setup MCP defaults are safer** — setup-managed MCP removal requires explicit confirmation, and doctor output now handles plugin-mode `none` state correctly.
- **Release train is audit-clean** — package/Cargo metadata are aligned to `0.17.1`, and vulnerable transitive npm packages were updated in the lockfile.

## Fixes and compatibility notes

- **Approved execution contract migration** — approved repository context replaces the older context-pack approved-execution handoff; approved PRD/test-spec artifacts and Team evidence are now the handoff source of truth.
- **Team runtime reliability** — workers avoid redundant MCP startup, idle Ultragoal plans do not trigger accidental startup, and draft-only Team startup fails after ready timeout.
- **HUD/tmux stability** — resize handling enforces HUD pane height and avoids hook ownership collisions across windows.
- **Native session overlays** — generated user AGENTS guidance is preserved while generated project boilerplate is omitted from session instructions.
- **Ralph and Lore guardrails** — Ralph examples require completion-audit evidence, and the Lore guard accepts compact compliant commits with the required OmX co-author trailer.

## Validation

Local pre-tag gates passed: `npm run lint`, `npm run check:no-unused`, `cargo check --workspace`, `npm audit --audit-level=high`, `git diff --check`, and `git diff --cached --check`.

The complete `npm test` suite was not claimed as a clean local gate in this attached OMX/tmux runtime because prior attempts showed ambient runtime contamination and leaked question-test child processes. The tag workflow remains the authoritative clean CI/publication gate.

## Contributors

Thanks to the contributors who made this release possible.

**Full Changelog**: [`v0.17.0...v0.17.1`](https://github.com/Yeachan-Heo/oh-my-codex/compare/v0.17.0...v0.17.1)

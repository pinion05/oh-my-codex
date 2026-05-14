# Release readiness: 0.17.2

## Scope

Hotfix for `omx question` leader-pane resume injection after structured question / Hermes coordination integration.

## Compare range

- Previous tag: `v0.17.1`
- Candidate tag: `v0.17.2`
- Candidate branch: hotfix branch targeting `dev`

Note: local `dev` and `main` release commits should be reconciled before final tagging if `git merge-base --is-ancestor v0.17.1 dev` is not true.

## PR inventory

- PR #2330 — restore safe return-pane resume injection for `omx question` structured answer paths.

## Local gates

- PASS — `npm run build`
- PASS — `env -u OMX_STATE_ROOT -u OMX_ROOT -u OMX_SESSION_ID -u CODEX_SESSION_ID -u SESSION_ID node --test dist/question/__tests__/state.test.js dist/question/__tests__/ui.test.js dist/mcp/__tests__/hermes-bridge.test.js dist/question/__tests__/renderer.test.js`
- PASS — `npm run check:no-unused`
- PASS — `npx biome lint src/question src/mcp/hermes-bridge.ts`

## CI / publication evidence

- Pending until PR merge, `dev` CI, `main` promotion, tag workflow, GitHub release, and npm publication complete.

## Known gaps

- Full `npm test` was not rerun locally after the targeted hotfix; targeted changed-surface tests and type/lint gates passed.
- Final release publication requires CI evidence per `RELEASE_PROTOCOL.md`.

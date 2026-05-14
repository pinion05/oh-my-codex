# oh-my-codex 0.17.2

`0.17.2` is a hotfix release after `0.17.1` that restores `omx question` leader-pane resume behavior for structured question answers, including Hermes/MCP answer submission.

## Highlights

- **Structured answers resume the leader pane again** — answered question records with persisted renderer `return_target` metadata now send the bounded `[omx question answered]` notice through the existing safe tmux-send-keys path.
- **Hermes bridge stays bounded** — Hermes submits structured answers to question records and OMX uses record-authorized return metadata when present; coordinators do not gain arbitrary terminal stdin control.

## Fixes / compatibility

- Local tmux question UI answers and Hermes/MCP structured submissions share the same answer-side resume behavior.
- Invalid or missing return targets are skipped safely while answer state still persists.
- Regression tests cover the state/UI/Hermes answer paths.

## Validation

- `npm run build`
- `env -u OMX_STATE_ROOT -u OMX_ROOT -u OMX_SESSION_ID -u CODEX_SESSION_ID -u SESSION_ID node --test dist/question/__tests__/state.test.js dist/question/__tests__/ui.test.js dist/mcp/__tests__/hermes-bridge.test.js dist/question/__tests__/renderer.test.js`
- `npm run check:no-unused`
- `npx biome lint src/question src/mcp/hermes-bridge.ts`

## Contributors

Thanks to everyone who tested the `omx question` / Hermes coordination path and reported the regression.

**Full Changelog**: https://github.com/Yeachan-Heo/oh-my-codex/compare/v0.17.1...v0.17.2

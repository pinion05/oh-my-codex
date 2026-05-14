# oh-my-codex 0.17.3

`0.17.3` is a hotfix release after `0.17.2` that restores default `omx team` launch for Codex CLI-first/plugin configs while preserving the worker MCP isolation introduced in `0.17.1`.

## Highlights

- **Default Team launch works again** — Codex team workers no longer synthesize `mcp_servers.<omx>` tables that are absent from `CODEX_HOME/config.toml`, avoiding Codex's `invalid transport` startup failure.
- **Worker MCP isolation is preserved where valid** — legacy configs that explicitly declare first-party OMX MCP servers still get those servers disabled for Codex Team workers by default.
- **Release-train hardening included** — AGENTS contract overwrite protection and plugin/question metadata alignment from the `dev` compare range are included in this patch.

## Fixes / compatibility

- `OMX_TEAM_WORKER_MCP_COMPAT=1|true|on|compat` remains the explicit compatibility opt-in that suppresses worker MCP disable overrides.
- CLI-first/plugin Codex configs without first-party OMX MCP tables now reach Team worker readiness normally.
- Team readiness was not loosened; failed workers still fail instead of being reported as started.

## Validation

- `npm run build`
- `node --test dist/team/__tests__/tmux-session.test.js`
- `npm run check:no-unused`
- Default live Team smoke with bounded startup timeouts
- Compatibility live Team smoke with `OMX_TEAM_WORKER_MCP_COMPAT=1`

## Contributors

Thanks to everyone who tested the Team runtime after the `0.17.1` worker MCP isolation change and narrowed the regression to the default Codex worker launch path.

**Full Changelog**: https://github.com/Yeachan-Heo/oh-my-codex/compare/v0.17.2...v0.17.3

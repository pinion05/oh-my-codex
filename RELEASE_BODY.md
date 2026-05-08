# oh-my-codex v0.16.2

`0.16.2` is a release-review patch for the `0.16.1` train. It fixes a Codex native-hook setup blocker found before shipping.

## Fixed

- Restored generated setup config to the official Codex lifecycle-hook flag: `[features].codex_hooks = true`.
- Repaired stale/unreleased `[features].hooks = true` aliases back to `codex_hooks` during setup.
- Added plugin-mode `hooks.state` trust records for setup-owned `codex-native-hook.js` wrappers while preserving user hooks and user-owned hook state.
- Updated setup docs and plugin-skill mirrors to consistently document `codex_hooks`.

## Validation

Local release gates passed: build, no-unused typecheck, targeted setup/config/uninstall/hook Node tests (136/136), native-agent verification, plugin-bundle verification, catalog-doc check, and `cargo test`. GitHub CI remains the final external gate before tag publication.

**Full Changelog**: [`v0.16.1...v0.16.2`](https://github.com/Yeachan-Heo/oh-my-codex/compare/v0.16.1...v0.16.2)

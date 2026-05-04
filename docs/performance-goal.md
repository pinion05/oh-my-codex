# Performance Goal Workflow

`omx performance-goal` is an evaluator-gated optimization workflow layered over Codex goal mode.

It records a local evaluator contract before optimization starts, emits a truthful Codex goal-mode handoff, and blocks completion until evaluator evidence passes.

## Artifacts

Each workflow is stored under:

```text
.omx/goals/performance/<slug>/
  state.json
  evaluator.md
  ledger.jsonl
```

## Boundary

- OMX persists workflow state, evaluator contracts, validation evidence, and ledgers.
- Codex goal mode owns active-thread focus/accounting.
- The CLI cannot secretly mutate the interactive Codex goal. `start` prints instructions for the active agent to call `get_goal`, call `create_goal` only when appropriate, then run `omx performance-goal complete` before later calling `update_goal({status: "complete"})` safely.

## Minimal flow

```sh
omx performance-goal create \
  --objective "Reduce startup latency by 20%" \
  --evaluator-command "npm run perf:startup" \
  --evaluator-contract "PASS when p95 latency improves by 20% and regression tests pass" \
  --slug startup-latency

omx performance-goal start --slug startup-latency
omx performance-goal checkpoint --slug startup-latency --status pass --evidence "benchmark and tests passed"
omx performance-goal complete --slug startup-latency --evidence "final evaluator evidence"
# after this succeeds and the active Codex goal still owns the objective:
# update_goal({status: "complete"})
```

Completion fails until a passing checkpoint exists.

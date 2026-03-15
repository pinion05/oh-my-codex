# Autoresearch pilot missions

These mission bundles are **autoresearch-ready pilots** for this repo snapshot.

Each mission directory contains:
- `mission.md` — objective, scope, and expected deliverable
- `sandbox.md` — evaluator contract plus safety/operating rules

Current pilots:
- `cli-discoverability-pilot/`
- `security-path-traversal-pilot/`

You can run the evaluators directly today:

```bash
node scripts/eval-cli-discoverability.js
node scripts/eval-security-path-traversal.js
```

These bundles are designed to become first-class `omx autoresearch` missions once the runtime is present in-tree.

---
name: Validator process-tree fixtures
description: Keep validator process-tree attestation tests stable without weakening fail-closed behavior.
---

**Rule:** Process-tree attestation needs a stable, bound validator process and descendants across its bounded samples. Use deterministic local fixture scripts that remain alive long enough for sampling; never treat an unknown tree as proof.

**Why:** Linux procfs observations can race with short-lived descendants from package-manager wrappers. A short fixture may produce `process_tree_descendant_unavailable` even when the direct child is correctly bound.

**How to apply:** Keep PID attestation distinct from tree attestation, use no-network test scripts with bounded runtime, and preserve fail-closed outcomes when the process tree cannot be established.

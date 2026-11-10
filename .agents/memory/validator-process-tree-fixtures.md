---
name: Validator process-tree fixtures
description: Keep validator process-tree attestation tests stable without weakening fail-closed behavior.
---

**Rule:** Process-tree attestation needs a stable, bound validator process and descendants across its bounded samples. Use deterministic local fixture scripts that remain alive long enough for sampling; never treat an unknown tree as proof. For PATH mismatches, inspect bounded structural summaries only; never log raw environment values or relax the workspace-prefix checks without proving the new boundary. Classify rejected prefixes as candidate-local bins, external bins, approved process directories, or other; if pnpm descendants add external prefixes, fix the candidate overlay rather than allowlisting the live project path.

**Why:** Linux procfs observations can race with short-lived descendants from package-manager wrappers, and their PATH can differ while the direct child remains correctly bound. A symlinked candidate `.bin` can resolve to the live project, while raw PATH values expose machine-specific details.

**How to apply:** Keep PID attestation distinct from tree attestation, use no-network test scripts with bounded runtime, and preserve fail-closed outcomes when the process tree cannot be established. Keep candidate `.bin` paths local and diagnose PATH by component counts, suffix matching, normalization, and safe prefix categories without emitting component values.

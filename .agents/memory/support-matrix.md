---
name: Support matrix
description: Language and framework detection must remain separate from structural, graph, validation, and change-readiness support.
---

The support matrix is server-owned metadata layered on top of the existing discovery and scanner detectors. Detection alone must never imply parser, graph, validation, or change readiness.

**Why:** The scanner recognizes more languages and frameworks than it can safely analyze or validate. Showing one undifferentiated “supported” label would overstate the product’s evidence.

**How to apply:** Extend the existing scanner support profiles when adding a parser or validation profile, keep unsupported capabilities explicit, and expose the matrix in discovery reports instead of duplicating detector logic in the dashboard.

For Go specifically, `deep` support requires a completed standard-library parse with zero file failures and a registered bounded `go-tests` validation profile; parser or validation gaps remain `partial`.

**Why:** A parser that succeeds for only part of a repository, or a parser without an approved validation path, cannot safely support structural changes.

**How to apply:** Treat parser availability, per-file parse failures, and validation-profile registration as separate evidence inputs when projecting Go readiness.
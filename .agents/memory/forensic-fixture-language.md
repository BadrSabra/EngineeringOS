---
name: Forensic fixture language
description: Language selection for deterministic forensic end-to-end fixtures.
---

Keep deterministic forensic fixtures internally consistent: the request language
must match the natural-language report language, while protocol labels and
technical identifiers may remain English.

**Why:** A language-mismatch fallback can mask the actual evidence-gate or
objective-gate assertion that the scenario is intended to exercise.

**How to apply:** Use English prompts for intentionally English forensic reports;
reserve Arabic prompts and the Arabic fixture guard for fixtures that genuinely
assert Arabic response behavior.
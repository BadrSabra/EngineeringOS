---
name: Broad forensic bootstrap
description: How generic gap and root-cause prompts acquire source evidence before model synthesis.
---

**Rule:** When a forensic request asks for source-code gaps or root causes but does not name a source path, classify it as a broad discovery request and assign the project root (`"."`) as an ordered forensic root. Deterministic prefetch then reads source files before the provider gets a synthesis turn. Do not apply this fallback to explicit-file requests or generic workspace-review tests that intentionally exercise the no-read contract.

**Why:** A provider can stop after planning or prose and produce zero source reads, causing the evidence gate to return `INCOMPLETE_BEFORE_EVIDENCE`. The project-root bootstrap makes source acquisition deterministic while preserving explicit narrow scopes.

**How to apply:** Keep `"."` interpreted as the authenticated project root in ordered-root path matching. Any change to the classifier or root matching must preserve explicit-file and ordered-directory behavior, and tests must cover Arabic/English gap or root-cause prompts plus existing forensic contracts.
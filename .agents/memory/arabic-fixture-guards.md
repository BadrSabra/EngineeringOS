---
name: Arabic fixture guards
description: Language regression checks for deterministic Arabic AI response fixtures.
---

Arabic-language AI fixtures should be validated as soon as they are assembled, before the scenario invokes the pipeline or runs behavioral assertions. The guard should require Arabic-script content and include the fixture name in its failure.

**Why:** A fixture can remain structurally valid while silently switching to English, causing a misleading downstream language mismatch instead of identifying the bad fixture.

**How to apply:** Use the shared fixture guard for Arabic reports in chat-agent and forensic end-to-end tests; do not apply it to intentionally structured English protocol fields or non-Arabic fixtures.
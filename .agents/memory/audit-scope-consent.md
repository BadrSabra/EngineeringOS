---
name: Audit scope consent
description: User-facing routing rules for broad project reviews versus ordinary architecture questions.
---

Broad project-review wording is not sufficient authorization for an expensive forensic scan. Ask for a boundary unless the user names a path, production surface, or whole-project scope; keep architecture explanations on the normal project-query path.

**Why:** Ordinary users can describe a concern without realizing that a forensic audit may traverse many files and incur substantial latency. Treating every “analyze the project” request as forensic also makes simple architecture questions wait for evidence machinery.

**How to apply:** Make the scope check deterministic and provider-free in the shared turn-intent path so API routing, streaming, model selection, and the agent agree before any tool call. Preserve explicit structured forensic fixtures and scoped file/directory audits.
---
name: Chat model selection
description: Model capability requirements for ordinary conversational turns
---

Ordinary `CHAT` turns must not require reasoning or thinking capabilities; they should select a fast conversational model unless the user explicitly requests analysis, tools, or evidence.

**Why:** A greeting was classified as `CHAT` but inherited a reasoning requirement, selecting a slow model and then a fallback; the request took about two minutes despite needing no tools.

**How to apply:** Keep reasoning requirements scoped to analysis, review, workflow, and execution profiles. Add a regression test whenever chat quality hints change.
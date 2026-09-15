---
name: Git history evidence
description: Scope and identity rules for retrieval-linked Git history.
---

Retrieval may attach bounded `git log --follow` entries for ranked source paths, but a missing Git repository must remain an explicit unavailable history status rather than failing or fabricating the source plan.

**Why:** commit history improves churn and regression context without being required for graph/source correctness, and Git identity must not be confused with the workspace or scanner revision.

**How to apply:** cap paths, commits, output size, and subjects; sanitize repository-derived text before returning it through AI-facing outputs.
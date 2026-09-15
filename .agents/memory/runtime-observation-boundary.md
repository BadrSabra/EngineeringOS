---
name: Runtime observation boundary
description: Server-owned runtime graph ingestion and stale-evidence rules.
---

Accept runtime edges only when the active workspace runtime session and revision match, resolve both endpoints by project-relative path, and store session/revision metadata on the observed edge.

**Why:** runtime behavior is environment-specific and stale observations can look more trustworthy than static edges unless their lifecycle is explicit.

**How to apply:** keep runtime edges separate from static/heuristic layers and expose session/revision filters whenever runtime evidence is queried.
---
name: Runtime observation boundary
description: Server-owned runtime graph ingestion and stale-evidence rules.
---

Accept runtime edges only when the active workspace runtime session and revision match, resolve both endpoints by project-relative path, and store session/revision metadata on the observed edge.

**Why:** runtime behavior is environment-specific and stale observations can look more trustworthy than static edges unless their lifecycle is explicit.

**How to apply:** keep runtime edges separate from static/heuristic layers, expose session/revision filters whenever runtime evidence is queried, and report static/runtime disagreements without treating either side as automatically authoritative.

Static/runtime comparison is a diagnostic projection: `static_not_observed` and `runtime_not_static` are useful signals, not proof that an edge is incorrect or safe.

**Why:** an observed snapshot can be incomplete and static analysis can be conservative; collapsing disagreement into a verdict would turn missing coverage into a false defect.

**How to apply:** bind comparison results to the requested runtime session and revision, keep the result read-only, and require downstream acceptance logic to use retained evidence and server-owned checks.
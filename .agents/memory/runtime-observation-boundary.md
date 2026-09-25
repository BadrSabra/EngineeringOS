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

### Live child-process environment probes

The runtime child marker and procfs probe attest only the direct server-owned spawned process. If that PID is `pnpm`, the result does not prove that the descendant owning the listening socket inherited the same environment. Recovery without the ephemeral marker remains `unknown`; validator commands need their own in-process spawn observation.

**Why:** launch handoff state and a parent process environment are not equivalent to independently observing the process that serves the application or runs a validator.

**How to apply:** describe the attested PID precisely, keep missing or mismatched child evidence outside acceptance authority, and add separate process-bound probes before claiming listener or validator environment proof.
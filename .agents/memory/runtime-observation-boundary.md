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

The runtime and validator markers attest only the direct server-owned spawned PID. A validator observation is emitted only when the spawn has a complete project/execution/attempt/Episode/operation/revision identity; it binds to the validation evidence ID and registered profile. Procfs unavailable or absent identity remains unobserved/unknown, while a measured mismatch is failed evidence.

**Why:** launch handoff state is not an observation of the child. A temporary validation workspace is a process boundary only; treating it as the managed project root would confuse candidate execution with project provenance.

**How to apply:** describe the attested PID precisely, use the isolated workspace only for cwd/process checks, never persist the marker or raw environment, and keep missing/mismatched observations outside acceptance authority. A validator `pnpm` PID does not prove descendant or listener environment; those need separate process-bound observations.
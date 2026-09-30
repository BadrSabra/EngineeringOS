---
name: Orientation proof and recovery index
description: Related constraints for orientation role manifests, fallback, acceptance, and recovery.
---

Project orientation must keep the server-owned role manifest, evidence coverage, proof acceptance, and recovery behavior aligned. A partial manifest or missing role must never be treated as complete evidence.

**Why:** These rules span multiple lifecycle stages, and a fix to fallback or resume can otherwise bypass a proof requirement or make partial scope look valid.

**How to apply:** Start with the relevant contract below. Validate role paths against the managed project root; use only complete retained role reads for deterministic fallback; require the orientation acceptance branch on proof-required runs; keep recovery bounded by the persisted manifest and request ledger.

Related contracts:
- [Manifest fallback](orientation-manifest-fallback.md)
- [Recovery telemetry](orientation-recovery-telemetry.md)
- [Deterministic fallback](project-orientation-deterministic-fallback.md)
- [Proof compatibility](orientation-acceptance-proof.md)
- [Project orientation recovery](project-orientation-recovery.md)
- [Manifest admission](orientation-manifest-admission.md)
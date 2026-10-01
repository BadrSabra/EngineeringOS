---
name: Runtime oracle command boundary
description: Constraints for safely using runtime behavioral validation in production repair lifecycles.
---

Keep runtime validation within the existing validation-result and receipt/proof contracts. Do not accept model- or user-supplied command arguments as evidence. A runtime oracle may enter a production repair lifecycle only after a fixed, server-owned command exists for a concrete supported scope. Validate isolated candidate content and bind accepted evidence to the current operation, revision, and candidate. Runtime validation never grants file-write approval.

**Why:** Benchmark fixtures do not define a safe default command for arbitrary projects, and accepting arbitrary runtime commands as proof would turn execution capability into an acceptance authority path.

**How to apply:** Reuse existing server-owned validation profiles and receipt/proof paths; do not add a parallel registry or ledger. If no fixed command is defined, keep runtime-oracle results advisory or benchmark-only.
---
name: Recovery telemetry semantics
description: Distinguish provider fallback, forensic recovery, and control-plane resume when interpreting AI traces
---

Runtime recovery has separate layers: provider candidate advancement, forensic recovery attempts, and execution-control-plane resume. The execution ledger's `recovery` counter only counts calls admitted with the exact recovery kind, so a zero value does not prove that correction or candidate fallback never ran.

**Why:** A failed capability probe showed provider correction/recovery activity in server logs while the persisted public ledger reported `recovery: 0`; the mismatch came from intentionally different event and redaction boundaries.

**How to apply:** Correlate server provider logs, raw in-process AgentStep events, the persisted public trace, and the execution ledger before diagnosing recovery as absent. Treat lease-rejected checkpoints as an observability/durability issue unless terminal persistence itself failed.
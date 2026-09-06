---
name: Recovery telemetry semantics
description: Distinguish provider fallback, forensic recovery, and control-plane resume when interpreting AI traces
---

Runtime recovery has separate layers: provider candidate advancement, forensic recovery attempts, and execution-control-plane resume. The execution ledger's `recovery` counter only counts calls admitted with the exact recovery kind, so a zero value does not prove that correction or candidate fallback never ran.

**Why:** A failed capability probe showed provider correction/recovery activity in server logs while the persisted public ledger reported `recovery: 0`; the mismatch came from intentionally different event and redaction boundaries.

**How to apply:** Correlate server provider logs, raw in-process AgentStep events, the persisted public trace, and the execution ledger before diagnosing recovery as absent. Provider exhaustion before the first source read is an incomplete provider failure, not required forensic recovery. Treat lease-rejected checkpoints as an observability/durability issue unless terminal persistence itself failed.

Durable provider-attempt telemetry must be awaited before a fallback or successful AI response is considered complete; fire-and-forget writes can lose the attempt during process interruption even when the user-facing turn succeeds.

**Why:** A restart-oriented fallback campaign exposed that the response boundary could complete before primary/fallback attempt rows were durable, making correlation and summary history unreliable after reconnect.

**How to apply:** Await both callback-based and telemetry-context attempt recording in provider fallback helpers, while keeping the recorder best-effort so telemetry failure cannot turn a valid AI response into a user-visible failure.
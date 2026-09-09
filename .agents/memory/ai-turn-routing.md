---
name: Unified AI turn routing
description: Architectural rules for keeping request intent consistent across API routes, providers, tools, evidence gates, and resumable execution.
---

The resolved `TurnIntent` is authoritative for downstream AI behavior. Classify the raw user message first, then use that same intent for provider selection, tool availability, evidence requirements, execution profile, persistence, and response metadata. Only verified continuations may reuse prior forensic state; ordinary chat must not inherit stale Build or forensic metadata.

**Why:** Independently re-inferring intent from Build/resume-augmented text caused neutral greetings and follow-up chat to enter forensic execution, while broad action-word matching misrouted questions and implementation-plan requests.

**How to apply:** Keep direct modification requests and approved Build handoffs tool-capable, keep implementation-plan creation read-only, allow technical project questions to use tools without automatically requiring evidence, and require evidence only for explicit audits, investigations, reachability proofs, or clearly evidence-grounded behavior claims. Keep genuinely generic/social questions tool-free, but route short project-orientation questions (including Arabic) to lightweight PROJECT_QUERY so a valid root and tool-capable provider can supply context without triggering a broad scan or behavior verdict. A bare continuation such as “ابدأ” inherits a verified forensic contract as read-only analysis; it becomes Repair Plan execution only when explicit repair language or an executable recovered phase exists. In the dashboard, isolate forensic evidence cards from ordinary chat while still showing a bounded persisted execution diagnostic when a generic turn actually failed.

**Why:** Hiding all execution metadata from ordinary chat made provider and connection failures appear unexplained, while exposing forensic cards there leaked audit-specific telemetry into a normal conversation.

The resolved `TurnIntent` must also be the only source for typed result construction and resumable session state. A raw classifier task type may be forensic-shaped while the final turn is ordinary `CHAT`; using that raw value later can emit a forensic `taskResult`, persist an active forensic state, and make a retry look like an audit without evidence.

**Why:** A continuation phrase can match broad-audit patterns even when no resumable contract was recovered. In that case `kind=CHAT`, `requiresEvidence=false`, and `outputContract=GENERIC_RESPONSE` can coexist with `forensicTaskType=FULL_FORENSIC_AUDIT`; the stored session then contradicts the execution and assistant message.

**How to apply:** Gate `buildTaskResult`, `nextSessionTaskState`, resume contracts, and public source provenance on the final intent/contract. Preserve raw classifier values only for diagnostics; never let them override a non-forensic resolved turn.

Public `sources` are an acceptance projection, not a copy of provider output. For ordinary chat, a source must intersect a server-observed read trace; for behavior/forensic contracts, it must also have accepted evidence. Session memory receives only the server-observed read paths, never model-reported citations.

**Why:** A provider can report plausible file paths after a zero-tool retry, and a completed read can still have zero accepted behavioral evidence. Publishing either as a current source makes history, memory, and the next retry claim more than the server verified.

**How to apply:** Derive source projections from read/tool and evidence-integrity traces in both JSON and SSE success/failure paths. Keep the final turn intent as the gate for typed task results and resumable state, and preserve redaction at every user-facing boundary.
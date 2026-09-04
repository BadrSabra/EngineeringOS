---
name: Unified AI turn routing
description: Architectural rules for keeping request intent consistent across API routes, providers, tools, evidence gates, and resumable execution.
---

The resolved `TurnIntent` is authoritative for downstream AI behavior. Classify the raw user message first, then use that same intent for provider selection, tool availability, evidence requirements, execution profile, persistence, and response metadata. Only verified continuations may reuse prior forensic state; ordinary chat must not inherit stale Build or forensic metadata.

**Why:** Independently re-inferring intent from Build/resume-augmented text caused neutral greetings and follow-up chat to enter forensic execution, while broad action-word matching misrouted questions and implementation-plan requests.

**How to apply:** Keep direct modification requests and approved Build handoffs tool-capable, keep implementation-plan creation read-only, allow technical project questions to use tools without automatically requiring evidence, and require evidence only for explicit audits, investigations, reachability proofs, or clearly evidence-grounded behavior claims. Keep genuinely generic/social questions tool-free, but route short project-orientation questions (including Arabic) to lightweight PROJECT_QUERY so a valid root and tool-capable provider can supply context without triggering a broad scan or behavior verdict. A bare continuation such as “ابدأ” inherits a verified forensic contract as read-only analysis; it becomes Repair Plan execution only when explicit repair language or an executable recovered phase exists. In the dashboard, isolate forensic evidence cards from ordinary chat while still showing a bounded persisted execution diagnostic when a generic turn actually failed.

**Why:** Hiding all execution metadata from ordinary chat made provider and connection failures appear unexplained, while exposing forensic cards there leaked audit-specific telemetry into a normal conversation.
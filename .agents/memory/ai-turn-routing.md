---
name: Unified AI turn routing
description: Architectural rules for keeping request intent consistent across API routes, providers, tools, evidence gates, and resumable execution.
---

The resolved `TurnIntent` is authoritative for downstream AI behavior. Classify the raw user message first, then use that same intent for provider selection, tool availability, evidence requirements, execution profile, persistence, and response metadata. Only verified continuations may reuse prior forensic state; ordinary chat must not inherit stale Build or forensic metadata.

**Why:** Independently re-inferring intent from Build/resume-augmented text caused neutral greetings and follow-up chat to enter forensic execution, while broad action-word matching misrouted questions and implementation-plan requests.

**How to apply:** Keep direct modification requests and approved Build handoffs tool-capable, keep implementation-plan creation read-only, allow technical project questions to use tools without automatically requiring evidence, and require evidence only for explicit audits, investigations, reachability proofs, or clearly evidence-grounded behavior claims.
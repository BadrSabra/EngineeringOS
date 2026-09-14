---
name: Ambiguous target planning
description: Safe read planning when a project question names an architectural concern without a specific subsystem.
---

Unresolved project-query targets are an explicit state, not permission to treat the knowledge graph as complete. A planner may contribute only a small, high-confidence source hint; otherwise the read plan must leave targets empty so the source-first prompt path discovers evidence. Graph neighborhood enrichment must not expand an unresolved plan.

**Why:** Architectural questions often identify a concern but not a subsystem. Broad planner candidates can silently bias evidence toward an unrelated part of the repository and bypass the intended source-first recovery behavior.

**How to apply:** Carry target resolution from classification through turn intent and planning. Require a server-checked confidence threshold and bounded file count for unresolved candidates, then skip graph expansion; keep explicit broad-audit consent and resolved subsystem targeting separate.
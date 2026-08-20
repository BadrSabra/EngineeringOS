---
name: Directed citation recovery
description: Behavior citation repair must expose source-owned executable windows without changing literal evidence gates.
---

Behavior citation recovery should rank and display bounded executable windows from every retained file, while the final validator still matches the quoted text against the complete source body and rejects declaration-only or ambiguous spans.

**Why:** Generic head/tail excerpts can hide a later control-flow branch, and normal whitespace normalization can silently corrupt a valid multi-line source quote before literal verification.

**How to apply:** Keep recovery to one no-tool provider pass, preserve code indentation inside quoted fragments, and treat candidate labels, line coordinates, and windows as guidance rather than accepted evidence.
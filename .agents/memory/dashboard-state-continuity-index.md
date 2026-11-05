---
name: Dashboard state continuity
description: Pointers for durable chat drafts, pending proposal restoration, and AiChat structure.
---

- [Goal draft continuity](goal-draft-continuity.md) — closing creation stops UI continuation, not the durable job; a send attempt is never an acceptance receipt.
- [Pending proposal cache hydration](pending-proposal-cache-hydration.md) — async restore must preserve a matching live proposal and must not depend on state it resets.
- [AiChat module split](aichat-module-split.md) — page component stays in AiChat.tsx; cards, parsers, and types live in pages/ai-chat/; keep it mechanical and type-only cyclic.

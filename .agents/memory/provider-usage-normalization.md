---
name: Provider usage normalization
description: Provider usage metadata may be absent or partial, so public chat output must remain schema-valid without inventing nonzero counts.
---

Provider usage counters are optional at the provider boundary. When a provider or deterministic fixture returns an empty or partial usage object, normalize missing counters to zero before validating or persisting the public chat output.

**Why:** Compatible providers do not always return token metadata, and treating a partial object as authoritative caused otherwise valid chat responses to become `CHAT_OUTPUT_INVALID`.

**How to apply:** Keep provider adapters tolerant of absent usage metadata while preserving integer, nonnegative counters in `ChatOutputSchema`.
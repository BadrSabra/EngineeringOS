---
name: Generated query-key tests
description: Keep React Query cache-invalidation tests aligned with generated API client keys.
---

When testing generated React Query clients, use the actual key helpers when practical. If mocking them, mirror their exact URL and optional-parameter structure; invalidation often relies on prefix matching.

**Why:** A mock key with extra or missing segments can make a correct invalidation look broken, or hide a real mismatch.

**How to apply:** Before asserting query invalidation, compare the mocked key shape with the generated helper and verify the active query key is covered by the invalidation prefix.
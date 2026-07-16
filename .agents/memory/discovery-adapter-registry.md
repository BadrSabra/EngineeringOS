---
name: Discovery adapter registry
description: How to add a new discovery source type; where the adapter contract lives and why the route never needs to change.
---

The `SourceAdapter` union lives in `artifacts/api-server/src/lib/discovery-adapters.ts`.

**The rule:** to add a new source type, add one entry to the `ADAPTERS` record. The route (`discovery.ts`) calls `resolveSource` which looks up the adapter — it never has a switch on source type.

**Why:** the previous design was a 75-line switch inside the route. Any new source type required touching the route. The registry decouples the two.

**How to apply:**
- `SupportedAdapter`: implement `validate(config)` (sync, returns error|null), `resolve(config)` (async, returns ResolveSuccess|ResolveError), optionally `cleanup(tempDir)`.
- `UnsupportedAdapter`: set `available: false` and a human-readable `reason`.
- Use `isResolveError(result)` to narrow `ResolveResult` — don't use `"error" in result`.
- `cleanupResolveResult(result)` handles tempDir teardown safely for any result shape.
- Test file: `artifacts/api-server/src/lib/discovery-adapters.test.ts` — add one describe block per new adapter.

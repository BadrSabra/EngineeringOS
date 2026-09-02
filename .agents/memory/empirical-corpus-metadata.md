---
name: Empirical corpus metadata
description: GitHub tree metadata can be large and its response identity depends on the requested revision kind.
---

The corpus provenance preflight must traverse GitHub trees non-recursively along selected paths. A recursive tree request can exceed bounded metadata limits on large repositories, and requesting a tree by commit SHA returns that commit SHA as the response identity rather than the commit's root tree SHA.

**Why:** The preflight must remain metadata-only and bounded while distinguishing an exact pinned commit from an unknown or incomplete transport result.

**How to apply:** Resolve the commit first, then use non-recursive tree metadata and directory entry SHAs to reach only selected paths. Treat truncation, malformed metadata, and rate limits as unverifiable; never fall back to source or checkout data.
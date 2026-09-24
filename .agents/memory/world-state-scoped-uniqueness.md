---
name: Scoped World State uniqueness
description: Why task/environment evidence identity uses a non-null environment key beside the nullable semantic revision.
---

**Rule:** Keep the semantic `environmentRevision` nullable. Use a separate non-null identity key for uniqueness, with an explicit sentinel for an unknown revision and a distinct prefix for known revisions. Derive task scope from the server-owned Episode, not provider output.

**Why:** PostgreSQL unique indexes treat `NULL` values as distinct by default. Putting a nullable environment revision directly in a unique identity index can therefore allow concurrent duplicate unknown-environment rows even when application code performs a pre-insert lookup.

**How to apply:** When extending durable observation/fact identity by task or environment, preserve existing column types, keep the null sentinel explicit, and retain database uniqueness protection rather than relying only on an application-side check.
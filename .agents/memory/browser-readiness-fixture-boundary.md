---
name: Browser readiness fixture boundary
description: How controlled browser readiness should validate projects without confusing mocked IDs with release-owned data.
---

In provider-free browser fixtures, readiness should prove that the authenticated project response is non-empty and well-formed; literal fixture project IDs belong only to intercepted test responses. Live-provider mode must still require its explicitly selected disposable project ID.

**Why:** The release runner owns an isolated database but does not seed the deterministic ID used by page-level fixtures. Requiring that ID made a valid authenticated release run appear blocked, while accepting an empty response could create false readiness.

**How to apply:** Keep the release preflight responsible for API/database/schema/mode checks, and let the authenticated browser half validate the project list returned through the normal dashboard API boundary.
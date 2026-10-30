---
name: GitHub review branches
description: Publish narrowly scoped review branches through the GitHub App when SSH credentials are unavailable.
---

Before creating a review branch, read the live default-branch ref through the GitHub integration. Cached `origin/main` can lag behind the repository.

**Why:** A stale base can omit recent upstream changes, including changes to tests or implementation files. A ready GitHub App can create one review commit through the Git tree, commit, and ref APIs even when local SSH authentication is unavailable.

**How to apply:** Rebase the candidate onto the live main SHA and rerun focused checks if main advanced. Create the tree atop that exact commit, create one commit, then create and verify the review ref. Do not open a PR or merge unless separately requested.

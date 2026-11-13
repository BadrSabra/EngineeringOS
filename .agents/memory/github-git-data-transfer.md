---
name: GitHub Git Data transfer
description: Preserve repository blob bytes when publishing branches through the GitHub connector.
---

When transferring local Git objects through the GitHub Git Data API, send blob content as Base64 rather than UTF-8 text. Shell output may remove a trailing newline, changing the Git blob SHA even when the text appears identical. GitHub's create-commit API also produced a commit hash for the message without a terminal newline, unlike `git commit-tree -m`; compare the full commit SHA before moving the ref. Read a ref through singular `/git/ref/{ref}`, but update it through plural `/git/refs/{ref}`.

**Why:** Exact tree equality did not guarantee commit-object equality, and the read endpoint returned 404 when mistakenly reused for a write. Verifying the complete object and using the distinct write endpoint kept the protected PR branch unchanged until the payload was correct.

**How to apply:** Use this procedure when SSH or a standard Git push is unavailable and the GitHub App Git Data API creates commits. Verify blob, tree, and full commit SHAs; re-read the ref immediately before a non-forced update and verify it afterward. Never create or move a ref until all identities match.

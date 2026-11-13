---
name: GitHub Git Data transfer
description: Preserve repository blob bytes when publishing branches through the GitHub connector.
---

When transferring local Git objects through the GitHub Git Data API, send blob content as Base64 rather than UTF-8 text. Shell output may remove a trailing newline, changing the Git blob SHA even when the text appears identical. GitHub's create-commit API also produced a commit hash for the message without a terminal newline, unlike `git commit-tree -m`; compare the full commit SHA before moving the ref. Read a ref through singular `/git/ref/{ref}`, but update it through plural `/git/refs/{ref}`.

**Why:** Exact tree equality did not guarantee commit-object equality, and the read endpoint returned 404 when mistakenly reused for a write. Verifying the complete object and using the distinct write endpoint kept the protected PR branch unchanged until the payload was correct.

**How to apply:** Use this procedure when SSH or a standard Git push is unavailable and the GitHub App Git Data API creates commits. Verify blob, tree, and full commit SHAs; re-read the ref immediately before a non-forced update and verify it afterward. Never create or move a ref until all identities match.

An additional connector edge case was observed: creating a tree that changed `.github/workflows/ci.yml` returned 404 even though the base tree and uploaded blobs were readable; a documentation-only tree then succeeded. The cause was not proven, so do not infer missing permissions from that 404 or retry by broadening credentials. For a manual `workflow_dispatch` with a required environment input, first list configured environments; use only an existing neutral environment on a non-main ref and verify the release job is skipped by its exact branch/input guard.

**Why:** The failed workflow-tree attempt changed no ref, and an existing neutral environment allowed test CI without invoking Release. Treating an ambiguous 404 as a confirmed permission defect would have led to an unsupported claim or an unnecessary access change.

**How to apply:** When the GitHub connector cannot publish a workflow-file tree, leave the ref untouched, verify whether a non-release test run can safely use an existing environment input, and ask the repository owner before changing integrations or environment configuration.

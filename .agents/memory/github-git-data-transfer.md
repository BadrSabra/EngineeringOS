---
name: GitHub Git Data transfer
description: Preserve repository blob bytes when publishing branches through the GitHub connector.
---

When transferring local Git objects through the GitHub Git Data API, send blob content as Base64 rather than UTF-8 text. Shell output may remove a trailing newline, changing the Git blob SHA even when the text appears identical. Define and call impure connector helpers within the same CodeExecution block. Verify each returned blob SHA against the local SHA, then verify the final tree SHA against the local tree before creating a branch ref.

**Why:** A text transfer produced a mismatched blob for a file ending in a newline; publishing the ref only after exact object and tree checks prevented an incomplete branch from becoming visible.

**How to apply:** Use this procedure when SSH or a standard Git push is unavailable and the GitHub App Git Data API is used to create commits. Never create the ref until all object identities and the final tree are verified.

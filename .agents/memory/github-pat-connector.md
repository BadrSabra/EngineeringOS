---
name: GitHub PAT connector contract
description: Project requirement for the authoritative GitHub credential path.
---

For GitHub operations, the project owner's saved PAT is the authoritative credential. Store it encrypted using the existing credentials encryption, load it by the project's `ownerId`, and attach it only to server-side GitHub Connector API requests. The UI may show configured state and the last four characters, but must never receive the token again. Do not put it in a remote URL, event, log, error response, or persisted delivery receipt.

**Why:** The project owner requested PAT-based GitHub authentication through the Connector with strict secret isolation and no token disclosure.

**How to apply:** Keep auth owner-scoped, use HTTPS GitHub remotes through the connector proxy, redact provider error text, and preserve proof/remote verification before and after pushes.

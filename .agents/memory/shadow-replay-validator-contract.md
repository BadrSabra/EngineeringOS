---
name: Shadow replay validator contract
description: Shadow replay must preserve an immutable objective and server-owned validator receipt through recipe execution and acceptance.
---

Shadow replay may only execute a validator profile selected from the source execution objective and Goal contract. The replay request must carry that contract into the disposable workspace, and the registered validator's receipt must be passed to the normal execution acceptance gate before a new Canonical Proof can be accepted.

**Why:** A source read, compiler parse, or provider statement can show that files are well-formed without proving the candidate behavior. Keeping profile selection and acceptance server-owned prevents replay from becoming an unbound second verification system.

**How to apply:** When adding a replay profile, register it in the recipe contract, run it through the existing recipe/validation lifecycle, bind its evidence to project, revision, operation, and candidate identities, and add a failure test for missing or mismatched objective metadata.
---
name: Runtime replay fixture boundary
description: Keep runtime replay test inputs in files copied into the isolated candidate workspace.
---

Runtime replay fixtures must not depend on files stored under dependency directories such as `node_modules`; isolated validation copies intentionally omit those directories. Put required runtime inputs in a dedicated ignored fixture directory that is copied into the candidate workspace.

**Why:** A replay can fail closed at its pre-effect runtime gate before reaching the intended identity-mismatch or recovery assertion, making the test appear to cover replay semantics when its fixture was unavailable.

**How to apply:** When a test runs a recipe against a copied validation workspace, verify every file the child process reads is present in that copy and every mutation marker is scoped to the disposable candidate workspace.

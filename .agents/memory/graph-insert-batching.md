---
name: Graph insert batching
description: PostgreSQL parameter-limit constraint for scan-derived graph writes.
---

Graph entity and relationship writes must be split into bounded batches while staying inside the scan transaction.

**Why:** A large repository can exceed PostgreSQL's 65,535 bind-parameter limit even when every individual graph row is valid; the resulting user-facing error may expose only the generated INSERT query.

**How to apply:** Size batches from the widest row shape with safety margin, keep all batches in the same atomic scan transaction, and validate with a realistic large-project scan rather than only a small fixture.
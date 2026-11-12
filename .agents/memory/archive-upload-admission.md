---
name: Archive upload admission
description: Keep archive parsing limits honest across process, replica, and isolation boundaries.
---

**Rule:** Use a process-local semaphore before accepting an archive body and a PostgreSQL session advisory lock around parsing/decompression across API instances. The shared lock does not bound aggregate upload-body disk usage and is not an OS isolation boundary. Do not enable untrusted Candidate execution from these controls alone.

**Why:** Replicas can receive bounded compressed bodies before contending for the shared parse lock, and a parser still runs with the API process's memory and CPU privileges. In-process and database admission limits reduce concurrent exposure but do not contain parser compromise or a host-level denial of service.

**How to apply:** Fail excess per-process uploads before writing request bodies, fail closed if the shared lock cannot be acquired, and keep staging roots private. Before untrusted archive processing, run parsing in an independently resource-limited worker; add a shared byte/disk quota if aggregate body storage across replicas must be bounded. Test the deployed boundary rather than extrapolating from unit tests.

---
name: Archive upload admission
description: Keep archive parsing limits honest across process, replica, and isolation boundaries.
---

**Rule:** A process-local archive semaphore bounds concurrency only within that API process. It is not a fleet-wide quota, a durable lease, or an OS isolation boundary. Do not enable untrusted Candidate execution or claim production-wide upload safety from it alone.

**Why:** Each API replica can independently admit its configured maximum, and a parser still runs with the API process's memory and CPU privileges. In-process byte and count limits reduce exposure but do not contain parser compromise or a host-level denial of service.

**How to apply:** For a single trusted API process, fail excess uploads before buffering or writing request bodies and keep staging roots private. Before multi-replica or untrusted archive processing, add a shared admission/quota mechanism and run parsing in an independently resource-limited worker; test the deployed boundary rather than extrapolating from unit tests.

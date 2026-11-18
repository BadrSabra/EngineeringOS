---
name: Archive upload admission
description: Keep archive parsing limits honest across process, replica, and isolation boundaries.
---

**Rule:** Keep the process-local semaphore and acquire one shared PostgreSQL session advisory slot before Multer. The slot is held through extraction and registration, so only one <=50 MB request body can be staged across API instances at a time. Archive re-materialization during discovery must also hold both limits through download and safe extraction. Use the Replit sidecar's short-lived signed object URLs for private archive transfers; direct Google Storage client setup may fail when the runtime cannot infer a project ID.

**Why:** The existing parser is globally serialized, so moving that same lock before body parsing gives a strict cross-replica staging bound without a second quota table or lease reconciler. Re-discovery runs the same parser again and would otherwise bypass the bound. In this runtime, a real Google Storage SDK round-trip failed because no project ID could be inferred, while sidecar-signed URLs completed a real upload/download/delete check.

**How to apply:** Keep the shared slot before Multer, return a retryable response when busy, and release it on every completed or aborted path. Rediscovery must acquire the same slot before claiming an upload and release it after local materialization, before longer discovery work. Scrub only generated private staging directories while holding the slot. If concurrent global uploads are later required, replace the single slot with a tested bounded set; never infer parser isolation from admission limits.

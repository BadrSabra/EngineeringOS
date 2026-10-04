---
name: Startup scrub contract preservation
description: Keep structured execution contracts intact while removing historical validation-result diagnostics.
---

Historical startup scrubbers must distinguish typed operation acceptance metadata from validation-result payloads; a shared `kind: "validation"` tag is not enough to classify a record.

**Why:** The scrubber previously treated an operation's validation acceptance check as a raw result record and removed contract fields. Acceptance rows and evidence remained intact, but strict checkpoint parsing then failed after startup.

**How to apply:** Preserve only the known schema fields for typed acceptance checks while continuing to remove raw validation commands and output. Keep a regression that exercises both shapes and verifies checkpoint parsing after full API startup.
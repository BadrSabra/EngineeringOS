---
name: Provider tool-call manifests
description: Why provider normalization needs a full authorized manifest separate from the per-iteration tool list.
---

Provider responses must be normalized against the complete server-authorized execution manifest, not only the tools exposed on the current iteration.

**Why:** the execution loop can intentionally narrow the per-iteration list after cached reads or phase transitions. Treating that narrower list as the authorization boundary makes a valid stale response fail unpredictably; omitting the manifest entirely allows unregistered textual or native calls to cross the provider boundary.

**How to apply:** carry both values through provider strategy options; omit the full manifest only for deliberate no-tool synthesis calls. Normalized calls still enter the existing tool loop so root, scope, phase, validation, and approval gates remain authoritative.
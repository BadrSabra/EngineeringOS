---
name: Provider tool-call manifests
description: Why provider normalization needs a full authorized manifest separate from the per-iteration tool list.
---

Provider responses must be normalized against the complete server-authorized execution manifest, not only the tools exposed on the current iteration.

**Why:** the execution loop can intentionally narrow the per-iteration list after cached reads or phase transitions. Treating that narrower list as the authorization boundary makes a valid stale response fail unpredictably; omitting the manifest entirely allows unregistered textual or native calls to cross the provider boundary.

**How to apply:** carry both values through provider strategy options; omit the full manifest only for deliberate no-tool synthesis calls. Normalized calls still enter the existing tool loop so root, scope, phase, validation, and approval gates remain authoritative.

For ordered forensic runs, do not generally intersect the full authorized manifest with the narrower provider-facing list: hidden range reads can be needed to recover complete evidence from a large file. Keep stale-call normalization intact and enforce ordered roots at dispatch for every path-based reader, including range reads and searches. Check both the normalized request path and the filesystem-resolved target so an in-project symlink cannot cross a nested audit root.

**Why:** the provider list is an iteration exposure, not the whole authorization contract. Blanket intersection can strand legitimate evidence recovery, while a lexical-only path gate lets a symlinked `search_code` target escape the requested subroots.

**How to apply:** when the provider-facing list is narrowed for an ordered-root audit, keep the full manifest semantics and test traversal aliases plus symlink targets for `read_file`, `read_file_range`, `list_directory`, and `search_code` before any file runner or evidence recording. Require the resolved target to remain under the same matched root, not merely any root in the ordered set.

Authorization inputs must also survive the final dispatcher boundary: a compound proposal's pending-approval mode is not effective if the loop computes it but omits it when calling the single-tool gate.

**Why:** a missing request-scoped mode is indistinguishable from an unapproved mutation at dispatch time, causing safe pending proposals to fail closed as unavailable.

**How to apply:** when adding an authorization field to the loop options, trace it through the loop's executeSingleTool call and cover both the allowed proposal and blocked ordinary-write cases. Recovered Repair Plan edits are also deferred proposals: derive their approved paths from the server-owned executable phase, keep approval pending unless explicitly approved, and never write bytes during handoff.
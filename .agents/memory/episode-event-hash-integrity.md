---
name: Episode event hash integrity
description: Keep effect-event integrity checks compatible with advisory credit payloads and legacy rows.
---

`EFFECT_CLASSIFIED` rows use a stable identity projection for their event hash.
When the advisory `creditAssignment` field is present, it must also be included
in the hash projection. Rows written before that field existed must continue to
validate against the legacy projection. Candidate extraction validates every
persisted event hash before admitting an accepted Episode.

**Why:** A producer/verifier projection mismatch made correctly accepted
Episodes ineligible for strategy extraction, preventing candidate support and
replay registration even though the effect and acceptance were valid.

**How to apply:** Whenever an Episode event payload or hash changes, update the
writer and every persisted-event verifier together, preserve compatibility for
legacy rows where required, and verify candidate extraction end-to-end.
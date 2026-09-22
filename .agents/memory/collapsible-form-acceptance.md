---
name: Collapsible form acceptance
description: Browser acceptance flows must model the explicit user action required to reveal fields inside compact forms.
---

Compact forms may hide advanced fields behind a disclosure control, but acceptance tests must open that control before filling hidden inputs.

**Why:** Collapsing advanced settings improves the primary workflow without removing capability, while browser automation correctly fails if it skips the same interaction a user must perform.

**How to apply:** When a form gains collapsible sections, add a stable disclosure hook and update browser journeys to open the section before asserting or filling its fields.
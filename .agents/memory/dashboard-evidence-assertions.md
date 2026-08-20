---
name: Dashboard evidence assertions
description: Stable UI-test conventions for completed AI evidence timelines and repeated source-backed content.
---

Completed AI responses render activity and proof details in collapsed disclosure panels, while the same source, answer, and evidence labels can appear in multiple cards.

**Why:** Assertions that expect collapsed content to be visible or assume unique text matches produce false failures even when the user-visible journey is correct.

**How to apply:** Open the relevant `summary` element before asserting its details, and use a scoped or explicitly disambiguated locator when source-backed text is intentionally repeated.
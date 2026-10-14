---
name: Arabic UI direction tests
description: Testing Arabic labels alongside untouched technical values and raw dynamic evidence.
---

When Arabic UI wraps API values or raw evidence in `<bdi>`/directional elements, test the Arabic label and technical value as separate accessible DOM nodes. Scope queries to the relevant semantic section when the same translated status also appears in a filter or legend. Do not alter UI markup merely to make a combined-text assertion pass.

**Why:** Tests for task acceptance and verification failed when they expected the localized label and an LTR code, or an Arabic prefix and dynamic actor value, to form one text node. A status label also appeared in both a filter option and the task summary.

**How to apply:** For mixed Arabic/technical values, assert the Arabic label, exact preserved code, and direction attribute independently; for server messages, assert the original text remains and uses automatic direction.

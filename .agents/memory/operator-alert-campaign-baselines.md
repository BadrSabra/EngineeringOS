---
name: Operator alert campaign baselines
description: How controlled recovery campaigns should account for durable alert history.
---

Controlled provider-recovery campaigns must baseline alert occurrence counts from historical rows after resolving active alerts. A resolved row remains durable and retains its occurrence count, so an active-only query makes a clean recovery look like zero history and produces false failures on reruns.

**Why:** The operator-alert table is intentionally deployment-wide and idempotent; resolving an alert changes its status but does not erase the incident history.

**How to apply:** Use active-only reads for user-facing open-alert assertions, but use an all-status read when calculating the expected occurrence delta across a controlled restart campaign.
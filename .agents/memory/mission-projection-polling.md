---
name: Mission Projection polling
description: Intentional active-Mission refresh cadence and original Chat return behavior.
---

Mission Projection refreshes every 3 seconds while a Mission is actively selected. This repeated read is intentional; preserve the cadence unless the active-Mission update contract is deliberately changed. Returning from Mission must continue to reopen the original Chat session.

**Why:** The project journey confirmed that the active-Mission polling is expected and that the original Chat handoff works. Changing the cadence or navigation state to eliminate repeated requests could leave Mission status stale or break the verified return path.

**How to apply:** When investigating repeated Mission requests, distinguish active-projection polling from accidental duplicate subscriptions. Do not remove or slow the polling without a product decision and regression coverage for Mission freshness and return to the original Chat.

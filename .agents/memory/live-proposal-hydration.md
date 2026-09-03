---
name: Live proposal hydration
description: Prevents a just-completed AI change proposal from disappearing during session-query hydration.
---

When a chat stream returns a pending change proposal, the dashboard must keep that proposal visible while the session-scoped pending-proposal query catches up. An initial empty query result is not authoritative if the live stream has already supplied a proposal identity; the server response becomes authoritative after the proposal is rejected, applied, or successfully hydrated.

**Why:** Newly-created sessions can briefly return an empty pending-proposal response while the streamed completion has already reached the browser. Treating that transient empty response as final removes the approval and rejection controls from the UI.

**How to apply:** Keep a short-lived live-proposal marker tied to the streamed proposal identity, invalidate the session-scoped query after stream completion, and clear the marker when the proposal is rejected or fully applied.
---
name: Dashboard journey stream fixtures
description: Browser journey fixtures for multipart uploads and task-log SSE need durable response and rendered-activity assertions.
---

The dashboard journey should validate multipart upload bytes in the browser request and assert the resulting task-log message in the Activity region. A fulfilled SSE response can transition the connection indicator to reconnecting when the fixture closes, so the received activity is the stable success signal.

**Why:** EventSource treats a one-shot fixture response as a closed stream even after delivering valid events; asserting only the transient Connected/Live updates label makes a valid rendered update look like a failure.

**How to apply:** Keep upload assertions focused on the browser’s real FormData payload and response envelope, and assert live delivery through the durable rendered log content.

Automatic reconnect may reuse only a resume token already received and held by the client. If the token is missing, capability retrieval and persistence must wait for the user's explicit recovery action.

**Why:** Claiming a missing opaque capability can initiate recovery, so doing that automatically would cross the user's consent boundary.

**How to apply:** Token-bearing stream failures may reconnect automatically. For tokenless recovery, assert no capability request before the button click, then verify one request, persisted token, and the resumed result. Match the current recovery card rather than legacy paused copy.

Provider-backed browser journeys should inspect the completed chat SSE before waiting on downstream controls. Persist only bounded error fields and, when the stream completes without an error, a small UI-state summary if the next action is missing.

**Why:** A terminal provider error or missing handoff control can otherwise surface later as an unrelated UI timeout; raw stream text may contain prompts and provider diagnostics.

**How to apply:** Capture the response before sending, wait for stream completion, extract only error code/category, retryability, rate-limit scope/delay, and session-event presence. Stop immediately on a terminal error, and use a short timeout with sanitized state for missing controls.
---
name: Dashboard journey stream fixtures
description: Browser journey fixtures for multipart uploads and task-log SSE need durable response and rendered-activity assertions.
---

The dashboard journey should validate multipart upload bytes in the browser request and assert the resulting task-log message in the Activity region. A fulfilled SSE response can transition the connection indicator to reconnecting when the fixture closes, so the received activity is the stable success signal.

**Why:** EventSource treats a one-shot fixture response as a closed stream even after delivering valid events; asserting only the transient Connected/Live updates label makes a valid rendered update look like a failure.

**How to apply:** Keep upload assertions focused on the browser’s real FormData payload and response envelope, and assert live delivery through the durable rendered log content.

Recovery assertions should follow the current user-visible state and the explicit consent boundary: a saved execution card is the stable paused-state contract, while a missing resume capability is fetched and persisted only after the user presses Resume.

**Why:** The recovery UI intentionally avoids passively claiming a new opaque token during reload; exact legacy paused copy and pre-click token assertions can fail even when the resume flow is correct.

**How to apply:** Assert the rendered saved-execution card, click its Resume action, then verify the recovered token and resumed result. Avoid treating provider availability or transient stream labels as the browser contract.
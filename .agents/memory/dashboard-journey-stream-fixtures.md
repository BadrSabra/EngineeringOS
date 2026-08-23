---
name: Dashboard journey stream fixtures
description: Browser journey fixtures for multipart uploads and task-log SSE need durable response and rendered-activity assertions.
---

The dashboard journey should validate multipart upload bytes in the browser request and assert the resulting task-log message in the Activity region. A fulfilled SSE response can transition the connection indicator to reconnecting when the fixture closes, so the received activity is the stable success signal.

**Why:** EventSource treats a one-shot fixture response as a closed stream even after delivering valid events; asserting only the transient Connected/Live updates label makes a valid rendered update look like a failure.

**How to apply:** Keep upload assertions focused on the browser’s real FormData payload and response envelope, and assert live delivery through the durable rendered log content.
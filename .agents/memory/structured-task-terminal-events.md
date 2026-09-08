---
name: Structured task terminal events
description: Terminal-event semantics for Analyze/Review SSE streams and their reload behavior
---

Structured Analyze/Review streams use `task_done`, not the generic chat `done`, as their successful terminal frame. Any shared SSE parser must mark `task_done` terminal before evaluating EOF, and the task hook must ignore a reset after any terminal callback.

**Why:** A clean connection close after a successful structured task otherwise produces a second local transport failure, making a valid result appear interrupted.

**How to apply:** When adding structured task event types or reconnect handling, test the complete `task_started → task_done → EOF` sequence and the history-reload retry path, not only direct callback delivery.
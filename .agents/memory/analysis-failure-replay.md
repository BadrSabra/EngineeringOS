---
name: Analysis failure replay
description: Required analysis tool failures must remain terminal and visibly incomplete across stream reconnects and dashboard history reloads.
---

Required analysis failures must be persisted as failed assistant turns and failed durable executions, carrying only a safe diagnostic and bounded trace. The success/final-proof path must be skipped.

**Why:** A blocked-looking model response can otherwise be stored as successful and later rendered as completed after a reconnect or reload.

**How to apply:** Treat the terminal tool-failure event as authoritative at the stream boundary; preserve its safe diagnostic in the message and execution checkpoint, and suppress completion proof UI for failed turns.
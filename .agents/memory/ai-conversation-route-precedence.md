---
name: AI conversation route precedence
description: Precedence and fail-closed behavior when opening AI sessions from execution-linked deep links.
---

An explicit project/session deep link represents the user's intended conversation and takes precedence over a locally remembered execution pointer for a different session. Do not silently fall back to the saved conversation when the explicit target is unavailable.

**Why:** A stale local execution pointer can make an otherwise valid return link appear to open the wrong conversation, or prevent the explicit route from taking effect.

**How to apply:** Keep the prior session's persisted execution intact, validate the target session against the project's server-owned session list, and show an unavailable state instead of rendering an unrelated session when validation fails.
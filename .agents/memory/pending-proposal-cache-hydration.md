---
name: Pending proposal cache hydration
description: Session-scoped local cache restoration and live stream proposal continuity.
---

When a stream completion assigns a session and its proposal together, missing or stale local storage must not erase the server-delivered in-memory proposal. Hydration effects should be keyed to session/project identity, not to state that the same effect replaces with a fresh empty value.

**Why:** The terminal stream callback can transition the session and pending proposal in one render. Treating absent local storage as authoritative erased that current proposal; depending on the overwritten state also caused the restore effect to loop.

**How to apply:** For persisted UI state restored asynchronously during session or stream transitions, prefer a matching live server proposal over an empty cache, and cover empty-cache, stale-cache, and refresh cases.

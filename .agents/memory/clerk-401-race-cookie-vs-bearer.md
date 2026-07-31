---
name: Silent API failure that looked like Clerk auth but was ETag/304 caching
description: A "session expired" / 401-looking failure on a signed-in page turned out to be Express's default ETag causing a bodyless 304, not an auth bug at all.
---

Symptom: a signed-in page's own `fetch()` to a protected endpoint appeared to
fail with no visible error (frontend silently rendered a failure state as
"no data"). It looked exactly like an intermittent Clerk session/401 problem
because the UI's generic error state didn't distinguish HTTP status codes.

**Real root cause:** Express auto-generates an `ETag` for every JSON response
by default. A client (or intermediate proxy/dev-preview layer) that had
previously cached the response sends a conditional `If-None-Match` on a later
request; the server correctly replies `304 Not Modified` with an empty body.
`fetch()`'s `response.ok` is `false` for 304 (only 2xx is ok), so generic
"`if (!res.ok) throw`" client code treats a normal cache-validation response
as a hard failure. `Cache-Control: no-store` on the response does **not**
retroactively invalidate an already-cached entry from before the header was
added — the stale cached copy (with its ETag) keeps getting revalidated.

**Why it's easy to misdiagnose as auth:** the failure mode (silent, generic
"couldn't load" UI, no obvious network-tab distinction unless you check the
actual status code) looks identical to a real 401/expired-session bug. Do not
assume auth just because the page is "signed in but broken" — check the
actual HTTP status of the failing request first.

**How to apply:** for any dynamic, per-user JSON API, disable ETag generation
entirely (`app.disable("etag")` in Express) in addition to setting
`Cache-Control: no-store` — the two together are what actually stops both
future caching and any lingering conditional-GET/304 responses from a
previously cached copy. Check response status codes in server logs before
theorizing about auth, sessions, or race conditions.

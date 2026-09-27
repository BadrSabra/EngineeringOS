---
name: Bodyless JSON POST validation
description: Keep bodyless generated-client requests compatible with optional JSON validation in Express routes.
---

When an OpenAPI operation has no `requestBody`, its generated client sends a POST without JSON. Express's JSON parser can leave `req.body` undefined. If the endpoint's default behavior is valid and all JSON fields are optional, validate `req.body ?? {}` and keep a route-level test that omits `.send()`.

**Why:** Parsing `undefined` as a Zod object rejects the generated client's valid bodyless request before the route can apply its documented default.

**How to apply:** Preserve bodyless semantics for optional request bodies. If the endpoint is meant to require JSON, add a request-body schema to OpenAPI and regenerate the client rather than relying on undocumented client headers.
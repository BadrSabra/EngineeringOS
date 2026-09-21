---
name: OpenRouter provider activation
description: Replit-managed OpenRouter provisioning may be blocked by account status; the app supports a server-side OPENROUTER_API_KEY fallback.
---

When managed OpenRouter provisioning is unavailable, use the project's existing server-side OpenRouter credential path rather than changing the provider implementation. A restarted API validates the credential through the live model catalog before accepting traffic.

**Why:** The imported EngineeringOS app already resolves OpenRouter through its own credential store/environment and performs a startup catalog check; adding a second client integration would bypass its routing and lifecycle controls.

**How to apply:** Prefer Replit-managed OpenRouter when provisioning succeeds. If it is blocked by account status, request `OPENROUTER_API_KEY` through the secrets flow, restart the API, and confirm the startup validator reports the provider as healthy.
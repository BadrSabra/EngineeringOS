---
name: Release CORS harness
description: Constraints for launching the provider-free API listener used by release CORS checks.
---

The provider-free release API harness should use Node's tsx loader with an eval module, but must not pass `--input-type=module`; that flag is inherited by the loader worker and causes `ERR_INPUT_TYPE_NOT_ALLOWED`.

**Why:** The release contract needs to start the real API listener without Clerk or a live AI provider, and the loader worker rejects the redundant input-type flag.

**How to apply:** Launch the source app with `node --import tsx/esm --eval` and bind an isolated loopback port, then probe the listener directly rather than routing through the dashboard proxy.
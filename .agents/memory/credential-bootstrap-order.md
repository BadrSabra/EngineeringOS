---
name: Credential bootstrap order
description: Startup ordering for encrypted AI provider credentials and background catalog refresh.
---

The persisted AI credential encryption key must be initialized before starting any background work that may decrypt stored provider credentials.

**Why:** A scheduler that starts first can race the key bootstrap and report a false decryption/configuration failure even though the credential is valid and the key is created moments later.

**How to apply:** Keep encryption-key initialization ahead of catalog refresh, provider validation, and other asynchronous startup jobs that read encrypted AI credentials.
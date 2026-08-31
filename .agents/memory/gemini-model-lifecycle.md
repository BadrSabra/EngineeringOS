---
name: Gemini model lifecycle
description: How to keep Gemini credentials usable when Google retires model slugs.
---

Gemini API-key validation does not guarantee that the configured default model is
available to the account. Google may retire older models or restrict them for
new users while still accepting the credential.

**Why:** A valid Gemini key initially failed real completions because the
configured 2.x model was no longer available; a current 3.x flash model
completed successfully.

**How to apply:** When enabling or releasing Gemini, validate the actual default
model with one authenticated completion and update both fast and powerful
defaults together when the provider reports model lifecycle drift.
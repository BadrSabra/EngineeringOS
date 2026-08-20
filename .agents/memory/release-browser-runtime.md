---
name: Release browser runtime
description: Release Playwright jobs need browser binaries and native runtime libraries in addition to the Node dependency.
---

The dashboard release browser job must provision both Playwright Chromium and
its native runtime libraries before launching tests; a downloaded browser alone
can still fail before Clerk setup when shared libraries are absent.

**Why:** The release workflow reached its health checks but Chromium repeatedly
failed at process startup on the Nix environment while libraries were missing.

**How to apply:** Keep browser installation and the Nix runtime package set in
the release environment, and diagnose browser process startup before debugging
the Clerk journey itself.

Playwright video capture also requires a separately downloaded ffmpeg helper;
release validation should retain trace and screenshot artifacts without making
that optional download a prerequisite.

**Why:** A clean runner had Chromium available but failed before test startup
because `video: "retain-on-failure"` triggered a missing Playwright ffmpeg
binary.

**How to apply:** Prefer `video: "off"` for managed release smoke tests unless
the runner explicitly provisions Playwright's ffmpeg helper.
---
name: Playwright on Replit Nix
description: Runtime library setup needed for bundled Chromium in shell-based tests.
---

A Playwright browser download does not guarantee Chromium can start in Replit shell tests. The binary may fail with missing shared libraries even when the matching Nix packages are listed in `.replit`, because the test process does not inherit a library search path.

**Why:** the browser binary was available, but tests only launched successfully inside a Nix shell that exported `LD_LIBRARY_PATH` from the needed package libraries.

**How to apply:** keep the required Nix dependencies available, run the test command inside a Nix environment that sets `LD_LIBRARY_PATH` with `lib.makeLibraryPath`, and verify the exact browser test before rerunning the full suite.

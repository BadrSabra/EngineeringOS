---
name: Playwright on Replit Nix
description: Runtime library setup required for Playwright browser binaries in Replit Nix tests.
---

A Playwright browser download does not guarantee Firefox or Chromium can start in Replit shell tests. The browser may fail with missing shared libraries even when the matching Nix packages are listed in `.replit`, because the test process does not inherit a library search path.

**Why:** the browser binary was available, but tests only launched successfully when the test process received `LD_LIBRARY_PATH` built from the needed Nix package libraries.

**How to apply:** keep the required Nix dependencies available, derive `LD_LIBRARY_PATH` with `lib.makeLibraryPath` for the browser-test process only, and verify that the browser launches before rerunning the full suite. Do not set a fixed store path globally for application workflows.

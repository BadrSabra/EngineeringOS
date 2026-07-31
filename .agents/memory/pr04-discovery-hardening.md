---
name: Discovery resolution hardening (PR-04)
description: Security constraints added to the discovery pipeline — URL scheme whitelist, credential redaction, symlink resolution in path validation.
---

# Discovery resolution hardening

## URL scheme whitelist for GIT_REPOSITORY
`validate()` in `gitRepositoryAdapter` now rejects any URL not starting with `https://` or `http://`.

**Why:** `file:///home/runner/workspace` is a valid git clone URL. Without the check a caller could clone a local path that bypasses LOCAL_FOLDER path-boundary rules. The clone lands in `/tmp/eos-git-<uuid>` (always validated as safe), so the symlink/depth checks never see the real source.

**How to apply:** Any new source adapter that calls `git clone` must apply the same scheme whitelist in its `validate()` method, not in `resolve()`. Rejecting early avoids allocating a temp dir.

## Credential redaction from git clone errors
`execFileAsync` on failure includes the full command string in `err.message`. When credentials are injected into the URL (`https://user:token@host/repo`), the token appears in plain text in the error that gets returned to the client and written to logs.

**Why:** Tokens returned in HTTP responses or logged are a credential leak.

**How to apply:** Use `redactUrlCredentials(text)` (defined in `discovery-adapters.ts`) on any string derived from `err.message` before surfacing it. Pattern: `text.replace(/https?:\/\/[^@\s"']+@/g, "https://[credentials-redacted]@")`.

## validateRootPath is now async
`validateRootPath(path)` returns `Promise<string | null>`. All call sites must `await` it. The function uses `realpath()` to resolve symlinks before running string-based boundary checks.

**Why:** A symlink at `/home/runner/workspace/evil-link → /etc` passes all `startsWith`/`has` string checks but its resolved path is `/etc` which fails the depth rule (1 segment) and/or the exact-match block list.

**How to apply:**
- `realpath()` failure (non-existent path) falls through — lexical path checked, downstream `stat()` surfaces ENOENT.
- The EOS_GIT_TEMP_PREFIX bypass (Rule 0) still fires before `realpath()`, so temp dirs are not penalised.
- Tests for `validateRootPath` must be `async` functions and `await` the call.

## Dead `cleanup` method removed
The standalone `cleanup(tempDir)` method on `gitRepositoryAdapter` was dead code — the route always uses `cleanupResolveResult(resolved)` which calls the `cleanup` hook on `ResolveSuccess`, not the adapter method. Removed to avoid confusion.

---
name: Candidate validation boundary
description: Delivery validation must target the exact immutable candidate that will be promoted.
---

The isolated delivery workspace, its changeset hash, validation evidence, and promoted bytes must form one integrity chain; validating the live root after creating a candidate is not evidence about the candidate.

**Why:** A guarded apply can otherwise report a successful check for a different tree than the artifact being delivered, while sequential promotion can still leave partial state after a crash.

**How to apply:** Any future apply, repair, browser, commit, or recovery work must bind the validator to the operation workspace and content hash before promotion, then make interruption resolve to a terminal known state.

Preflight against the live root must be read-only; create missing parent directories only inside the guarded promotion after the live-root drift baseline is captured.

**Why:** Creating an otherwise empty parent during preflight changes the live tree digest and can falsely look like an external edit, blocking a valid candidate before promotion.

**How to apply:** Resolve existing path components and symlinks without `mkdir`; perform directory creation as part of the serialized, rollback-covered promotion.

Intermediate delivery states are not direct apply permissions: `isolated`, `abandoned`, and unknown `conflicted` states require recovery validation; a conflicted retry is allowed only when the apply journal proves it was blocked before promotion or rolled back cleanly.

**Why:** A pending proposal can survive a process crash after live-root promotion has started, and replaying it without durable stage evidence can duplicate or overwrite an uncertain delivery.

**How to apply:** Gate every apply retry on the persisted lifecycle and latest proposal-scoped journal stage; keep no-promotion blocked results retryable, but fail closed for missing, promoted, or rollback-failed evidence.

Benchmark runners must treat the candidate SHA as immutable input and keep runner/control changes separate; comparing the approval pin to `main` itself is self-referential, while an allowlisted control-only delta can be verified before materializing the pinned tree.

**Why:** Updating a pin changes the branch SHA, so exact equality with the branch head makes the next validation stale by construction; using the mutable checkout can also make evidence describe code other than the approved candidate.

**How to apply:** Verify the approved commit exists and is an ancestor of the control branch, reject tracked or untracked workspace changes outside explicit runner-only paths, archive the approved commit into a disposable realpath-checked root, and bind run receipts to that commit.

Blocked benchmark runs must retain the same server-owned source revision and candidate hash as successful runs, including when no case observation was produced.

**Why:** An empty preflight result can still be cited later; if its envelope drops candidate identity, the failure cannot be reliably attributed to the exact code that was gated.

**How to apply:** Populate identity fields from the runner’s immutable inputs in every early-return path, and assert the fields on blocked and completed receipts.

Disposable validation copies must exclude TypeScript incremental build metadata whenever generated outputs are omitted, and must recreate package-local dependency links while pointing workspace-package links back into the candidate copy.

**Why:** Stale `.tsbuildinfo` can make a clean build skip missing declarations; missing package-local dependencies can hide required types or resolve workspace packages from the live tree instead of the candidate.

**How to apply:** Exclude every `*.tsbuildinfo` file from candidate copies, rebuild root and package dependency overlays from installed modules, and verify the copy with a clean full-workspace typecheck under bounded budgets long enough for that check.

Candidate dependency overlays must keep each `.bin` directory inside the candidate and remap only workspace packages that exist in the copy. Omit installed-but-unrepresented `@workspace` links; fail closed when a manifest-declared workspace dependency is missing from the candidate.

**Why:** Package managers can resolve a symlinked `.bin` back to the live project and add that path to validator `PATH`. A global installation can also contain workspace links unrelated to a minimal candidate fixture.

**How to apply:** Materialize root and package-local `.bin` directories, link their command entries to installed dependency tools, and derive required workspace links from the candidate manifests before validation.
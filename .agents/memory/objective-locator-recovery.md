---
name: Objective locator recovery
description: Constraint for recovering bounded evidence windows when a later required source read is truncated
---

For a declared objective, bounded evidence recovery must have a server-owned locator for every required evidence path before relying on a provider-selected read. A first-evidence prefetch for only one path is insufficient: a later full read can be truncated, leave no retained body, and make the bounded window unavailable even when the source contains valid claim needles. Claims spanning multiple files must also declare path-scoped needles; applying every symbol to every path makes valid bounded windows impossible. The same applies to runtime-edge proof: a complete targeted window is not enough when the verifier requires the caller's function body; each required edge needs a server-owned full caller body plus a retained read from that caller file.

**Why:** A real embedded-AI audit reached the route and tool loop correctly, but the later agent source was read through the provider as a truncated full file. Recovery had no server-owned locator body for that path, so it fail-closed before dispatching a claim window. This is an evidence-acquisition failure, not an acceptance or identity failure.

**How to apply:** Before or at the first truncated read of each required path, obtain server-owned locator data (prefer bounded line discovery over accepting a full body), then dispatch only the computed `read_file_range` window into accepted evidence. For reachability edges, use the server-owned full body only to bind the caller AST and direct call, and require a retained read from the same caller file before closing the edge. Keep locator data separate from retained/accepted proof and preserve the no-head-fallback rule.
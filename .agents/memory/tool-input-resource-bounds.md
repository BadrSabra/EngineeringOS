---
name: Tool input resource bounds
description: Resource limits for grep-compatible source search and provider-supplied tool arguments.
---

Keep `search_code` grep-compatible by passing bounded file bytes through stdin to a fixed `grep` argv; do not interpolate patterns into a shell command or switch to JavaScript regex semantics. If any scan, read, time, or output budget is reached, mark the result incomplete.

Reject oversized raw tool-argument JSON before parsing it, and place only a safe placeholder in conversation history. The 2 MB cap preserves valid maximum-sized `replace_text` inputs even when JSON escaping expands control characters.

**Why:** `replace_text` permits two 128 KB text fragments. Worst-case JSON escaping can expand each control character to a six-byte escape, so a smaller raw cap could reject a schema-valid maximum edit. Rejected provider payloads should not be parsed, replayed, or retained in conversation history.

**How to apply:** At provider/tool boundaries, check UTF-8 byte length before `JSON.parse`, keep caps compatible with the worst-case encoded size of allowed inputs, and return a bounded terminal diagnostic without storing raw rejected arguments. Preserve grep's regular-expression semantics while enforcing source-search budgets.

Validate parsed arguments against the authoritative tool schema before cache or replay lookups. Preserve JSON scalar types until validation, including for server-generated tool calls; normalize to handler-facing strings only afterward.

**Why:** Cache hits can bypass the normal dispatcher, and converting numbers to strings before validation rejects valid schema inputs while allowing invalid inputs to collide with valid cache keys.

**How to apply:** Preflight the original parsed value before any cache/replay shortcut, skip those shortcuts for invalid arguments, and keep synthetic tool-call arguments schema-typed through dispatch.
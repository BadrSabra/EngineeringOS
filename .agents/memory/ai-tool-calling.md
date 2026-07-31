---
name: AI Tool Calling Architecture
description: File-system tool calling in the chat agent — tool definitions, execution, and safe deferred writes.
---

## Architecture

### Tools — `lib/ai-orchestrator/src/tools/file-tools.ts`
- `read_file` — reads up to 80KB; path must stay inside rootPath
- `list_directory` — lists dir contents; skips node_modules/dist/.git
- `search_code` — grep wrapper; max 50 lines, 5 matches per file
- `write_file` — NEVER writes immediately; pushes a `PendingChange` and returns a confirmation string

### Groq client — new `completeRaw()` alongside existing `complete()`
- Accepts `tools?: ToolDefinition[]` in opts
- Returns `{ content, toolCalls, model, usage }` — toolCalls is null for final text answers
- Uses `any` cast for the request body to avoid SDK union-type conflicts

### Chat agent — agentic loop (max 6 iterations)
- Tools activated only when `rootPath` is provided
- Switches to `MODEL_POWERFUL` (70b) when tools are active — 8b is too unreliable for tool calling
- `pendingChanges` accumulated across all iterations, returned in `ChatOutput`

### API route — `POST /api/ai/chat/apply-changes`
- Re-validates each path against project rootPath before writing (frontend approval is UX, not security)
- Records audit event after successful writes
- Returns 207 if some writes fail

### Frontend — `PendingChangesCard`
- Shows file path, reason, line count delta, expandable code preview
- Apply/Reject buttons; cleared on session switch
- `pendingChanges` state is ephemeral — not stored in DB

**Why:** write_file must never be immediate — unreviewed AI writes to source code are a correctness/security risk.
**How to apply:** add new tools to FILE_TOOL_DEFINITIONS + a case in executeFileTool. rootPath is auto-passed by the route.

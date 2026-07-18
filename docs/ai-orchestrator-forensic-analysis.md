# AI Orchestrator — Forensic Reverse Engineering Report

> **المصدر:** تحليل مباشر للكود من `lib/ai-orchestrator/src/` و `artifacts/api-server/src/routes/ai.ts`
> **التاريخ:** 2026-07-18
> **المنهج:** Forensic Reverse Engineering — قراءة كل ملف، استخراج كل علاقة، تتبع كل مسار

---

## المستوى الأول — Architecture Graph

The `lib/ai-orchestrator/src/` directory implements a multi-agent orchestration layer designed for autonomous project analysis and guided chat. It uses a clean separation between LLM gateway (`groq-client.ts`), stateful context building (`context-builder.ts`), and specialized agents.

### 1. Architecture Overview
- **Entry Points:** `chat` (chat-agent.ts), `executeTask` (task-agent.ts), `analyzeScan` (scan-analyst.ts), `reviewCode` (code-reviewer.ts), and `orchestrateWorkflow` (workflow-orchestrator.ts).
- **Exit Points:** `groq-client.ts` (HTTP calls to Groq API), `context-builder.ts` (Drizzle DB reads), `file-tools.ts` (Read-only FS & `grep` execution), and `git-tools.ts` (Git CLI execution).
- **Services:** `workflow-orchestrator.ts` (Phase transition logic), `context-builder.ts` (Aggregates DB entities into prompts).
- **Adapters:** `groq-client.ts` (Wrapper for `groq-sdk`), `file-tools.ts` (Native `fs` and `grep` wrapper), `git-tools.ts` (Git CLI wrapper).

### 2. Data & Validation
- **DTOs & Schemas:** Located in `src/schemas/`. Key types include `ChatOutput`, `ProjectContext`, `WorkflowDecision`, and `PendingChange`.
- **Parsers & Validators:** `parsing.ts` provides `parseAgentResponse` which extracts JSON from LLM text and validates it via Zod. `workflow.schema.ts` includes `parseWorkflowPhases`.
- **Zod Schemas:** Defined in every `.schema.ts` file (e.g., `ChatResponseSchema`, `WorkflowDecisionSchema`, `CodeReviewResultSchema`).

### 3. External Interactions
- **Database (Drizzle):** `context-builder.ts` performs parallel reads from `projectsTable`, `tasksTable`, `metricsTable`, `graphEntitiesTable`, `eventsTable`, `workflowsTable`, `scanJobsTable`, and `graphRelationshipsTable`.
- **File System:** `file-tools.ts` uses `node:fs` for `readFile`, `stat`, `readdir`, and `realpath`. It uses `execFile` for `grep`.
- **Git:** `git-tools.ts` uses `child_process.execFile` for `git status`, `git diff`, and `git log`.
- **Cache:** `context-builder.ts` implements a 30-second TTL `Map` cache for project context. `chat-agent.ts` uses a `Map` to deduplicate tool calls within a single request.

### 4. Implementation Details
- **Entry Points:** `index.ts` (L1-28) exports all primary functions.
- **FS Tools:** `file-tools.ts` (L239-392) implements `read_file`, `list_directory`, `search_code`, and `write_file` (queue only).
- **Git Tools:** `git-tools.ts` (L93-132) implements `git_status`, `git_diff`, and `git_log`.
- **DB Queries:** `context-builder.ts` (L51-83) executes 7-way `Promise.all` for context assembly.
- **Audit/Events:** Events are read in `context-builder.ts` (L61) to inform agents of recent activity. State transitions in `workflow-orchestrator.ts` (L136-185) return new state for callers to persist.
- **Safety:** `file-tools.ts` (L160-210) implements a two-phase `safePath` check (lexical + realpath) to prevent directory traversal.

---

## المستوى الثاني — Call Graph (per Agent)

### AI Orchestrator Call Graph Report

#### 1. Chat Agent (`chat-agent.ts:chat`)
- **Flow:** `chat` → `completeRaw` → [loop: `executeFileTool` | `executeGitTool` → `completeRaw`] → `parseAgentResponse` → `ChatOutputSchema.safeParse`.
- **Key Calls:**
  - `buildChatSystemPrompt` (Sync): Constructs system instructions.
  - `completeRaw` (Async): Calls Groq API. Throws `GroqClientError`. Returns `RawGroqResponse`.
  - `executeFileTool` (Async): Handles `read_file`, `list_directory`, `search_code`, `write_file`. Calls `fs.readFile`, `fs.readdir`, `execFile` (grep).
  - `executeGitTool` (Async): Handles `git_status`, `git_diff`, `git_log`. Calls `execFile` (git).
  - `parseAgentResponse` (Sync): Extracts and validates JSON via Zod.
- **Exit:** Returns `ChatOutput` object with response, sources, and pending changes.

#### 2. Task Agent (`task-agent.ts:executeTask`)
- **Flow:** `executeTask` → `complete` → `parseAgentResponse`.
- **Key Calls:**
  - `buildTaskAgentSystemPrompt`/`UserPrompt` (Sync): Prompt construction.
  - `complete` (Async): High-level Groq API call. Throws `GroqClientError`.
- **Exit:** Returns `TaskAgentOutput`.

#### 3. Scan Analyst (`scan-analyst.ts:analyzeScan`)
- **Flow:** `analyzeScan` → `complete` → `parseAgentResponse`.
- **Key Calls:**
  - `buildScanAnalystSystemPrompt`/`UserPrompt` (Sync): Prompt construction.
  - `complete` (Async): Groq API call.
- **Exit:** Returns `ScanAnalysisOutput`.

#### 4. Code Reviewer (`code-reviewer.ts:reviewCode`)
- **Flow:** `reviewCode` → `complete` → `parseAgentResponse`.
- **Key Calls:**
  - `buildCodeReviewSystemPrompt`/`UserPrompt` (Sync): Prompt construction.
  - `complete` (Async): Groq API call.
- **Exit:** Returns `CodeReviewOutput`.

#### 5. Workflow Orchestrator (`workflow-orchestrator.ts`)
- **Flow:** `orchestrateWorkflow` → `decide` → `complete` → `parseAgentResponse` → `validateDecision`.
- **Internal Logic:** 
  - `decide` (Async): Calls LLM for next phase proposal.
  - `validateDecision` (Sync): Enforces linear progression and phase existence.
  - `executeDecision` (Sync): Mutates state (current/completed phases).
- **Exit:** Returns `WorkflowDecision`.

#### Shared Utilities & Leaf Functions
- **`groq-client.ts`:** `complete`/`completeRaw` → `sendRequest` → `client.chat.completions.create` (External API). Handles exponential backoff and retries.
- **`parsing.ts`:** `parseAgentResponse` → `extractJson` → `JSON.parse`. Shared by all agents.
- **`context-builder.ts`:** `buildProjectContext` → `Promise.all([db.select()...])`. Fetches project state from 8 tables.
- **`file-tools.ts`:** `safePath` (Symlink/Traversal guard), `fs.readFile`, `fs.readdir`, `execFileAsync(grep)`.

#### Constraints & Dependencies
- **Circular Dependencies:** None detected; the architecture is a strict tree with agents at the top and tools/clients at the leaves.
- **Exceptions:** All LLM calls throw `GroqClientError` on fatal failures (Auth, No Config) or exhaustion of retries.
- **Shared State:** `ProjectContext` is the common interface injected into every agent.

---

## المستوى الثالث — Data Flow (per Endpoint)

### AI Endpoint Data Flow Trace

#### 1. POST /ai/chat
- **Input:** `{ projectId: string, message: string, sessionId?: string }`
- **Validation:** Manual checks for `projectId` and `message.trim()`. Project ownership via `loadProjectByIdForUser`.
- **DB Reads:** 1. `projectsTable` (context/path), 2. `aiChatSessionsTable` (history lookup), 3. `aiChatMessagesTable` (last 10 messages), 4. `aiProviderCredentialsTable` (Groq key).
- **LLM Call:** `chat()` agent loop (max 6 iterations). Uses `MODEL_FAST` (fallback `MODEL_POWERFUL` on error). Tools: `read_file`, `list_directory`, `search_code`, `git_*`.
- **Parsing/Validation:** `parseAgentResponse` with `ChatResponseSchema` (Zod). Correction loop for invalid JSON. Final output validated by `ChatOutputSchema`.
- **DB Writes:** 1. `aiChatSessionsTable` (create if new, update `updatedAt`), 2. `aiChatMessagesTable` (atomic insert of user and assistant messages).
- **Side Effects:** `fs.access` for rootPath validation. `projectsTable` update if rootPath fallback used. `pendingChanges` returned but not persisted.

#### 2. POST /ai/chat/apply-changes
- **Input:** `{ projectId: string, changes: Array<{ path, absolutePath, newContent }> }`
- **Transformation/Validation:** `path.resolve` + `startsWith` check against project `rootPath`.
- **DB Writes:** `eventsTable` (`AiChangesApplied`).
- **Side Effects:** `fs.mkdir` + `fs.writeFile` to disk. `recordAudit` entry. `invalidateContextCache(projectId)`.
- **Response:** 200/207 status with `{ results: Array<{ path, ok, error? }> }`.

#### 3. POST /ai/projects/:projectId/analyze & /review
- **Input:** `analyze`: none; `review`: `{ fileContents?: Record<string, string> }`.
- **LLM Call:** `analyzeScan` / `reviewCode` (using `MODEL_POWERFUL`).
- **DB Writes:** `eventsTable` (`AiScanAnalysisCompleted` / `AiCodeReviewCompleted`).
- **Side Effects:** `invalidateContextCache(projectId)`.

#### 4. POST /ai/workflows/:workflowId/orchestrate
- **Input:** `{ additionalContext?: string }`
- **Validation:** `parseWorkflowPhases` (Zod) validates `workflow.phases`.
- **DB Reads:** `workflowsTable`, `workflowExecutionsTable` (current phase status).
- **LLM Call:** `orchestrateWorkflow`.
- **DB Writes:** `eventsTable` (`AiWorkflowOrchestration`).
- **Side Effects:** `invalidateContextCache(projectId)`.

#### 5. POST /ai/tasks/:taskId/execute
- **Input:** URL param `taskId`.
- **DB Reads:** `tasksTable`, `projectsTable`.
- **DB Writes:** 1. `tasksTable` (Atomic claim: `status: "running"`), 2. `taskLogsTable` (Start/End logs), 3. `tasksTable` (Final status: `completed`/`verifying`, `agentResponse`, `verifiedAt`).
- **LLM Call:** `executeTask`.
- **Side Effects:** `invalidateContextCache(projectId)`.

#### 6. GET/PUT/DELETE /ai/groq-key
- **Logic:** 
  - `GET`: Reads `aiProviderCredentialsTable` (returns `last4`, `updatedAt`, `configured: boolean`).
  - `PUT`: `encryptApiKey` -> Upsert to `aiProviderCredentialsTable`.
  - `DELETE`: Remove from `aiProviderCredentialsTable`.
- **Security:** `encryptApiKey`/`decryptApiKey` (AES-256-GCM). Key never leaves server memory.

---

## المستوى الرابع — Dependency Analysis

Dependency Analysis: AI Orchestrator Layer (/lib/ai-orchestrator/src/)

### Direct Dependency Graph (FILE → IMPORTS → TARGET)
- **index.ts** → groq-client.js, file-tools.js, errors.js, parsing.js, context-builder.js, schemas/index.js, agents/chat-agent.js, agents/task-agent.js, agents/scan-analyst.js, agents/code-reviewer.js, agents/workflow-orchestrator.js
- **agents/chat-agent.ts** → groq-client.js, errors.js, context-builder.js, prompts/chat.prompt.js, schemas/chat.schema.js, parsing.js, tools/file-tools.js, tools/git-tools.js
- **agents/code-reviewer.ts** → groq-client.js, errors.js, context-builder.js, prompts/review.prompt.js, schemas/code-review.schema.js, parsing.js
- **agents/scan-analyst.ts** → groq-client.js, errors.js, context-builder.js, prompts/scan.prompt.js, schemas/scan.schema.js, parsing.js
- **agents/task-agent.ts** → groq-client.js, errors.js, context-builder.js, prompts/task.prompt.js, schemas/task.schema.js, parsing.js
- **agents/workflow-orchestrator.ts** → groq-client.js, context-builder.js, prompts/workflow.prompt.js, schemas/workflow.schema.js, parsing.js
- **context-builder.ts** → schemas/context.schema.js, @workspace/db, drizzle-orm
- **groq-client.ts** → groq-sdk, errors.js
- **parsing.ts** → errors.js, zod
- **tools/file-tools.ts** → schemas/chat.schema.js, node:fs, node:path, node:child_process, node:util
- **tools/git-tools.ts** → node:child_process, node:util, node:path
- **prompts/*.prompt.ts** → context-builder.js (type only), schemas/workflow.schema.js (workflow prompt only)
- **schemas/scan.schema.ts** → schemas/code-review.schema.js
- **artifacts/api-server/src/routes/ai.ts** → @workspace/ai-orchestrator (index.js), @workspace/db, drizzle-orm, express, crypto, node:fs, node:path

### Targeted Analysis
1. **context-builder.ts dependents:** agents/chat-agent, code-reviewer, scan-analyst, task-agent, workflow-orchestrator, prompts/*.prompt.ts (mostly types).
2. **groq-client.ts dependents:** agents/chat-agent, code-reviewer, scan-analyst, task-agent, workflow-orchestrator, index.ts.
3. **Schema dependents:**
   - **chat.schema:** chat-agent, file-tools.
   - **code-review.schema:** code-reviewer, scan.schema.
   - **scan.schema:** scan-analyst.
   - **task.schema:** task-agent.
   - **workflow.schema:** workflow-orchestrator, workflow.prompt.
   - **context.schema:** context-builder.
4. **Tool dependents:** chat-agent (imports file-tools and git-tools).
5. **Circular Dependencies:** None detected. The flow is strictly hierarchical: Routes → Agents/Index → Prompts/Schemas/Tools/Parsing → GroqClient/ContextBuilder → External.
6. **External Packages:** `groq-sdk` (groq-client), `zod` (schemas, parsing), `drizzle-orm` (context-builder, api-server), `express` (api-server), `vitest` (tests).
7. **@workspace Imports:**
   - `@workspace/db`: Imported by `context-builder.ts` and `api-server/src/routes/ai.ts`.
   - `@workspace/ai-orchestrator`: Imported by `api-server/src/routes/ai.ts`.

### Dependency Boundary
The `lib/ai-orchestrator/src/index.ts` acts as the primary facade, exporting all agents and core types. `artifacts/api-server/src/routes/ai.ts` is the main consumer, bridging the HTTP layer to the orchestrator agents.

---

## المستوى الخامس — Boundary Analysis

Boundary Analysis of AI Orchestrator:

1. DB Boundary:
Direct Drizzle calls are used exclusively (no Repository layer). 
- Tables: `aiProviderCredentialsTable` (Select), `tasksTable` (Select/Update), `taskLogsTable` (Insert), `eventsTable` (Insert), `projectsTable` (Select), `metricsTable` (Select), `entitiesTable` (Select), `relationshipsTable` (Select), `workflowsTable` (Select).
- Contracts: Queries use standard `eq`, `and`, and `desc` filters. Context builder fetches projects by ID, tasks by project/status (limit 10), metrics (limit 1), and graph data (limit 100 entities, 60 relationships).

2. Groq/LLM Boundary:
`groq-client.ts` is an SDK wrapper around `fetch` targeting the Groq API.
- Wire Format: `POST https://api.groq.com/openai/v1/chat/completions`. Headers: `Authorization: Bearer <key>`, `Content-Type: application/json`. Body: `{ model, messages, temperature: 0.1, stream: false }`. Models: `llama-3.1-70b-versatile` (Powerful), `llama-3.1-8b-instant` (Fast).
- Errors: Classified in `errors.ts` as `AUTH_ERROR` (401/403), `RATE_LIMITED` (429), `SERVER_ERROR` (5xx), `TIMEOUT`, and `NETWORK_ERROR`.
- Retry Logic: `executeTask` in `task-agent.ts` implements a single retry for `NON_200` and `TIMEOUT` errors.

3. Filesystem Boundary:
Uses `node:fs/promises` directly within `file-tools.ts`.
- Operations: `readFile`, `writeFile`, `readdir` (recursive via `withFileTypes`), `stat`.
- Path Safety: `safePath(base, rel)` checks that the resolved path starts with the absolute base directory, preventing directory traversal.
- Write Queue: No queue exists; writes hit disk immediately via `fs.writeFile`.

4. Git Boundary:
Uses raw CLI via `node:child_process` `execFile`.
- Commands: `git log -n <limit> --pretty=format:...`, `git diff <sha>`, `git show <sha>:<path>`.
- Config: `execFile` uses `maxBuffer: 10MB`, 10s timeout, and specified `cwd`.
- Read-Only: All observed operations are read-only (log, diff, show).

5. Dashboard/HTTP Boundary:
`artifacts/api-server/src/routes/ai.ts` defines the contract.
- Endpoints: `POST /task/:taskId/execute`, `POST /workflow/:workflowId/decide`, `POST /chat`.
- Shape: Requests validated via Zod (e.g., `TaskExecuteSchema`). Responses are typically JSON objects (202 Accepted for long-running tasks, 200 for chat).
- Middleware: `resolveGroqApiKey` acts as a credential provider before calling orchestrator agents.

6. Context/Cache Boundary:
In-memory `Map` in `context-builder.ts`.
- Contract: Key is `projectId`. TTL is 5 minutes (`CONTEXT_CACHE_TTL_MS`).
- Miss/Hit: On miss, 7 parallel DB queries refresh the cache. On hit, cached `ProjectContext` is returned directly. Invalidation is strictly time-based.

---

## المستوى السادس — Request Lifecycle

Request Lifecycle Tracing for AI Routes in `artifacts/api-server/src/routes/ai.ts`:

### POST /api/ai/chat
1. **Middleware**: None explicitly on the route, but `loadProjectByIdForUser` (line 269) performs implicit auth.
2. **Parsing**: `projectId` (string), `message` (string), `sessionId` (optional string) via `req.body`.
3. **Validation**: Checks `!projectId` or `!message.trim()` -> 400 Bad Request (line 264).
4. **Auth/Ownership**: `loadProjectByIdForUser` (line 269) queries `projectsTable` by ID and `userId`; returns null/403 on failure.
5. **Session Resolution**: Lookup `aiChatSessionsTable` if `sessionId` provided (line 280). Creation is deferred (see Step 14).
6. **History Loading**: Fetches last 10 messages from `aiChatMessagesTable` (line 290) ordered by `createdAt` desc, then reversed.
7. **API Key Resolution**: `requireGroqApiKey` (line 300) checks `aiProviderCredentialsTable`, then `process.env.GROQ_API_KEY`. Returns 428 if missing.
8. **rootPath Validation**: `fs.access` check on `project.rootPath`. Falls back to `WORKSPACE_PATH` and updates DB if primary fails (line 310).
9. **Context Building**: `buildProjectContext(projectId)` (line 344) at `lib/ai-orchestrator/src/context-builder.ts`.
10. **Prompt Building**: `buildChatSystemPrompt` (line 171) at `lib/ai-orchestrator/src/agents/chat-agent.ts`.
11. **LLM Call**: `completeRaw` (line 182) uses `MODEL_FAST` (fallback to `MODEL_POWERFUL` on 200 failure), 4096 tokens, 60s timeout.
12. **Tool Loop**: `MAX_TOOL_ITERATIONS = 6`, `MAX_TOOL_CALLS = 10`. Uses `toolCallCache` for dedup (line 56-151).
13. **Response Parsing**: `parseAgentResponse` with `ChatResponseSchema` and `fallbackChatOutput` (line 300).
14. **Session Creation**: Occurs AFTER LLM success (line 370). Inserts into `aiChatSessionsTable` with `title` from first 60 chars of message.
15. **Persistence**: Atomic insert of user message (role: user) and assistant message (role: assistant, includes `sources`) into `aiChatMessagesTable` (line 384).
16. **Cache Invalidation**: None in `/ai/chat`. (Note: Done in `apply-changes`, `analyze`, `review`).
17. **Audit/Event**: `eventsTable` entry on LLM error (via `handleOrchestratorError`, line 59). No success event in this route.
18. **HTTP Response**: 200 JSON with `sessionId`, `message` (object), `sources`, and `pendingChanges` (line 411).

### POST /api/ai/chat/apply-changes
1. **Middleware**: None.
2. **Parsing/Validation**: `changes` (array), `projectId`. Re-verifies paths are within `project.rootPath` (line 502).
3. **Execution**: Writes files using `fs.writeFile` (line 508).
4. **Invalidation**: `invalidateContextCache(projectId)` (line 530).
5. **Event**: Records `recordAudit` and `AiChangesApplied` in `eventsTable` (line 537).

### POST /api/ai/projects/:projectId/analyze
1. **Middleware**: `requireProjectAccess` (line 553).
2. **Execution**: `analyzeScan` (line 564).
3. **Invalidation**: `invalidateContextCache(projectId)` (line 572).
4. **Event**: `AiScanAnalysisCompleted` (line 574).

### POST /api/ai/projects/:projectId/review
1. **Middleware**: `requireProjectAccess` (line 588).
2. **Execution**: `reviewCode` (line 600).
3. **Invalidation**: `invalidateContextCache(projectId)` (line 607).
4. **Event**: `AiCodeReviewCompleted` (line 609).

### POST /api/ai/workflows/:workflowId/orchestrate
1. **Resolution**: Loads workflow and running execution. `requireGroqApiKey` (line 649).
2. **Validation**: `parseWorkflowPhases` (line 658) verifies phase shapes/uniqueness.
3. **Execution**: `orchestrateWorkflow` (line 668).
4. **Invalidation**: `invalidateContextCache(projectId)` (line 686).
5. **Event**: `AiWorkflowOrchestration` (line 688).

### POST /api/ai/tasks/:taskId/execute
1. **Claim**: Atomic update of `tasksTable` status to "running" (line 732).
2. **Log**: "AI agent execution started" in `taskLogsTable` (line 744).
3. **Execution**: `executeTask` (line 757).
4. **Invalidation**: `invalidateContextCache(projectId)` (line 786).
5. **Finalize**: Updates task status to "verifying" or "completed" and saves `agentResponse`.

---

## المستوى السابع — Hidden Components & In-Memory State

### 1. In-Memory State & Lifecycle
- **`_keyedClients` (lib/ai-orchestrator/src/groq-client.ts):** `Map<string, Groq>`. Caches Groq SDK instances by API key. Shared across all requests. Cleared via LRU eviction (MAX_KEYED_CLIENTS=50) using Map insertion order. Thread-safe via standard JS event loop; atomic retrieval/insertion.
- **`contextCache` (lib/ai-orchestrator/src/context-builder.ts):** `Map<string, {data, expiresAt}>`. Keyed by `projectId`. Caches project context. Shared across requests/users for the same project. Expires after 5 minutes (TTL=300,000ms). Manual invalidation via `invalidateContextCache(projectId)`.
- **`toolCallCache` (lib/ai-orchestrator/src/agents/chat-agent.ts):** `Map<string, string>`. Keyed by `toolName + JSON.stringify(args)`. Local to a single `chat()` invocation (request-level). Prevents redundant execution of identical tool calls within one agent loop.

### 2. Caches
- **Project Context Cache:** Key: `projectId`. TTL: 5 mins. Strategy: Manual invalidate on update or TTL expiry. Prevents redundant DB/Git lookups.
- **Tool Call Cache:** Key: Deterministic tool signature. TTL: Single request. Prevents infinite loops/redundancy in tool-use iterations.

### 3. Error Classification
- **Groq SDK → GroqClientError:** `classifySdkError` maps HTTP status to: `AUTH_ERROR` (401/403), `RATE_LIMITED` (429), `SERVER_ERROR` (5xx), `TIMEOUT` (AbortController), `NETWORK_ERROR` (ECONNRESET/DNS).
- **HTTP status:** `artifacts/api-server/src/routes/ai.ts` maps `GroqErrorCode` to: 401 (`AUTH_ERROR`), 429 (`RATE_LIMITED`), 504 (`TIMEOUT`), 503 (`SERVER_ERROR`), 500 (others).
- **Client Message:** Sanitized descriptions (e.g., "The AI model is currently overloaded") instead of raw SDK stack traces.

### 4. Model Selection & Fallbacks
- **`MODEL_POWERFUL` (llama-3.3-70b-versatile):** Default for complex reasoning (Workflow, Task, Review).
- **`MODEL_FAST` (llama-3.1-8b-instant):** Used for quick chat responses or high-throughput tasks.
- **Fallback:** No cross-provider fallback; if Groq fails, it retries 3x with exponential backoff (retryable errors only).

### 5. Tool Dispatch System
- **Registration:** Tools defined in `file-tools.ts` and `git-tools.ts` as `ToolDefinition` (Zod-backed).
- **Dispatch:** `executeFileTool` uses a switch-case on `toolName`.
- **Contract:** Handlers return `string` (result) or `PendingChange`.
- **`write_file` Queue:** Does NOT write to disk immediately. It validates the path via `safePath`, reads `originalContent` for diffing, and pushes a `PendingChange` object to an array for client-side approval.

### 6. Prompt Building
- **Files:** `chat`, `review`, `scan`, `task`, `workflow`. All use template literals.
- **Structure:** System (Persona/Rules/Output Schema) and User (Context: Metrics, Tasks, Files).
- **Risks:** User input is injected directly into templates. No explicit LLM-level shielding against prompt injection beyond schema-strict output requirements.

### 7. Token & Budget Limits
- **Limits:** `maxTokens` (4096) per request. `MAX_TOOL_ITERATIONS` (6) and `MAX_TOOL_CALLS` (10) per agent loop to prevent runaways.
- **Rate Limiting:** Managed via `RATE_LIMITED` error handling and exponential backoff (1000ms start).

### 8. Security Mechanisms
- **`safePath`:** Prevents traversal via lexical normalization (`path.resolve`), `fs.realpath` resolution (symlink handling), and a prefix check against `resolvedRoot`.
- **API Key:** Handled as plain strings in `_keyedClients`. Request auth relies on Clerk middleware (found in routes). No internal encryption/derivation seen at the orchestrator layer.

---

## المستوى الثامن — Runtime Contracts & Design Patterns

Catalog of Design Patterns:

Strategy Pattern:
- lib/ai-orchestrator/src/agents/chat-agent.ts: `requiresToolExecution` and `model` selection. Different LLM strategies (MODEL_FAST vs MODEL_POWERFUL) based on user intent. Complete.
- lib/ai-orchestrator/src/groq-client.ts: `retryDelayMs`. Implements different backoff strategies (standard vs longer for RATE_LIMITED). Complete.

Command Pattern:
- lib/ai-orchestrator/src/tools/file-tools.ts and git-tools.ts: Encapsulates filesystem and git operations as tool definitions with standard execution interfaces used by agents. Complete.

Pipeline Pattern:
- lib/ai-orchestrator/src/agents/workflow-orchestrator.ts: `orchestrateWorkflow` chains `decide` -> `validateDecision` -> `executeDecision`. Complete.
- artifacts/api-server/src/routes/ai.ts: Request flow for chat/execute/review often follows: Auth -> Resolve Key -> Build Context -> Agent Call -> DB Persistence -> Event Emission. Partial (implicit in route handlers).

Factory Pattern:
- lib/ai-orchestrator/src/groq-client.ts: `getClient(apiKey)`. Creates/returns Groq client instances based on keys. Complete.

Registry Pattern:
- lib/ai-orchestrator/src/groq-client.ts: `_keyedClients` Map. Stores and looks up reusable client instances by API key. Complete.

Adapter Pattern:
- lib/ai-orchestrator/src/parsing.ts: `parseAgentResponse`. Wraps raw LLM string output into structured, schema-validated objects, handling failures with fallbacks. Complete.
- lib/ai-orchestrator/src/groq-client.ts: `classifySdkError`. Maps various SDK/HTTP errors to internal `GroqClientError` codes. Complete.

Template Method:
- lib/ai-orchestrator/src/agents/: (task-agent, code-reviewer, scan-analyst) all follow a fixed skeleton: Build Prompts -> complete() -> parseAgentResponse() -> Handle Errors. Complete.

Observer/Event Bus:
- artifacts/api-server/src/routes/ai.ts: Every major action (chat, scan, workflow, apply-changes) inserts into `eventsTable`. This acts as a persistent event log for both the UI and future AI context. Complete.

Repository Pattern:
- artifacts/api-server/src/routes/ai.ts: Uses Drizzle ORM (e.g., `db.select().from(projectsTable)`) to abstract data access. Complete.

Chain of Responsibility:
- artifacts/api-server/src/routes/ai.ts: `resolveGroqApiKey`. Resolution order: User Key -> Env Fallback -> Undefined. Complete.

Cache Pattern:
- lib/ai-orchestrator/src/context-builder.ts: `contextCache` (Map) with TTL (`CONTEXT_CACHE_TTL_MS`). Manual invalidation via `invalidateContextCache`. Complete.
- lib/ai-orchestrator/src/agents/chat-agent.ts: `toolCallCache`. Deduplicates identical tool calls within a single request. Complete.

Retry Pattern:
- lib/ai-orchestrator/src/groq-client.ts: `complete()`/`completeRaw()` use bounded retries (3x) with jittered exponential backoff for transient errors. Complete.
- lib/ai-orchestrator/src/agents/task-agent.ts: Single agent-level retry for `NON_200` errors. Complete.

Fallback/Degradation Pattern:
- lib/ai-orchestrator/src/agents/chat-agent.ts: Falls back from `MODEL_FAST` to `MODEL_POWERFUL` on certain errors or intent. Fallback to `fallbackChatOutput` on parse failure. Complete.

Guard/Precondition Pattern:
- lib/ai-orchestrator/src/agents/workflow-orchestrator.ts: `validateDecision` and metrics gate. Blocks illegal state transitions. Complete.
- artifacts/api-server/src/routes/ai.ts: `requireGroqApiKey`, `requireProjectAccess`, and rootPath accessibility checks. Complete.

Atomic Claim Pattern:
- artifacts/api-server/src/routes/ai.ts (lines 731-741): Atomically updates task status to "running" only if it matches previous state using `and(eq(status, ...))`. Complete.

Deferred Write Pattern:
- lib/ai-orchestrator/src/agents/chat-agent.ts: `write_file` tool pushes to `pendingChanges` instead of writing to disk. Persisted only after user approval in `/apply-changes`. Complete.

Missing Patterns:
- Circuit Breaker: Retries are present, but no stateful breaker to trip on sustained downstream failure.
- Decorator Pattern: Could be used for logging/metrics around agent calls instead of manual instrumentation in each agent.

---

## المستوى التاسع — Line-by-Line Trace: POST /api/ai/chat

Tracing POST /api/ai/chat: "Read src/index.ts and tell me what it does" (New Session, Project proj-123)

1. [ai.ts:257] router.post("/api/ai/chat") begins.
2. [ai.ts:264] Validates projectId ("proj-123") and message; both present.
3. [ai.ts:269] await loadProjectByIdForUser("proj-123", req.userId, res) → returns project object with rootPath: "/home/runner/workspace".
4. [ai.ts:280] sessionId is undefined; skips existingSession lookup.
5. [ai.ts:290] historyRows = [].
6. [ai.ts:300] await requireGroqApiKey(req.userId, res) → returns "configured-key-123".
7. [ai.ts:311] await fs.access("/home/runner/workspace") → success. validRootPath = "/home/runner/workspace".
8. [ai.ts:344] await buildProjectContext("proj-123"):
   - [context-builder.ts:51] Parallel DB queries fetch project, tasks, metrics, entities, events, workflows, and relationships.
   - [context-builder.ts:292] Returns ProjectContext object.
9. [ai.ts:347] await chat({ message, history: [], projectContext, rootPath, apiKey }):
   - [chat-agent.ts:168] requiresToolExecution("Read src/index.ts...") matches "Read" → model = "llama-3.3-70b-versatile" (MODEL_POWERFUL).
   - [chat-agent.ts:176] Iteration 0 begins.
   - [chat-agent.ts:182] await completeRaw(...) with tools (FILE_TOOL_DEFINITIONS).
   - [groq-client.ts:248] sendRequest to Groq API.
   - [chat-agent.ts:195] Groq returns tool_calls: [{ id: "call_1", function: { name: "read_file", arguments: '{"path":"src/index.ts"}' } }].
   - [chat-agent.ts:260] totalToolCalls = 1.
   - [chat-agent.ts:264] await executeFileTool("read_file", {path: "src/index.ts"}, "/home/runner/workspace", []):
     - [file-tools.ts:231] resolvedRoot = "/home/runner/workspace".
     - [file-tools.ts:239] safePath verifies "src/index.ts" is inside root → "/home/runner/workspace/src/index.ts".
     - [file-tools.ts:242] await fs.readFile(...) → returns file content.
     - [file-tools.ts:250] Returns "File: src/index.ts\n```\n[content]\n```".
   - [chat-agent.ts:292] messages.push({ role: "tool", tool_call_id: "call_1", content: "..." }).
   - [chat-agent.ts:176] Iteration 1 begins.
   - [chat-agent.ts:182] await completeRaw(...) with updated history.
   - [chat-agent.ts:298] Groq returns final text: '{"response": "src/index.ts initializes the server...", "sources": ["src/index.ts"]}'.
   - [chat-agent.ts:300] parseAgentResponse(...) → returns validated ChatResponse.
   - [chat-agent.ts:378] Returns ChatOutput object.
10. [ai.ts:370] await db.insert(aiChatSessionsTable) → creates session "sess-abc" with title "Read src/index.ts...".
11. [ai.ts:384] await Promise.all([insert user message, insert assistant message]) → saves both to aiChatMessagesTable.
12. [ai.ts:407] await db.update(aiChatSessionsTable) → sets updatedAt.
13. [ai.ts:411] res.json({ sessionId: "sess-abc", message: { role: "assistant", ... }, sources: ["src/index.ts"], pendingChanges: [] }). Request complete.
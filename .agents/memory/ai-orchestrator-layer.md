---
name: AI Orchestration Layer
description: Groq-powered AI orchestration built into EngineeringOS — agents, routes, DB schema, and dashboard UI.
---

# AI Orchestration Layer

## What was built
- `lib/ai-orchestrator/` — new workspace package with Groq (llama-3.3-70b / llama-3.1-8b)
  - `groq-client.ts` — thin wrapper around groq-sdk
  - `context-builder.ts` — queries DB to build project context for agents
  - `agents/chat-agent.ts` — conversational interface (returns JSON with sources)
  - `agents/task-agent.ts` — executes tasks via AI, writes back agentResponse
  - `agents/scan-analyst.ts` — analyzes metrics + graph, returns ScanInsight[]
  - `agents/code-reviewer.ts` — code review, returns CodeReviewOutput
  - `agents/workflow-orchestrator.ts` — decides next workflow action

## DB tables added
- `ai_chat_sessions` — chat sessions per project
- `ai_chat_messages` — messages with role, content, sources (JSON string)

## API routes (artifacts/api-server/src/routes/ai.ts)
- `POST /api/ai/chat` — send message, get AI response + sessionId
- `GET /api/ai/chat/sessions?projectId=` — list sessions
- `GET /api/ai/chat/:sessionId/messages` — get messages
- `POST /api/ai/projects/:projectId/analyze` — scan analysis
- `POST /api/ai/projects/:projectId/review` — code review
- `POST /api/ai/workflows/:workflowId/orchestrate` — workflow decision
- `POST /api/ai/tasks/:taskId/execute` — AI task execution (separate from rule-based /tasks/:id/execute)

## Dashboard
- `artifacts/dashboard/src/pages/AiChat.tsx` — chat UI with session sidebar, quick-action buttons, message bubbles
- Route: `/ai` (added to App.tsx and Sidebar)
- Uses plain `fetch()` (not customFetch — that is internal to api-client-react)

## Important notes
- `customFetch` is NOT exported from `@workspace/api-client-react` — use native `fetch` in dashboard pages that call raw non-generated endpoints
- All agents return JSON from the LLM; fallback handles parse errors gracefully
- GROQ_API_KEY is stored as a Replit Secret
- `MODEL_FAST = llama-3.1-8b-instant` for chat; `MODEL_POWERFUL = llama-3.3-70b-versatile` for task exec, review, orchestration

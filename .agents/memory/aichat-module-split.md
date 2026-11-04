---
name: AiChat module split
description: How the dashboard AI chat page was split into modules and what remains in the main file
---
AiChat.tsx keeps the page component and re-exports the helpers the tests import; presentational components, parsers, and types live under pages/ai-chat/.

**Why:** the single file exceeded Babel's 500KB styling limit and made every edit risky.

**How to apply:** new helpers or cards go in the matching ai-chat module, not back into AiChat.tsx. The split was a mechanical move (no behavior edits), so verify later changes with the AiChat authenticated vitest file plus the Firefox release journey. Only type-only import cycles exist between types and live-activity; avoid adding value-level cycles. Self-contained effects/state already live in ai-chat/use-*.ts hooks (sessions drawer, execution audit, provider metrics, pending-changes persistence, cross-tab sync, and bounded live-activity state). Pure stream-error and stage-label presentation logic can move into its own module with output-contract tests. Typed presentation callbacks are isolated separately from session/execution lifecycle callbacks. Keep stream-generation fences on both groups. A reset callback may reconcile transient UI from the durable status only when both stream generation and execution ID match; terminal acceptance, ownership, and recovery mutations stay in AiChat unless a separate state boundary is designed and tested.

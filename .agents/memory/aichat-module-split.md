---
name: AiChat module split
description: How the dashboard AI chat page was split into modules and what remains in the main file
---
AiChat.tsx keeps the page component and re-exports the helpers the tests import; presentational components, parsers, and types live under pages/ai-chat/.

**Why:** the single file exceeded Babel's 500KB styling limit and made every edit risky.

**How to apply:** new helpers or cards go in the matching ai-chat module, not back into AiChat.tsx. The split was a mechanical move (no behavior edits), so verify later changes with the AiChat authenticated vitest file plus the Firefox release journey. Only type-only import cycles exist between types and live-activity; avoid adding value-level cycles. Self-contained effects/state already live in ai-chat/use-*.ts hooks (sessions drawer, execution audit, provider metrics, pending-changes persistence, cross-tab sync). Pure stream-error and stage-label presentation logic can move into its own module with output-contract tests. The remaining ~5.4k-line component is dominated by sendMessage/startStructuredTask/regenerate handlers that share ~60 setters; do not extract them mechanically without first designing and testing the state boundary.

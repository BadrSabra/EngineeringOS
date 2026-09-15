---
name: Project orientation responses
description: Durable guidance for user-facing answers to “explain this project” requests.
---

Project-orientation answers must be written as functional explanations rather than code inventories: lead with the product purpose, group the main components by role, describe the primary flow, and finish with only a few relevant indicators.

**Why:** The knowledge graph contains useful navigation evidence but is too technical and too noisy to serve as a project explanation by itself; raw IDs, revisions, scan metadata, and exhaustive entity lists made otherwise successful answers confusing.

**How to apply:** Use a presentation-safe prompt context for orientation turns that removes server-owned metadata while preserving the raw context for forensic and operational prompts. If the available evidence cannot establish the project’s purpose, say so and request targeted source reads instead of inferring from framework or filenames.
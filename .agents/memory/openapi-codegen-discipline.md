---
name: OpenAPI codegen discipline
description: The workspace treats generated API clients and Zod schemas as checked-in outputs of the OpenAPI spec.
---

Regenerate the API client and Zod outputs immediately after each OpenAPI specification change, then run the drift check before finishing.

**Why:** The codegen command cleans generated output before parsing and writing. A malformed spec can therefore leave generated files deleted, while even a documentation-only spec edit can make generated files drift.

**How to apply:** Fix and parse the spec first, run the API-spec codegen command, and confirm `codegen:check` reports generated files in sync.
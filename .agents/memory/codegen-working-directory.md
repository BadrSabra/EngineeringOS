---
name: Codegen working-directory contract
description: The API codegen post-processing command runs from the scripts package directory.
---

The generated Zod post-processing path must be relative to the scripts package working directory, while `CODEGEN_OUTPUT_ROOT` remains an absolute or workspace-rooted override for drift checks.

**Why:** The workspace codegen command delegates to the scripts package; using a workspace-relative path with one extra parent directory makes the post-processing step fail even though Orval generated valid files.

**How to apply:** Keep the default generated Zod path rooted at `../lib/api-zod/...` for the scripts package and run drift checks serially because codegen mutates generated output during validation.
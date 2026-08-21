---
name: Live recovery provider isolation
description: Prevent fixture-only provider credentials from steering real child-process release validation.
---

Real provider-backed recovery checks must construct the child environment without credentials installed only for mocked tests, while retaining explicitly configured live credentials.

**Why:** The integration fixture suite sets a dummy provider key for ordinary mocked route tests. Inheriting it into the real API child can change quality-based provider selection and produce misleading authentication failures before the intended live provider is exercised.

**How to apply:** When a test file mixes mocked provider tests with an opt-in real child process, omit fixture-only provider variables from the child environment and require the live provider configuration independently.
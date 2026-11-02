---
name: Repair-validator fixture scope
description: Keep route tests of registered repair validation distinct from preflight rejection tests.
---

When an integration test intends to exercise a registered repair validator, its fixture path must be within the selected validation profile's approved scope. An unsupported or arbitrary path is rejected during preflight, so the validation runner is correctly never called. Keep tests for scope rejection separate from tests of validation execution.

**Why:** A route test initially appeared to show the validator was skipped, but the fixture path itself was outside the profile scope. That failure described a test setup mismatch, not a validator defect.

**How to apply:** Before spying on `runRepairValidation`, check the profile's path contract and use a permitted fixture path; assert preflight behavior independently for rejected paths.

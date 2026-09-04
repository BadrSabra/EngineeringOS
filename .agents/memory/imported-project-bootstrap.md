---
name: Imported project bootstrap
description: Durable setup expectations for imported pnpm applications that already contain Replit workflows.
---

Fresh imports can retain workflow definitions without installed workspace dependencies, authentication configuration, or a development database schema. Treat those as separate readiness gates rather than assuming the checked-in Replit notes reflect the current environment.

**Why:** An imported project can look fully configured while services fail before application code runs because the runtime state was not transferred with the repository.

**How to apply:** Restore dependencies from the lockfile, provision the project's managed auth integration when its required keys are absent, apply the development schema using the repository's documented command, then restart workflows and verify the public health/landing routes.
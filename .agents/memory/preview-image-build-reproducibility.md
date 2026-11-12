---
name: Preview image build reproducibility
description: Keep Builder and Attestor images reproducible and compatible with their isolated Fargate task definitions.
---

**Rule:** Pin container base images by digest and pin Corepack to the workspace's exact pnpm version. A read-only Builder root may expose exactly one task-scoped ephemeral volume mounted writable at `/tmp`; reject host paths, EFS, extra volumes, and other mount paths. Keep the image architecture aligned with the Fargate runtime platform.

**Why:** Unpinned Corepack selected a newer pnpm whose stricter ignored-build policy broke the Builder image deploy. The Builder also needs temporary filesystem space, but making its root writable would weaken isolation; a narrow task-scoped scratch volume satisfies both requirements.

**How to apply:** Smoke-build locally with the reviewed Node digest and workspace pnpm version, test the image as its non-root user with a read-only root and bounded scratch, and enforce the same scratch and architecture contract in Gateway and Attestor checks. Local image builds do not imply permission to publish or apply AWS resources.

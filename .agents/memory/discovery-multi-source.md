---
name: Discovery multi-source architecture
description: Source adapter pattern, SourceType enum, DB schema changes, and wizard UI for the discovery layer refactor.
---

## Rule

The discovery pipeline accepts any of 6 source types. Each is resolved by `resolveSource()` in `artifacts/api-server/src/routes/discovery.ts` to a local filesystem path before the scanner runs. The scanner (`runDiscovery`) itself is unchanged.

**SourceType enum values:**
`LOCAL_FOLDER | WORKSPACE_PROJECT | GIT_REPOSITORY | ARCHIVE_UPLOAD | REMOTE_FILESYSTEM | DOCKER_VOLUME`

**Enabled:** LOCAL_FOLDER, GIT_REPOSITORY
**Stubs (501):** ARCHIVE_UPLOAD, REMOTE_FILESYSTEM, DOCKER_VOLUME

**Why:** The old single-field `rootPath + source` API was too narrow. The adapter pattern allows new source types without changing the scanner pipeline.

**How to apply:**
- Adding a new source type: add a case in `resolveSource()`, add to `SOURCE_CAPABILITIES` registry, add to Zod enum in `lib/api-zod/src/generated/api.ts`, add to `sourceTypeEnum` in `lib/db/src/schema/discovery.ts`, update OpenAPI spec, rebuild `lib/api-client-react` and `lib/api-zod` with `tsc --build`.
- Git clones land in `/tmp/eos-git-<uuid>/` — no post-scan cleanup currently.

## DB schema note

`discovery_sessions` table: old `source` (enum) column replaced by `source_type` (new `source_type` enum) + `source_config` (jsonb). No migration file exists since there was no running DB at time of refactor; apply manually when setting up a fresh DB.

## Generated file locations

- `lib/api-zod/src/generated/api.ts` — `StartDiscoveryBody` Zod schema
- `lib/api-zod/src/generated/types/sourceType.ts` — `SourceType` const
- `lib/api-zod/src/generated/types/discoverySourceConfig.ts`
- `lib/api-zod/src/generated/types/discoveryOptions.ts`
- `lib/api-zod/src/generated/types/discoverySourceCapability.ts`
- `lib/api-client-react/src/generated/api.schemas.ts` — `SourceType`, `DiscoverySourceConfig`, `DiscoveryOptions`, `StartDiscoveryInput` types
- `GET /api/discovery/sources` — capability manifest endpoint

## Build note

After changing `lib/api-client-react` or `lib/api-zod` types, run:
```
pnpm --filter @workspace/api-client-react exec tsc --build
pnpm --filter @workspace/api-zod exec tsc --build
```
The esbuild bundler for the API server does NOT need tsc; it bundles directly from source.

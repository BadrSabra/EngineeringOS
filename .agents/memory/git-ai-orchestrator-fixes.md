---
name: Git AI Orchestrator bug fixes
description: Five concrete bugs fixed in the Git/AI layer; includes patterns to preserve.
---

## Fixed bugs (from uploaded analysis doc)

### 1. Prompt/Git tools conflict
**File:** `lib/ai-orchestrator/src/prompts/chat.prompt.ts`
Rule 4 previously said "NEVER claim the ability to run git commands" even though `git_status/diff/log` were being passed as active tools. Fixed: rule now acknowledges read tools are available; only commit/push are off-limits.
**Why:** Model was instructed to deny capabilities it actually had, causing contradictory responses.

### 2. Commit UI shown for non-git-repo
**File:** `artifacts/dashboard/src/components/GitPanel.tsx` commit section condition
Changed `{!status?.clean && (` → `{statusQ.isSuccess && !status?.clean && (`
**Why:** When statusQ is in error state, `status` is undefined → `!undefined?.clean` is `true` → commit section shows even when project is not a git repo.

### 3. Push HTTPS enforcement
- **API:** `artifacts/api-server/src/routes/git.ts` push route — early 400 if remoteUrl doesn't match `/^https?:\/\//`.
- **UI:** `GitPanel.tsx` settings form — inline warning when remote input is non-HTTPS.
**Why:** `buildAuthUrl()` only injects PAT for HTTPS; SSH URLs silently fail push.

### 4. Partial apply clears all pending changes
**File:** `artifacts/dashboard/src/pages/AiChat.tsx` applyMutation.onSuccess
Changed `setPendingChanges([])` → filter to keep only changes whose path is NOT in the succeeded set.
**Why:** On partial success, failed files disappeared from UI making state invisible to the user.

### 5. Export/download endpoint added
- **API:** `GET /api/projects/:projectId/export` in `git.ts` — streams `tar -czf` of project rootPath.
- **UI:** Download icon (lucide Download) in GitPanel header as `<a download>` link.
**Why:** No path existed to download a local snapshot outside of git push.

### Pre-existing type errors fixed (bonus)
`recordAudit` calls in git.ts had `action: "git_commit"` and `action: "git_push"` — neither is in `auditActionEnum`. Changed both to `"executed"`.

# EngineeringOS

منصة هندسية مستقلة تعتمد على الذكاء الاصطناعي لمتابعة مشاريع البرمجيات وإدارة المهام والقواعد والسير العمل وتحليل الجودة.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — تشغيل خادم API (port 8080)
- `pnpm --filter @workspace/dashboard run dev` — تشغيل لوحة التحكم (port 23183)
- `pnpm run typecheck` — فحص TypeScript الكامل لجميع الحزم
- `pnpm run build` — typecheck + build لجميع الحزم
- `pnpm --filter @workspace/api-spec run codegen` — إعادة توليد hooks و Zod schemas من OpenAPI spec
- `pnpm --filter @workspace/db run push` — دفع تغييرات مخطط قاعدة البيانات (dev فقط)
- Required env: `DATABASE_URL` — Postgres connection string

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- Frontend: React 19 + Vite 7 + TailwindCSS 4 + wouter
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)
- Scanner: lib/scanner (file walk, rule matching, graph extraction, metrics)
- Auth: Clerk (Replit-managed tenant) — session cookies on web, `@clerk/express` middleware on the API

## Where things live

- `lib/api-spec/openapi.yaml` — مصدر الحقيقة الوحيد لعقد API
- `lib/db/src/schema/` — مخطط Drizzle لقاعدة البيانات
- `lib/scanner/src/` — مكتبة فحص المشاريع (walker، rule-matcher، graph-extractor، metrics-calc)
- `lib/api-client-react/src/generated/` — React Query hooks (مولّدة تلقائياً)
- `lib/api-zod/src/generated/` — Zod schemas للخادم (مولّدة تلقائياً)
- `artifacts/api-server/src/routes/` — مسارات Express API
- `artifacts/dashboard/src/pages/` — صفحات لوحة التحكم
- `artifacts/dashboard/src/components/layout/` — Shell و Sidebar

## Architecture decisions

- عقد OpenAPI-first: جميع الأنواع والـ hooks مولّدة من `openapi.yaml`
- Dark mode افتراضي في لوحة التحكم (engineering command center aesthetic)
- Scanner library منفصلة عن API server للاستخدام المستقل
- Audit logs و events لتتبع جميع العمليات
- Scan/discovery jobs تعمل خلف queue محدود التزامن داخل العملية (heavyJobQueue، سقف 2) بدل fire-and-forget غير محدود؛ عند إعادة تشغيل الخادم يتم فحص أي job عالق في queued/running وتوسيمه failed تلقائيًا
- Auth: كل نقاط `/api/*` (عدا `/api/healthz`) تتطلب تسجيل دخول عبر Clerk. صفحة `/` هي landing page عامة لغير المسجّلين، وباقي الصفحات محمية وتُعيد التوجيه لـ `/` عند تسجيل الخروج
- Authorization: كل مشروع له `ownerId` (single-owner، لا فرق أدوار/فِرق بعد). كل routes الخاصة بـ `:projectId` (get/patch/delete/scan/summary/scan-jobs) تمر عبر `requireProjectAccess` middleware: 404 لو المشروع غير موجود، 403 لو موجود لكن مملوك لمستخدم آخر. `GET /projects` يُرجع فقط مشاريع المستخدم الحالي. الملاحظة: هذا التوسّع لسكوب الوصول ما زال محصور في `projects.ts` — باقي الـ routes (tasks/rules/workflows/events/metrics/graph) لا تتحقق من ownership بعد لأنها تعتمد على `projectId` غير مباشر وليست ضمن نطاق PR-02 الحالي

### Discovery Layer (multi-source architecture)

The discovery pipeline supports 6 source types via a **SourceAdapter** pattern in `artifacts/api-server/src/routes/discovery.ts`:

| SourceType | Status | Description |
|---|---|---|
| `LOCAL_FOLDER` | ✅ Enabled | Scans a directory already on the server |
| `GIT_REPOSITORY` | ✅ Enabled | Clones a remote repo (git clone --depth 1) then scans |
| `WORKSPACE_PROJECT` | 🔒 Stub | Looks up an existing project's rootPath |
| `ARCHIVE_UPLOAD` | 🚧 Coming soon | Requires prior file upload step |
| `REMOTE_FILESYSTEM` | 🚧 Coming soon | Infrastructure not available on Replit |
| `DOCKER_VOLUME` | 🚧 Coming soon | Infrastructure not available on Replit |

**Request shape** (POST `/api/projects/discover`):
```json
{ "sourceType": "GIT_REPOSITORY", "sourceConfig": { "url": "...", "branch": "main" }, "options": {} }
```

**Key rules:**
- The `resolveSource()` function maps any source to a local `rootPath` before the scanner runs — the pipeline itself is unchanged.
- Git clones go to `/tmp/eos-git-<uuid>/` — no cleanup after scan (intentional for now; temp dirs are ephemeral).
- DB schema: `discovery_sessions` has `source_type` (enum) + `source_config` (jsonb); old `source` column removed.
- New endpoint `GET /api/discovery/sources` returns capability manifest used by the UI cards.
- Wizard UI (`DiscoverProjectWizard`) shows 6 source type cards; LOCAL_FOLDER and GIT_REPOSITORY are interactive; others show "Soon" badge and are disabled.

## Product

- **Dashboard**: نظرة عامة على المشاريع، المهام النشطة، الأحداث الأخيرة، نقاط الجودة
- **Projects**: إنشاء وإدارة المشاريع ومتابعة جودتها
- **Tasks**: إدارة المهام مع أولويات وحالات وتنفيذ عبر AI pipeline
- **Rules**: قواعد جودة الكود مع تقييم تلقائي
- **Workflows**: تعريف وتنفيذ سير العمل متعدد المراحل
- **Events**: سجل أحداث النظام
- **Metrics**: مقاييس جودة الكود عبر الزمن (architecture، security، performance، reliability)
- **Graph**: شبكة معرفة الكيانات والعلاقات (Knowledge Graph)

## User preferences

- Execute changes in PR order as defined in `attached_assets/Pasted--EngineeringOS-PR-by-PR-Execution-Pack-for-Replit-AI-PR_1784154335102.txt` — do not skip ahead or reorder.
- The uploaded analysis reports in `attached_assets/` are the source of truth for current project state and open gaps.
- Follow the 10-PR backlog (Phase 1: scoping/ownership → Phase 2: job durability → Phase 3: surface cleanup and truth sync).

## Post-import setup (re-run after a fresh clone/import)

**Step-by-step (in order):**

1. **Install dependencies** — `pnpm install`
   - Imports arrive without `node_modules`; this breaks all workflows (`vite: not found`, `esbuild` missing).
   - Requires `shamefully-hoist=true` in `.npmrc` (already committed) so binaries are findable in Replit's environment.

2. **Enable PostgreSQL module** — add `postgresql-16` to `modules` in `.replit` (already done; provides `DATABASE_URL` and related env vars automatically).

3. **Provision Clerk auth** — call `setupClerkWhitelabelAuth()` in the Replit agent sandbox.
   - Sets `CLERK_SECRET_KEY`, `CLERK_PUBLISHABLE_KEY`, `VITE_CLERK_PUBLISHABLE_KEY`.
   - These are never committed; must be re-provisioned on each fresh import.

4. **Push DB schema** — `pnpm --filter @workspace/db run push`
   - Applies `lib/db/src/schema/*` to the fresh (empty) Postgres database via Drizzle.

5. **Start workflows** — all three start automatically once steps 1–4 are done:
   - `artifacts/api-server: API Server` → port 8080
   - `artifacts/dashboard: web` → port 23183
   - `artifacts/mockup-sandbox: Component Preview Server` → port 8081

6. **Verify** — `bash scripts/verify-setup.sh`
   - Checks node_modules, all 3 secrets, DATABASE_URL, API healthz → 200, dashboard → 200, and DB schema.

**Verified working 2026-07-16:** all 3 workflows start clean; `GET /api/healthz` → `{"status":"ok"}`; dashboard landing page renders with Sign In / Create Account buttons; Clerk dev keys loaded; no reconciliation errors on startup.

## Gotchas

- بعد أي تغيير في `openapi.yaml` يجب تشغيل codegen قبل أي شيء آخر
- `pnpm run typecheck:libs` يجب أن يُشغّل بعد تغيير أي حزمة في `lib/*`
- لا تُشغّل `pnpm run dev` من جذر المستودع — استخدم workflows
- `pnpm run codegen:check` — يتحقق من عدم وجود drift بين `openapi.yaml` والكود المولّد (يفشل CI عند الاختلاف)
- `pnpm run test` — يشغّل اختبارات كل الحزم (scanner: 40 اختبار، api-server: 8 اختبارات تكامل مع DB حقيقية)

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
- See `docs/fact-record.md` for the current file-by-file truth of what's built vs. aspirational
- See `docs/completion-plan.md` for the phased plan taking the project from skeleton to complete platform

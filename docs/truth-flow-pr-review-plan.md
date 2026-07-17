# خطة المراجعة التنفيذية — تثبيت الحقيقة المرجعية
**المصدر:** `EngineeringOS_truth_checklist` (324 live · 143 generated · 170 historical)
**التاريخ:** 2026-07-17
**المبدأ:** كل PR يغلق طبقة واحدة بالكامل قبل الانتقال للتالية. لا PR يُفتح إذا لم تُغلق بوابته.

---

## مفتاح الأولوية

| رمز | معنى |
|-----|------|
| 🔴 P0 | حاكم — يمنع أي شيء آخر من العمل |
| 🟠 P1 | أساسي — يؤثر على صحة البيانات أو العقود |
| 🟡 P2 | تنفيذي — منطق الأعمال والواجهة |
| 🔵 P3 | إداري — توثيق وأرشيف |

---

## PR-00 — Bootstrap & Governance (🔴 P0)

**النطاق:** ملفات الجذر والحوكمة — لا يمكن تشغيل أي شيء بدونها.

**الملفات:**
- [ ] `.gitattributes` — encoding/eol normalization
- [ ] `.gitignore` — ما يُستبعد من الـ repo
- [ ] `.npmrc` — `shamefully-hoist=true` مطلوب لـ pnpm
- [ ] `.replit` — تعريف Workflows وإعدادات البيئة
- [ ] `.replitignore` — ما يُستبعد من بيئة Replit
- [ ] `pnpm-workspace.yaml` — تعريف مساحات العمل
- [ ] `package.json` (root) — إعدادات الـ monorepo
- [ ] `tsconfig.json` (root) + `tsconfig.base.json`

**بوابة الإغلاق:**
```bash
pnpm install          # يجب أن يكتمل بلا أخطاء
pnpm -r build         # يجب أن تبنى كل الحزم
```

---

## PR-01 — Contract Layer: OpenAPI → Codegen (🔴 P0)

**النطاق:** طبقة العقود — المصدر الوحيد للحقيقة في الـ API shape.

**قاعدة حديدية:** لا تعديل يدوي على أي ملف `generated/`. التعديل يكون فقط على `openapi.yaml` ثم إعادة التوليد.

**الملفات — المصدر (live):**
- [ ] `lib/api-spec/openapi.yaml` — **المصدر الأعلى الوحيد**
- [ ] `lib/api-spec/orval.config.ts`
- [ ] `lib/api-spec/package.json`
- [ ] `lib/api-zod/src/truth-flow-matrix.schema.ts`
- [ ] `lib/api-zod/src/index.ts`
- [ ] `lib/api-zod/package.json` + `tsconfig.json`
- [ ] `lib/api-client-react/src/custom-fetch.ts`
- [ ] `lib/api-client-react/src/project-error.ts`
- [ ] `lib/api-client-react/src/index.ts`
- [ ] `lib/api-client-react/package.json` + `tsconfig.json`
- [ ] `scripts/check-codegen-drift.ts`
- [ ] `scripts/validate-truth-flow.ts`
- [ ] `scripts/package.json` + `scripts/tsconfig.json`

**الملفات — مشتقة آليًا (generated) [لا تحرير يدوي]:**
- [ ] `lib/api-client-react/src/generated/api.schemas.ts`
- [ ] `lib/api-client-react/src/generated/api.ts`
- [ ] `lib/api-zod/src/generated/api.ts`
- [ ] `lib/api-zod/src/generated/types/index.ts`
- [ ] `lib/api-zod/src/generated/types/*.ts` (141 نوع)

**بوابة الإغلاق:**
```bash
pnpm --filter @workspace/api-spec run codegen   # توليد نظيف
npx ts-node scripts/check-codegen-drift.ts      # drift = 0
npx ts-node scripts/validate-truth-flow.ts      # ✓ pass
```

---

## PR-02 — Database Schema (🔴 P0)

**النطاق:** مخطط قاعدة البيانات — الحقيقة المرجعية للبيانات الدائمة.

**قاعدة:** أي تغيير في schema يستوجب `drizzle-kit push` + تحديث types المشتقة.

**الملفات:**
- [ ] `lib/db/src/schema/projects.ts`
- [ ] `lib/db/src/schema/tasks.ts`
- [ ] `lib/db/src/schema/task_logs.ts`
- [ ] `lib/db/src/schema/workflows.ts`
- [ ] `lib/db/src/schema/scan_jobs.ts`
- [ ] `lib/db/src/schema/graph.ts`
- [ ] `lib/db/src/schema/metrics.ts`
- [ ] `lib/db/src/schema/rules.ts`
- [ ] `lib/db/src/schema/events.ts`
- [ ] `lib/db/src/schema/plugins.ts`
- [ ] `lib/db/src/schema/discovery.ts`
- [ ] `lib/db/src/schema/ai_chats.ts`
- [ ] `lib/db/src/schema/ai_provider_credentials.ts`
- [ ] `lib/db/src/schema/audit_logs.ts`
- [ ] `lib/db/src/schema/index.ts`
- [ ] `lib/db/src/index.ts`
- [ ] `lib/db/drizzle.config.ts`
- [ ] `lib/db/package.json` + `tsconfig.json`

**بوابة الإغلاق:**
```bash
pnpm --filter @workspace/db run push   # schema pushed بلا conflicts
# فحص: كل جدول في openapi.yaml له مقابل في schema
```

---

## PR-03 — Scanner Library (🟠 P1)

**النطاق:** محرك الفحص — يقرأ الكود ويستخرج الـ graph والـ metrics.

**الملفات — production:**
- [ ] `lib/scanner/src/file-walker.ts`
- [ ] `lib/scanner/src/graph-extractor.ts`
- [ ] `lib/scanner/src/metrics-calc.ts`
- [ ] `lib/scanner/src/rule-matcher.ts`
- [ ] `lib/scanner/src/python-extractor.ts`
- [ ] `lib/scanner/src/python-ast-script.ts`
- [ ] `lib/scanner/src/python-ast-script.py`
- [ ] `lib/scanner/src/index.ts`
- [ ] `lib/scanner/package.json` + `tsconfig.json` + `vitest.config.ts`

**الملفات — اختبارات:**
- [ ] `lib/scanner/src/__tests__/file-walker.test.ts`
- [ ] `lib/scanner/src/__tests__/graph-extractor.test.ts`
- [ ] `lib/scanner/src/__tests__/metrics-calc.test.ts`
- [ ] `lib/scanner/src/__tests__/rule-matcher.test.ts`

**بوابة الإغلاق:**
```bash
pnpm --filter @workspace/scanner run test   # 100% pass
# graph-extractor: يستخدم TS compiler API لـ TS/JS، subprocess python3 للـ Python
# rule-matcher: يتعامل مع edge cases الـ regex
```

---

## PR-04 — Knowledge Engine (🟠 P1)

**النطاق:** محرك المعرفة — BFS queries + centrality + clustering.

**الملفات — production:**
- [ ] `lib/knowledge-engine/src/queries.ts`
- [ ] `lib/knowledge-engine/src/inference.ts`
- [ ] `lib/knowledge-engine/src/types.ts`
- [ ] `lib/knowledge-engine/src/index.ts`
- [ ] `lib/knowledge-engine/package.json` + `tsconfig.json`

**الملفات — اختبارات:**
- [ ] `lib/knowledge-engine/src/__tests__/queries.test.ts`
- [ ] `lib/knowledge-engine/src/__tests__/inference.test.ts`

**تحذير معروف:** `drizzle-orm` يجب أن يكون dependency مباشر في هذه الحزمة (ليس transitive فقط).

**بوابة الإغلاق:**
```bash
pnpm --filter @workspace/knowledge-engine run test   # 100% pass
# BFS depth: اختبر depth=0, depth=1, depth=N صراحةً
```

---

## PR-05 — AI Orchestrator (🟠 P1)

**النطاق:** طبقة الذكاء الاصطناعي — 5 agents + Groq client + file tools.

**الملفات — production:**
- [ ] `lib/ai-orchestrator/src/groq-client.ts`
- [ ] `lib/ai-orchestrator/src/parsing.ts`
- [ ] `lib/ai-orchestrator/src/context-builder.ts`
- [ ] `lib/ai-orchestrator/src/errors.ts`
- [ ] `lib/ai-orchestrator/src/index.ts`
- [ ] `lib/ai-orchestrator/src/agents/chat-agent.ts`
- [ ] `lib/ai-orchestrator/src/agents/code-reviewer.ts`
- [ ] `lib/ai-orchestrator/src/agents/scan-analyst.ts`
- [ ] `lib/ai-orchestrator/src/agents/task-agent.ts`
- [ ] `lib/ai-orchestrator/src/agents/workflow-orchestrator.ts`
- [ ] `lib/ai-orchestrator/src/tools/file-tools.ts`
- [ ] `lib/ai-orchestrator/src/prompts/chat.prompt.ts`
- [ ] `lib/ai-orchestrator/src/prompts/review.prompt.ts`
- [ ] `lib/ai-orchestrator/src/prompts/scan.prompt.ts`
- [ ] `lib/ai-orchestrator/src/prompts/task.prompt.ts`
- [ ] `lib/ai-orchestrator/src/prompts/workflow.prompt.ts`
- [ ] `lib/ai-orchestrator/src/prompts/index.ts`
- [ ] `lib/ai-orchestrator/src/schemas/chat.schema.ts`
- [ ] `lib/ai-orchestrator/src/schemas/code-review.schema.ts`
- [ ] `lib/ai-orchestrator/src/schemas/context.schema.ts`
- [ ] `lib/ai-orchestrator/src/schemas/scan.schema.ts`
- [ ] `lib/ai-orchestrator/src/schemas/task.schema.ts`
- [ ] `lib/ai-orchestrator/src/schemas/workflow.schema.ts`
- [ ] `lib/ai-orchestrator/src/schemas/index.ts`
- [ ] `lib/ai-orchestrator/package.json` + `tsconfig.json` + `vitest.config.ts`

**الملفات — اختبارات:**
- [ ] `lib/ai-orchestrator/src/__tests__/chat-agent.test.ts`
- [ ] `lib/ai-orchestrator/src/__tests__/file-tools.test.ts`
- [ ] `lib/ai-orchestrator/src/__tests__/groq-client.test.ts`
- [ ] `lib/ai-orchestrator/src/__tests__/parsing.test.ts`
- [ ] `lib/ai-orchestrator/src/__tests__/schemas.test.ts`
- [ ] `lib/ai-orchestrator/src/__tests__/workflow-orchestrator.test.ts`

**تحذيرات معروفة:**
- Zod `.default()` يكسر generic inference — استخدم `.default()` خارج generic wrapper
- groq-client: `completeRaw` للـ agentic loop، error codes محددة في errors.ts
- file-tools: write يحتاج deferred approval — لا تُنفَّذ مباشرة

**بوابة الإغلاق:**
```bash
pnpm --filter @workspace/ai-orchestrator run test   # 100% pass
```

---

## PR-06 — API Server: Middleware & Auth (🟠 P1)

**النطاق:** طبقة المصادقة وحماية المسارات.

**الملفات:**
- [ ] `artifacts/api-server/src/middlewares/requireAuth.ts`
- [ ] `artifacts/api-server/src/middlewares/requireAuth.test.ts`
- [ ] `artifacts/api-server/src/middlewares/requireProjectAccess.ts`
- [ ] `artifacts/api-server/src/middlewares/clerkProxyMiddleware.ts`
- [ ] `artifacts/api-server/src/middlewares/.gitkeep`
- [ ] `artifacts/api-server/src/types/express.d.ts`
- [ ] `artifacts/api-server/src/lib/audit.ts`
- [ ] `artifacts/api-server/src/lib/credentials-crypto.ts`
- [ ] `artifacts/api-server/src/lib/logger.ts`
- [ ] `artifacts/api-server/src/lib/path-validation.ts`
- [ ] `artifacts/api-server/src/lib/path-validation.test.ts`
- [ ] `artifacts/api-server/src/lib/graph-provenance.ts`
- [ ] `artifacts/api-server/src/lib/plugin-runtime.ts`
- [ ] `artifacts/api-server/src/lib/plugin-runtime.test.ts`
- [ ] `artifacts/api-server/src/lib/project-error.test.ts`

**تحذيرات معروفة:**
- `requireAuth` bypass: مشروط بـ `NODE_ENV === 'test'` فقط (ليس mock tokens)
- `requireProjectAccess`: يُرجع 404 (ليس 403) لإخفاء وجود المورد
- Clerk: يُهبط عند غياب `CLERK_SECRET_KEY` قبل أي bypass — `setupClerkWhitelabelAuth()` مطلوب

**بوابة الإغلاق:**
```bash
pnpm --filter @workspace/api-server run test -- --testPathPattern=middleware
pnpm --filter @workspace/api-server run test -- --testPathPattern=auth
```

---

## PR-07 — API Server: Routes (🟡 P2)

**النطاق:** جميع مسارات الـ API — يجب أن تتطابق 1:1 مع `openapi.yaml`.

**الملفات — مسارات:**
- [ ] `artifacts/api-server/src/routes/projects.ts` + `projects.test.ts`
- [ ] `artifacts/api-server/src/routes/tasks.ts` + `tasks.test.ts`
- [ ] `artifacts/api-server/src/routes/workflows.ts` + `workflows.test.ts`
- [ ] `artifacts/api-server/src/routes/discovery.ts` + `discovery.test.ts`
- [ ] `artifacts/api-server/src/routes/graph.ts` + `graph.test.ts`
- [ ] `artifacts/api-server/src/routes/metrics.ts` + `metrics.test.ts`
- [ ] `artifacts/api-server/src/routes/rules.ts` + `rules.test.ts`
- [ ] `artifacts/api-server/src/routes/events.ts` + `events.test.ts`
- [ ] `artifacts/api-server/src/routes/plugins.ts` + `plugins.test.ts`
- [ ] `artifacts/api-server/src/routes/ai.ts` + `ai.test.ts`
- [ ] `artifacts/api-server/src/routes/dashboard.ts` + `dashboard.test.ts`
- [ ] `artifacts/api-server/src/routes/health.ts` + `health.test.ts`
- [ ] `artifacts/api-server/src/routes/index.ts`

**الملفات — job infrastructure:**
- [ ] `artifacts/api-server/src/lib/job-queue.ts` + `job-queue.test.ts`
- [ ] `artifacts/api-server/src/lib/job-reconciliation.ts` + `job-reconciliation.test.ts`
- [ ] `artifacts/api-server/src/lib/scan-runner.ts`
- [ ] `artifacts/api-server/src/lib/discovery-adapters.ts` + `discovery-adapters.test.ts`
- [ ] `artifacts/api-server/src/scripts/seed-provenance.ts`
- [ ] `artifacts/api-server/src/lib/.gitkeep`

**بوابة الإغلاق:**
```bash
pnpm --filter @workspace/api-server run test   # 100% pass
# فحص: كل endpoint في openapi.yaml له route handler + test
# فحص: dashboard route مُقيّد بـ ownerId (PR-01 scoping)
```

---

## PR-08 — API Server: Core (🟡 P2)

**النطاق:** نقطة الدخول والإعدادات — السيرفر يبدأ وينتهي بشكل صحيح.

**الملفات:**
- [ ] `artifacts/api-server/src/app.ts`
- [ ] `artifacts/api-server/src/config.ts`
- [ ] `artifacts/api-server/src/index.ts`
- [ ] `artifacts/api-server/build.mjs`
- [ ] `artifacts/api-server/package.json`
- [ ] `artifacts/api-server/tsconfig.json`
- [ ] `artifacts/api-server/vitest.config.ts`
- [ ] `artifacts/api-server/.replit-artifact/artifact.toml`

**نقاط تحقق حرجة في `app.ts`:**
- [ ] `app.disable('etag')` — يمنع 304 bodyless responses
- [ ] `Cache-Control: no-store` في كل responses
- [ ] Rate limiting trust proxy مضبوط بشكل صحيح
- [ ] `clerkMiddleware` مُهيّأ قبل كل routes

**بوابة الإغلاق:**
```bash
curl http://localhost:8080/api/health   # {"status":"ok"}
# فحص: السيرفر يقرأ PORT من env var (ليس hardcoded)
```

---

## PR-09 — Dashboard: Pages & Components (🟡 P2)

**النطاق:** واجهة المستخدم — React + Vite + Clerk.

**الملفات — core:**
- [ ] `artifacts/dashboard/src/main.tsx`
- [ ] `artifacts/dashboard/src/App.tsx`
- [ ] `artifacts/dashboard/src/index.css`
- [ ] `artifacts/dashboard/src/lib/clerk.ts`
- [ ] `artifacts/dashboard/src/lib/utils.ts`
- [ ] `artifacts/dashboard/index.html`
- [ ] `artifacts/dashboard/vite.config.ts`
- [ ] `artifacts/dashboard/tsconfig.json`
- [ ] `artifacts/dashboard/package.json`
- [ ] `artifacts/dashboard/components.json`
- [ ] `artifacts/dashboard/.replit-artifact/artifact.toml`

**الملفات — صفحات:**
- [ ] `src/pages/Landing.tsx` — صفحة الهبوط (غير مصادق)
- [ ] `src/pages/SignIn.tsx` + `src/pages/SignUp.tsx` — Clerk flows
- [ ] `src/pages/Dashboard.tsx` — الرئيسية (مصادق)
- [ ] `src/pages/Projects.tsx` + `src/pages/ProjectDetail.tsx`
- [ ] `src/pages/Tasks.tsx`
- [ ] `src/pages/Workflows.tsx`
- [ ] `src/pages/Graph.tsx`
- [ ] `src/pages/Metrics.tsx`
- [ ] `src/pages/Rules.tsx`
- [ ] `src/pages/Events.tsx`
- [ ] `src/pages/AiChat.tsx`
- [ ] `src/pages/DiscoverProjectWizard.tsx`
- [ ] `src/pages/not-found.tsx`

**الملفات — layout:**
- [ ] `src/components/layout/Shell.tsx`
- [ ] `src/components/layout/Sidebar.tsx`

**الملفات — hooks:**
- [ ] `src/hooks/use-mobile.tsx`
- [ ] `src/hooks/use-toast.ts`

**الملفات — UI components (shadcn — لا تحرير مباشر):**
- [ ] `src/components/ui/*.tsx` (42 مكوّن)

**الملفات — assets:**
- [ ] `public/favicon.svg` + `public/logo.svg` + `public/robots.txt`

**بوابة الإغلاق:**
```bash
pnpm --filter @workspace/dashboard run build   # بلا TypeScript errors
# فحص: كل page تستخدم generated hooks من api-client-react (ليس fetch مباشر)
# فحص: لا URL hardcoded إلى localhost
```

---

## PR-10 — Mockup Sandbox (🟡 P2)

**النطاق:** بيئة العزل للمكوّنات — مرتبطة بـ canvas وليس بالإنتاج.

**الملفات:**
- [ ] `artifacts/mockup-sandbox/src/App.tsx`
- [ ] `artifacts/mockup-sandbox/src/main.tsx`
- [ ] `artifacts/mockup-sandbox/src/index.css`
- [ ] `artifacts/mockup-sandbox/src/lib/utils.ts`
- [ ] `artifacts/mockup-sandbox/mockupPreviewPlugin.ts`
- [ ] `artifacts/mockup-sandbox/vite.config.ts`
- [ ] `artifacts/mockup-sandbox/package.json`
- [ ] `artifacts/mockup-sandbox/index.html`
- [ ] `artifacts/mockup-sandbox/.replit-artifact/artifact.toml`
- [ ] `artifacts/mockup-sandbox/src/components/ui/*.tsx` (42 مكوّن — mirror للـ dashboard)
- [ ] `artifacts/mockup-sandbox/src/hooks/use-mobile.tsx` + `use-toast.ts`

**الملفات — مشتقة:**
- [ ] `artifacts/mockup-sandbox/src/.generated/mockup-components.ts` — **لا تحرير يدوي**

**بوابة الإغلاق:**
```bash
pnpm --filter @workspace/mockup-sandbox run build   # بلا errors
# فحص: preview URLs تعمل على /preview/* (ليس root)
```

---

## PR-11 — Scripts & Verification (🟡 P2)

**النطاق:** أدوات التحقق التشغيلية — تُشغَّل في كل merge.

**الملفات:**
- [ ] `scripts/post-merge.sh` — يُشغَّل تلقائيًا بعد كل merge
- [ ] `scripts/verify-setup.sh` — فحص صحة البيئة
- [ ] `scripts/src/hello.ts` — smoke test للـ scripts package

**نقاط تحقق:**
- [ ] `post-merge.sh`: يُشغّل `pnpm install` + `db push` + `codegen`
- [ ] `verify-setup.sh`: يفحص `DATABASE_URL`, `CLERK_SECRET_KEY`, `CLERK_PUBLISHABLE_KEY`

**بوابة الإغلاق:**
```bash
bash scripts/verify-setup.sh   # كل فحوصات البيئة ✓
bash scripts/post-merge.sh     # يكتمل بلا errors
```

---

## PR-12 — Live Docs Audit (🔵 P3)

**النطاق:** التوثيق الحاكم — يجب أن يعكس الواقع الحالي (ليس التاريخي).

**الملفات:**
- [ ] `docs/ENGINEERINGOS_MASTER_EXECUTION_CONSTITUTION.md` — مرجع حاكم
- [ ] `docs/PR_BACKLOG.md` — قائمة المهام المعلّقة (**تحذير: الجزء الأخير قد يكون قديمًا**)
- [ ] `docs/completion-plan.md` — خطة الإنجاز (**تحذير: trailing "Remaining open items" قد يتأخر عن الكود**)
- [ ] `docs/fact-record.md` — سجل الحقائق
- [ ] `docs/truth-flow-pr-checklist.md` — هذا الملف + الـ source checklist

**بوابة الإغلاق:**
- [ ] كل مرجع لـ PR موجود فعلاً في الكود
- [ ] `completion-plan.md`: phase log يتطابق مع الكود، لا الـ trailing list
- [ ] لا links مكسورة إلى ملفات تاريخية من داخل الـ live docs

---

## PR-13 — Historical / Archive Triage (🔵 P3)

**النطاق:** تصنيف الأصول التاريخية — قرار: يُبقى / يُحذف / يُؤرشف.

**الملفات:**

| الفئة | الحجم | القرار المقترح |
|--------|-------|----------------|
| `docs/EXECUTION_ALIGNMENT_REPORT.md` | 1 ملف | يُؤرشف (→ `attached_assets/`) |
| `docs/PLACEHOLDER_REGISTER.md` | 1 ملف | يُؤرشف |
| `docs/RUNTIME_EXECUTION_MATRIX.md` | 1 ملف | يُؤرشف |
| `docs/pr-backlog-ai-orchestrator.md` | 1 ملف | يُدمج في `PR_BACKLOG.md` أو يُحذف |
| `attached_assets/*.md/*.csv/*.pdf` | ~80 ملف | أرشيف — لا حذف بدون موافقة |
| `attached_assets/Pasted--*.txt` | ~40 ملف | يُقيَّم كل على حدة |
| `attached_assets/Screenshot_*.png` | 11 ملف | يُحتفظ بها للمرجع |

**بوابة الإغلاق:**
- [ ] لا يوجد ملف `live` يعتمد على ملف `historical` مباشرةً
- [ ] `attached_assets/` لا يحتوي ملفات `.generated` مكشوفة

---

## PR-14 — Memory Notes Audit (🔵 P3)

**النطاق:** ذاكرة الوكيل التشغيلية — تحقق من الاتساق مع الكود الحالي.

**الملفات (25 ملف في `.agents/memory/`):**
- [ ] كل ملف ذاكرة: هل المسار المذكور لا يزال موجودًا؟
- [ ] هل القرار المسجّل لا يزال صحيحًا؟

**نقاط التحقق المحددة:**
- [ ] `completion-plan-stale-backlog.md`: ذُكر أن الـ trailing list متأخرة — تحقق
- [ ] `imported-project-clerk-secrets.md`: تأكد أن `setupClerkWhitelabelAuth()` موجودة
- [ ] `orval-openapi-codegen.md`: تأكد أن كل request bodies تستخدم `$ref` (ليس inline)
- [ ] `drizzle-error-wrapping.md`: تأكد أن error handling يقرأ من `err.cause`

**بوابة الإغلاق:**
- [ ] لا توجد ذاكرة تُشير إلى ملف محذوف أو دالة مُعاد تسميتها
- [ ] `MEMORY.md`: كل سطر في الـ index له ملف topic موجود

---

## ترتيب التنفيذ الموصى به

```
PR-00 ──► PR-01 ──► PR-02 ──► PR-03 ──► PR-04
                                   ├──► PR-05 (parallel مع PR-04)
                                   └──► PR-06 ──► PR-07 ──► PR-08
                                                      └──► PR-09 ──► PR-10
                                                                └──► PR-11
PR-12 (أي وقت بعد PR-00)
PR-13 (أي وقت)
PR-14 (أي وقت)
```

---

## إحصائيات التغطية

| PR | الملفات المغطاة | الفئة |
|----|----------------|-------|
| PR-00 | 8 | live/config |
| PR-01 | 10 live + 143 generated | live + generated |
| PR-02 | 18 | live/schema |
| PR-03 | 12 | live/lib |
| PR-04 | 7 | live/lib |
| PR-05 | 25 | live/lib |
| PR-06 | 15 | live/artifact |
| PR-07 | 28 | live/artifact |
| PR-08 | 8 | live/artifact |
| PR-09 | 55+ | live/artifact |
| PR-10 | 48 | live/artifact |
| PR-11 | 3 | live/scripts |
| PR-12 | 5 | live/docs |
| PR-13 | 170 | historical |
| PR-14 | 25 | memory |
| **المجموع** | **324 live · 143 generated · 170 historical** | |

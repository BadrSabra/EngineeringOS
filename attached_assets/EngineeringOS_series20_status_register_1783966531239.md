# EngineeringOS — السلسلة 20  
## سجل حالة طبقي بالأدلة من داخل الكود والملفات

**تاريخ القراءة:** 2026-07-13  
**نطاق القراءة:** أرشيف المشروع الكامل داخل `EngineeringOS-main (26).zip`  
**حجم الأرشيف:** 518 ملفًا/مدخلًا  
**الكتل الأكبر:** `artifacts/` (224) — `lib/` (191) — `attached_assets/` (65) — `.agents/` (16)

---

## 1) الصورة الحالية كما يثبتها الأرشيف

EngineeringOS لم يعد فكرة أو واجهة فقط؛ بل أصبح **control plane متعدد الطبقات** له سلسلة تشغيل كاملة:

`OpenAPI contract → DB schema → scanner → discovery/import → scan jobs → knowledge graph → knowledge engine → AI orchestrator → API server → dashboard → audit/events/metrics`

الدليل هنا ليس وصفًا تسويقيًا، بل تقاطع عدة ملفات حاكمة:

- `package.json` يفرض **pnpm** ويجعل `codegen`, `codegen:check`, `build`, `typecheck`, `test` جزءًا من العقد التشغيلي.
- `replit.md` يحدد بوضوح أن **OpenAPI هو مصدر الحقيقة**، وأن scanner منفصل، وأن **لا توجد roles بعد**.
- `artifacts/api-server/src/app.ts` يطبق hardening حقيقي: `helmet`, `rateLimit`, `trust proxy`, `no-store`, `clerkMiddleware`, و`requireAuth` على كل `/api/*` عدا `/api/healthz`.
- `artifacts/api-server/src/index.ts` ينفّذ **reconcileStuckJobs() قبل قبول الترافيك**.
- `lib/db/src/schema/*` يثبت أن البيانات ليست جداول مبعثرة؛ بل طبقات مترابطة: projects / tasks / workflows / graph / events / metrics / discovery / scan_jobs / ai_chats / audit_logs / plugins.
- `lib/scanner/src/*` يثبت أن الاستخراج لم يعد regex فقط، بل AST حقيقي لـ TS/JS وPython، مع fallback واضح ومقنن.
- `lib/knowledge-engine/src/*` يحول graph إلى طبقة استعلام/استدلال.
- `lib/ai-orchestrator/src/*` يضيف طبقة وكلاء حقيقية فوق السياق والـ graph والمهمات.
- `artifacts/api-server/src/routes/*` يثبت أن التنفيذ ليس CRUD فقط: هناك state machines، queue، reconciliation، audit، وhooks.

---

## 2) ما الذي ثبت بالأدلة

### أ) العقد (Contract-first)
في `lib/api-spec/openapi.yaml` يوجد **47 path** و **58 operation** فعلية.  
هذا مهم لأنه يعني أن الـ API لم يعد “مسارات متفرقة”، بل عقد رسمي يمكن أن يُقاس عليه التوليد والتحقق.

يدعمه:
- `package.json`:
  - `codegen`
  - `codegen:check`
  - `build` يمر عبر codegen ثم typecheck ثم build.
- `lib/api-zod/src/generated/` و`lib/api-client-react/src/generated/` مذكورتان كأصول مولدة.
- `replit.md` يذكر أن `openapi.yaml` هو **مصدر الحقيقة الوحيد**.

**الأثر:** أي انحراف بين الكود والعقد يمكن التقاطه مبكرًا.

---

### ب) طبقة البيانات (Data layer)
`lib/db/src/schema/index.ts` يعيد تصدير طبقات البيانات الأساسية:

- projects
- rules
- workflows
- tasks
- events
- metrics
- graph
- task_logs
- plugins
- audit_logs
- discovery
- scan_jobs
- ai_chats

#### أدلة مهمة داخل المخطط:
- `tasks.ts` يحتوي:
  - status enum يضم: `pending`, `queued`, `running`, `verifying`, `completed`, `failed`, `cancelled`
  - `verificationResult`
  - `retryCount` / `maxRetries`
  - `dependsOn`
  - `relatedFiles`
  - `workflowId` و `ruleId`
- `workflows.ts` يحتوي:
  - phases JSON
  - `currentPhase`
  - `executionCount`
  - `workflow_executions`
- `graph.ts` يحتوي:
  - `provenance`
  - confidence
  - entities/relationships
  - ربط مباشر بـ `scan_jobs`
- `discovery.ts` يحتوي:
  - `status`: discovering / ready / error / imported
  - `steps` JSON
  - `result`
  - `importedProjectId`
- `scan_jobs.ts` يحتوي:
  - queued / running / completed / failed
  - `result`, `error`, `startedAt`, `finishedAt`
- `ai_chats.ts` يحتوي:
  - `ai_chat_sessions`
  - `ai_chat_messages`
  - roles: user / assistant / system

**الاستنتاج:** البيانات ليست “مصدر عرض”، بل **ذاكرة تشغيل** كاملة للمنصة.

---

### ج) طبقة التشغيل والأمان (Execution + Security)
في `artifacts/api-server/src/app.ts`:

- تعطيل ETag:
  - يمنع 304 bodyless التي قد تربك fetch وتُظهر بيانات ديناميكية وكأنها فشلت.
- `trust proxy = 1`
- `helmet`
- `rateLimit`
- `pino-http`
- `cors({ credentials: true, origin: true })`
- body limit = `2mb`
- `clerkMiddleware`
- `requireAuth` على `/api/*` عدا `/api/healthz`
- `no-store` لكل `/api`

**المعنى الحقيقي:**  
المشروع تجاوز “تشغيل الخادم” إلى **تشغيل خادم محكوم**.

**لكن:**  
الوثائق نفسها تقول بوضوح: **لا roles بعد**.  
هذا يعني أن الأمان الحالي هو:
- authenticated
- **غير مفصول الأدوار**
- **غير مقسم per-project access**

وهذه فجوة حقيقية وليست نظرية.

---

### د) queue + reconciliation = تشغيل resilient
`artifacts/api-server/src/lib/job-queue.ts`:
- queue داخل العملية
- سقف concurrency
- يمنع انفجار work bursts
- لا يترك unhandled rejection يقتل السيرفر

`artifacts/api-server/src/lib/job-reconciliation.ts`:
- يفحص jobs العالقة في `queued/running`
- يحولها إلى `failed`
- يعيد project من `scanning` إلى `active`
- يفعل ذلك **قبل** قبول الترافيك

`artifacts/api-server/src/index.ts`:
- ينفذ reconciliation عند startup

**الاستنتاج:**  
المنصة لا تعتمد فقط على “النجاح اللحظي”، بل على **تعافي تشغيلي** بعد الانقطاع.

---

### هـ) scan runner = all-or-nothing
`artifacts/api-server/src/lib/scan-runner.ts` يثبت أن الـ scan صار pipeline حقيقي:

`walk → match → graph → metrics → persist`

والأهم:
- كل الكتابات المهمة داخل `db.transaction`
- النتائج لا تبقى جزئية عند الفشل
- scan job row تُحدَّث
- project status يُستعاد
- `recordAudit` يبقى best-effort خارج المعاملة

**الأثر:**  
هذا يحول الفحص من “مهمة ثقيلة” إلى **عملية قابلة للحسم والرجوع**.

---

### و) discovery/import = claim + insert + FK-safe
`artifacts/api-server/src/routes/discovery.ts` يثبت أن الاستيراد لم يعد مجرد “ضغط زر”:

- claim atomic داخل transaction
- project row يُدخل أولًا
- ثم session تتحدث
- ثم الربط `imported_project_id → projects.id`

**الأثر:**  
تم حل مشكلة اتساق كانت ستكسر الـ FK لو بقي claim منفصلًا.

---

### ز) tasks = state machine حقيقية
`artifacts/api-server/src/routes/tasks.ts` يثبت أن المهمة ليست CRUD:

- status transition من pending/queued → running → completed/failed/verifying
- تحقق يعتمد على:
  1. rule pattern
  2. relatedFiles
  3. وإلا تنتقل إلى verifying
- التسجيل في `taskLogs`
- event insert
- atomic transaction للنتيجة + log + event

**الاستنتاج:**  
هذه طبقة **verification engine** داخلية وليست مجرد “تغيير حالة”.

---

### ح) workflows = execution state machine
`artifacts/api-server/src/routes/workflows.ts` يثبت:

- claim ذكي للحالة
- منع double-start
- إنشاء execution row
- event + audit
- حفظ currentPhase / executionCount / lastExecutedAt

**هذا ليس CRUD workflow**  
بل **orchestration primitive**.

---

### ط) knowledge layer = graph over graph
`lib/knowledge-engine/src/index.ts` وملفاته يثبتون:

- BFS impact queries
- shortest path
- neighbourhood
- centrality
- cluster detection
- summary stats

لكن:  
هذه الطبقة تعتمد على graph مكتمل.  
إذا كان graph فارغًا أو ناقصًا، فالنتيجة ضعيفة بطبيعة الحال.

**الاستنتاج:**  
الـ graph هنا ليس “رسمًا”، بل **طبقة معرفة قابلة للاستعلام والاستنتاج**.

---

### ي) AI layer = 7 endpoints + sessions/messages + context builder
`artifacts/api-server/src/routes/ai.ts` يثبت 7 endpoints:

- `POST /ai/chat`
- `GET /ai/chat/sessions`
- `GET /ai/chat/:sessionId/messages`
- `POST /ai/projects/:projectId/analyze`
- `POST /ai/projects/:projectId/review`
- `POST /ai/workflows/:workflowId/orchestrate`
- `POST /ai/tasks/:taskId/execute`

`lib/ai-orchestrator/src/index.ts` يثبت:
- chat
- executeTask
- analyzeScan
- reviewCode
- orchestrateWorkflow
- buildProjectContext

`lib/db/src/schema/ai_chats.ts` يثبت:
- sessions/messages
- JSON source references
- project-linked conversations

`artifacts/dashboard/src/pages/AiChat.tsx` يثبت أن هناك واجهة حقيقية للمحادثة مع المشروع.

**الاستنتاج:**  
الذكاء الاصطناعي هنا ليس زرًا تجميليًا؛ بل **طبقة تشغيل مرتبطة بالسياق والـ graph والمهام**.

---

### ك) scanner = AST حقيقي + fallback محسوب
`lib/scanner/src/index.ts` وملفاته يثبتون:
- file walker
- rule matcher
- graph extractor
- metrics calculator

والأهم:
- TS/JS عبر compiler API
- Python عبر `ast` في subprocess مجمّع
- fallback regex عند الفشل فقط

**هذا يغير طبيعة المعرفة المستخرجة** من heuristics بسيطة إلى extraction أقرب إلى الحقيقة البنيوية.

---

## 3) سجل الحالة المختصر

| الطبقة | مكتمل | جزئي | مفقود | الدليل | الأثر | الخطوة التالية |
|---|---|---|---|---|---|---|
| العقد | نعم | — | — | `openapi.yaml`, `codegen:check` | يمنع drift | توسيع التغطية إن زادت المسارات |
| البيانات | نعم | بعض الحقول تحتاج صرامة إضافية | — | `lib/db/src/schema/*` | ذاكرة تشغيل كاملة | تقوية invariants الثانوية |
| الأمان | نعم | roles/per-project ACL | RBAC | `app.ts`, `replit.md` | authenticated بلا فصل أدوار | إضافة permissions layer |
| التشغيل | نعم | — | — | `job-queue`, `job-reconciliation`, `index.ts` | resilient startup | توسيع القياس والمراقبة |
| scan pipeline | نعم | — | — | `scan-runner.ts` | all-or-nothing | تحسين التقارير الجزئية |
| discovery/import | نعم | — | — | `discovery.ts` | import آمن | توسيع التحقق من overrides |
| tasks/workflows | نعم | — | — | `tasks.ts`, `workflows.ts` | state machines فعلية | workflow step executor أعمق |
| knowledge engine | نعم | heuristics inference | inference متقدم | `queries.ts`, `inference.ts` | graph as knowledge | تعميق الدلالات/الأوزان |
| AI | نعم | لا streaming / لا retry/backoff | — | `ai.ts`, `ai-orchestrator`, `AiChat.tsx` | ذكاء مرتبط بالسياق | streaming + observability |
| dashboard | نعم | يعرض الحقيقة الحالية | — | `dashboard.ts`, `AiChat.tsx` | command center | توحيد كل الطبقات بصريًا |

---

## 4) ما الذي بقي فعلاً

1. **RBAC / permissions**
   - النظام الحالي يقول صراحة: لا roles بعد.
   - هذا يعني وصولًا كاملًا لكل مستخدم موثق.
   - هذا مقبول مرحليًا، لكنه ليس نهائيًا.

2. **streaming/retry/backoff في AI**
   - واجهة AI تعمل، لكن الطبقة ليست بعد streaming-first.
   - لا backoff متقدم في Groq wrapper كما هو واضح من البنية الحالية.

3. **أعمق من heuristics في knowledge inference**
   - centrality / cluster detection موجودة، لكنها استدلالات أولية.
   - يمكن رفعها إلى weighted provenance-aware inference.

4. **plugin runtime داخل العملية**
   - جيد للتبسيط والاختبار.
   - لكنه لا يملك عزلًا أو sandbox حقيقيًا.

5. **correlation/traceability موحّدة أكثر**
   - توجد events, task_logs, audit_logs, metrics.
   - لكنها ليست بعد “single correlation fabric” شاملًا لكل شيء.

---

## 5) الخلاصة التنفيذية

EngineeringOS الآن ليس مجرد مشروع قيد البناء؛ بل **منصة حقيقية بدأت تثبت نفسها كطبقة تحكم هندسية**.  
أقوى ما فيها اليوم:

- contract-first
- data-first
- transactional execution
- resilient queue/restart
- scanner AST
- knowledge graph + inference
- AI orchestration
- operational dashboard

وأقوى ما ينقصها اليوم:

- roles / RBAC
- per-project access
- stronger policy engine
- richer inference
- streaming AI
- unified trace/correlation

## 6) ما يجب أن يأتي بعد هذه السلسلة
الخطوة المنطقية التالية هي:
**تحويل هذا إلى سجل حالة نهائي طبقي بصيغة: مكتمل / جزئي / مفقود / الدليل / الأثر / الخطوة التالية، ملفًا ملفًا وعلى مستوى المنظومة كلها.**

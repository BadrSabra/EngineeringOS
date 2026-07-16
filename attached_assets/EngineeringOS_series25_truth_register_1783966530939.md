# EngineeringOS — السلسلة 25: سجل حالة طبقي بالأدلة من داخل الكود والملفات

**آخر تحقق عملي داخل الأرشيف:** 2026-07-13  
**هدف هذه السلسلة:** تثبيت الحقيقة التشغيلية الحالية للمشروع بعد أن أصبح واضحًا أنه ليس تطبيقًا واحدًا، بل **control plane** متعدد الطبقات: عقد API → قاعدة بيانات → discovery/scan → knowledge graph → AI orchestration → dashboard → audit/events/metrics.

---

## 1) لقطة كمية سريعة

| البند | القيمة | الدليل |
|---|---:|---|
| إجمالي الملفات داخل الأرشيف | 465 | جرد الأرشيف المرفوع |
| ملفات TypeScript | 203 | امتداد `.ts` داخل الأرشيف |
| ملفات React/TSX | 133 | امتداد `.tsx` |
| ملفات Markdown | 34 | وثائق/تقارير داخلية |
| مسارات OpenAPI | 47 | `lib/api-spec/openapi.yaml` |
| عمليات API الفعلية | 58 | نفس الملف (28 GET / 23 POST / 4 DELETE / 3 PATCH) |
| مخططات OpenAPI | 59 | `components/schemas` |
| جداول DB | 16 | `lib/db/src/schema/*.ts` |
| ملفات مخطط DB | 14 | ملفات schema منفصلة |
| ملفات الاختبارات | 15 | `api-server` + `scanner` |
| صفحات الواجهة | 15 | `artifacts/dashboard/src/pages/` |
| مسارات AI | 7 | `/api/ai/*` |

هذه الأرقام مهمة لأنها تثبت أن المشروع لم يعد “هيكلًا نظريًا”، بل سطحًا تشغيليًا واسعًا ومترابطًا.

---

## 2) ما الذي ثبت بشكل قاطع

### A) طبقة الحوكمة الأساسية موجودة، لكن التفويض ما يزال أحادي المستوى
الملف `artifacts/api-server/src/app.ts` يثبت أن الخادم يفعّل:
- `helmet`
- `express-rate-limit`
- `cors`
- `pino-http`
- `clerkMiddleware`
- `requireAuth` على كل `/api/*` باستثناء `/api/healthz`

كما أن التعليق داخل `app.ts` و`requireAuth.ts` يصرّح بوضوح أن:
- لا يوجد **RBAC**
- لا يوجد **per-project authorization**
- أي مستخدم موثّق يملك الوصول إلى كل المشاريع والمهام والقواعد والسير

**النتيجة:** الأمان الأساسي جيد، لكن طبقة التفويض الدقيقة لم تُبْنَ بعد.

---

### B) Discovery / Import أصبحت مسارًا فعليًا من الداخل وليس مجرد واجهة
الملف `artifacts/api-server/src/routes/discovery.ts` يثبت وجود ثلاث نقاط مركزية:
- `POST /api/projects/discover`
- `GET /api/projects/discover/:discoveryId`
- `GET /api/projects/discover/:discoveryId/summary`
- `POST /api/projects/import`

وهنا توجد دلائل مهمة جدًا:
- `rootPath` يُطبَّع ويُتحقق منه قبل أي enqueue.
- تُنشأ `discovery_sessions` بحالات واضحة: `discovering → ready → imported/error`.
- الاستيراد داخل **transaction** واحدة.
- المشروع يُinsert أولًا ثم يتم claim للحالة `ready → imported` داخل نفس transaction.
- إذا حدث سباق concurrent import، فالملف يعالج ذلك بحالتين:
  - claim يفشل
  - أو unique violation على `projects.root_path`
- بعد نجاح الاستيراد، تُنشأ:
  - صف metrics أولي
  - entities مبدئية في graph
  - tasks من violations
  - حدث `ProjectImported`
  - audit record

**النتيجة:** discovery لم يعد “wizard UI” فقط؛ بل pipeline متكامل وذكي ومؤمَّن من الداخل.

---

### C) Scan runner أصبح atomic ومراقَب ومُعافى بعد restart
الملف `artifacts/api-server/src/lib/scan-runner.ts` يثبت أن الفحص يعمل بهذا التسلسل:
1. تحميل المشروع والقواعد المفعلة
2. `walkProject`
3. `matchRules`
4. `computeMetrics`
5. `extractGraph`
6. إدخال tasks وgraph entities/relationships وmetrics وevent وproject update داخل **transaction**
7. تسجيل audit **بعد** commit
8. dispatch للـ plugin hooks **بعد** commit

والأهم:
- كل الفحص محاط بـ `try/catch`
- أي فشل يسجل job كـ `failed`
- المشروع يُعاد إلى `active`
- `correlationId` يربط scan metrics + audit + event
- لا يوجد تسريب rejection خارج العملية

**النتيجة:** scan pipeline صار transactional، traceable، ومقروءًا كسجل واحد متماسك.

---

### D) الطوابير والعمل الخلفي مضبوطان لكنهما ما يزالان in-process
`artifacts/api-server/src/lib/job-queue.ts` يثبت:
- queue محدود التزامن
- السقف الحالي: **2**
- jobs تُشغَّل fire-and-forget
- أي خطأ لا يكسر queue ولا يخلق unhandled rejection

`artifacts/api-server/src/lib/job-reconciliation.ts` يضيف:
- عند الإقلاع تُفحص jobs العالقة
- أي `scan_jobs` في `queued/running` تتحول إلى `failed`
- أي project عالق في `scanning` يعود إلى `active`
- أي `discovery_sessions` عالقة في `discovering` تتحول إلى `error`

**النتيجة:** هناك self-healing عند restart، لكن التنفيذ ما يزال in-memory وليس durable queue خارجي.

---

### E) المعرفة ليست مجرد graph؛ بل طبقة استعلام واستدلال حقيقية
الملف `lib/knowledge-engine/src/index.ts` يثبت أن الحزمة توفر:
- typed graph queries
- in-memory inference
- summary computations

والملف `lib/knowledge-engine/src/queries.ts` يثبت وجود:
- `getImpactedEntities`
- `getShortestPath`
- `getNeighborhood`
- `fetchProjectGraph`

وكلها DB-backed، pure، وبـ BFS traversal واضح.

الملف `lib/knowledge-engine/src/inference.ts` يثبت:
- centrality
- cluster detection
- graph summary

**النتيجة:** graph في EngineeringOS ليس “عرضًا بصريًا” فقط، بل طبقة معرفة قابلة للاستدلال.

---

### F) طبقة الذكاء الاصطناعي أصبحت وظيفية فعلًا
`lib/ai-orchestrator/src/index.ts` يثبت وجود:
- `chat`
- `executeTask`
- `analyzeScan`
- `reviewCode`
- `orchestrateWorkflow`
- `buildProjectContext`

والملف `artifacts/api-server/src/routes/ai.ts` يثبت 7 endpoints:
- `/api/ai/chat`
- `/api/ai/chat/sessions`
- `/api/ai/chat/:sessionId/messages`
- `/api/ai/projects/:projectId/analyze`
- `/api/ai/projects/:projectId/review`
- `/api/ai/workflows/:workflowId/orchestrate`
- `/api/ai/tasks/:taskId/execute`

كما يثبت أن:
- كل عملية AI تُسجَّل في events أو task_logs أو audit
- `executeTask` يمر عبر atomic claim على task
- النتائج تذهب إلى `verificationResult`
- `workflow orchestrate` يقرأ current phase + completed phases + project context
- `buildProjectContext` يجمع:
  - project
  - recent tasks
  - latest metrics
  - graph summary
  - recent events

**النتيجة:** AI هنا ليس نقطة عرض منفصلة؛ بل طبقة تشغيلية مدمجة مع حالة المشروع.

---

### G) الواجهة أصبحت تعكس الحقيقة الداخلية
`artifacts/dashboard/src/pages/` تحتوي 15 صفحة، منها:
- `DiscoverProjectWizard`
- `AiChat`
- `Projects`
- `ProjectDetail`
- `Tasks`
- `Workflows`
- `Rules`
- `Events`
- `Metrics`
- `Graph`

**النتيجة:** الواجهة لم تعد صفحة تسجيل بسيطة؛ بل مركز قيادة يعكس الطبقات الداخلية الأساسية.

---

## 3) سجل حالة طبقي

| الطبقة | الحالة | الدليل | الأثر | الخطوة التالية |
|---|---|---|---|---|
| API security | مكتمل جزئيًا | `app.ts`, `requireAuth.ts` | حماية أساسية قوية | إضافة RBAC / project-scoped permissions |
| Discovery/import | مكتمل تقريبًا | `routes/discovery.ts`, `discovery_sessions` | onboarding autonomic حقيقي | فصل job execution durable خارج الذاكرة |
| Scan pipeline | مكتمل تقريبًا | `scan-runner.ts`, `scan_jobs` | scan atomic مع traceability | رفع durability والـ retry semantics |
| Knowledge graph | مكتمل | `graph.ts`, `knowledge-engine` | استدلال وتأثير/مسار/حيز معرفة | توسيع الاستدلال المتعدد القفزات |
| AI orchestration | مكتمل وظيفيًا | `ai.ts`, `ai-orchestrator` | AI مدمج مع سياق المشروع | ربط أوسع بباقي المسارات العامة |
| Workflow engine | جزئي | `workflows.ts`, `workflow_executions` | orchestration موجود | تعميق phase semantics وfailure recovery |
| Observability | جزئي قوي | `events.ts`, `metrics.ts`, `task_logs.ts`, `audit.ts` | traceable platform | توحيد correlation across all flows |
| UI | مكتمل من ناحية التغطية | dashboard pages | مرآة للمنصة | جعل الواجهة تظهر قيود الحوكمة بوضوح |
| Tests | جيد لكن غير متساوٍ | `api-server` + `scanner` tests | ثقة أعلى في الأنوية | إضافة tests للـ AI والـ knowledge-engine |

---

## 4) ما يزال ناقصًا بالفعل

### 1) RBAC وAuthorization الدقيق
هذا هو أكبر gap واضح:
- لا توجد أدوار
- لا توجد project ownership rules
- لا توجد tenant boundaries
- لا توجد permission matrix

### 2) Durable background execution
الحالية:
- queue in-process
- reconciliation عند restart
- مناسب لمنتج داخلي
- لكنه ليس durable queue production-grade بعد

### 3) اختبارات الطبقات الجديدة
الـ scanner والـ api-server لديهما اختبارات واضحة، لكن:
- `knowledge-engine` بلا tests ظاهرة
- `ai-orchestrator` بلا tests ظاهرة
- وهذا يترك سلوك الطبقات الذكية أقل تثبيتًا من باقي النظام

### 4) التفعيل التلقائي الأوسع للذكاء الاصطناعي
الذكاء موجود وقوي، لكن ما يزال جزءًا منه عبر endpoints واضحة بدل أن يكون مدموجًا بالكامل في كل مسار تشغيل.

---

## 5) الخلاصة العملية

EngineeringOS اليوم ليس مشروعًا ناقص الفكرة؛ بل مشروعًا **اكتملت فكرته التشغيلية الأساسية**، مع بقاء ثلاثة أشياء حاسمة قبل النضج الكامل:
1. **تفويض دقيق** بدل التفويض الأحادي
2. **Durability** أعلى في الخلفية
3. **توحيد traceability + tests** في الطبقات الذكية

إذا عولجت هذه الثلاثة، يصبح المشروع أقرب إلى منصة حوكمة هندسية كاملة لا مجرد مجموعة خدمات متقدمة.

---

## 6) ترتيب الاستكمال التالي

1. إضافة RBAC / project-scoped authorization
2. نقل heavy jobs إلى durability حقيقية أو طبقة persistence أقوى
3. إضافة tests للـ AI orchestration والـ knowledge engine
4. توحيد correlation tracing عبر كل الأحداث والـ logs والـ metrics
5. تعميق workflow engine ليصبح state machine غنيًّا وقابلًا للتعافي
6. تحديث الواجهة لتعرض القيود والصلاحيات بشكل صريح


# EngineeringOS — السلسلة 14
## تثبيت الحقيقة التشغيلية بعد اكتمال طبقات المعرفة والذكاء والحوكمة

**آخر تحقق:** 2026-07-13  
**موضوع السلسلة:** هذه السلسلة لا تعيد شرح المشروع من الصفر؛ بل تثبّت ما أصبح مثبتًا فعلًا داخل الكود والملفات بعد اكتمال طبقات scanner / knowledge-engine / plugin-runtime / ai-orchestrator / workflow orchestration / UI depth، ثم تفرز ما بقي من فجوات حاكمة لا يجوز تجاهلها.

---

## 1) الخلاصة العليا

EngineeringOS لم يعد “هيكل مشروع” ولا “فكرة مبتكرة” فقط، بل أصبح **منصة تشغيلية متعددة الطبقات** فيها:
- **عقود API-first**.
- **طبقة بيانات** واضحة ومقسمة.
- **محرك فحص** مستقل.
- **طبقة معرفة بيانية** قابلة للتنقل والتحليل.
- **طبقة ذكاء اصطناعي** متعددة الوكلاء.
- **طبقة تنفيذ/حوكمة** عبر المهام والسير العمل والتنبيهات والسجل.
- **واجهة تشغيلية** تعكس الحقيقة الداخلية بدل واجهة تجميلية.

لكن هذا لا يعني أن المشروع مكتمل. ما يزال هناك 4 فجوات حاكمة لا يمكن اعتبارها “تفاصيل صغيرة”:
1. **RBAC / Authorization التفصيلي** غير موجود بعد؛ الوصول ما يزال “مستخدم موثق = وصول كامل”.
2. **Correlation ID موحّد** لم يُنسّج عبر audit/events/task-logs/metrics.
3. **Workflow branching/conditions** موجودة في الشكل فقط، لا في المحرك.
4. **AI streaming + auto-trigger** ما تزال مؤجلة؛ الذكاء يعمل، لكنه ليس بعد “مستمرًا/متدفقًا/مرتبطًا تلقائيًا بكل trigger”.

---

## 2) أرقام تثبت أن المشروع نضج بنيويًا

من الأرشيف الحالي:

- **47 مسارًا API** في `lib/api-spec/openapi.yaml`.
- **59 schema** داخل OpenAPI.
- **14 ملفًا** في طبقة DB schema تحت `lib/db/src/schema/`.
- **13 ملف route** فعليًا في `artifacts/api-server/src/routes/`.
- **7 ملفات route tests**.
- **14 اختبارًا** على مستوى المستودع في المسارات/المحركات التنفيذية الأساسية.
- **15 صفحة dashboard** رئيسية.
- **11 ملفًا** في `lib/scanner/src/` (غير الاختبارات).
- **5 وكلاء ذكاء** في `lib/ai-orchestrator/src/agents/`.

هذه الأرقام مهمة لأنها لا تصف “كثرة الملفات” فقط، بل تثبت أن المشروع انتقل من فكرة متفرقة إلى **سلسلة تشغيلية مترابطة**.

---

## 3) ما الذي ثبت من داخل الكود فعلًا

### 3.1 OpenAPI-first ليس شعارًا؛ بل خط بناء
- `package.json` في الجذر يفرض:
  - `codegen`
  - `codegen:check`
  - `build` = codegen + typecheck + build
- `replit.md` يصرّح أن:
  - `lib/api-spec/openapi.yaml` هو **مصدر الحقيقة الوحيد** للعقود.
  - التوليد يعيد بناء `api-zod` و`api-client-react`.
- ملفات المخرجات المولدة موجودة فعلًا تحت:
  - `lib/api-zod/src/generated/`
  - `lib/api-client-react/src/generated/`

**الأثر:** أي تغيير بالعقد يجب أن يمر عبر codegen وإلا ينكشف drift فورًا. هذه ليست وثائق نظرية؛ هذا خط إنتاج فعلي.

---

### 3.2 طبقة التنفيذ الخلفي ليست fire-and-forget بلا ضوابط
في `artifacts/api-server/src/lib/job-queue.ts`:
- queue محدود التزامن.
- يمنع الانفجار الحر للمهام الثقيلة.
- يعزل فشل مهمة واحدة عن بقية النظام.

في `artifacts/api-server/src/lib/job-reconciliation.ts`:
- أي job عالق في `queued/running` بعد restart يُحوَّل إلى `failed`.
- المشروع المرتبط يُعاد إلى الحالة السليمة بدل أن يظل stuck.

في `artifacts/api-server/src/lib/scan-runner.ts`:
- الشغل الثقيل (`walkProject`, `matchRules`, `extractGraph`, `computeMetrics`) منفصل عن route handler.
- العمليات الحاسمة أصبحت داخل transaction.
- plugin dispatch + audit بعد commit.

**الأثر:** هذا يثبت أن المنصة لا تعتمد فقط على “تشغيل شيء ما”، بل على **تشغيل يمكن استعادته ومراقبته**.

---

### 3.3 Scanner أصبح حقيقة تحليلية لا مجرد walker
المؤشرات الدالة:
- `lib/scanner/src/graph-extractor.ts`
- `lib/scanner/src/python-extractor.ts`
- اختبارات scanner في `lib/scanner/src/__tests__/`

الذاكرة التشغيلية `/.agents/memory/scanner-ast-extraction.md` توضّح أن:
- TS/JS parsing صار AST-based.
- CommonJS و `export =` و class methods مغطاة.
- Python parsing صار structural عبر `python3 ast` في subprocess مجمّع.

**الأثر:** scanner لم يعد مجرد “قراءة ملفات”، بل محرك استخراج كيانات وعلاقات متعدد اللغات.

---

### 3.4 المعرفة البيانية أصبحت طبقة استعلام فعلية
في `lib/knowledge-engine/src/queries.ts`:
- BFS للـ impact.
- shortest path.
- neighborhood.

وفي `lib/knowledge-engine/src/inference.ts`:
- centrality.
- cluster detection.
- graph summary.

ومعها في `artifacts/api-server/src/routes/graph.ts`:
- `impact`
- `path`
- `summary`
- `neighbors`

**الأثر:** graph لم يعد صفحة شكلية؛ أصبح طبقة معرفة قابلة للتنقل والتحليل.

---

### 3.5 طبقة الذكاء الاصطناعي أصبحت حقيقية ومركبة
في `lib/ai-orchestrator/`:
- `context-builder.ts` يجمع context من DB.
- 5 وكلاء:
  - chat-agent
  - task-agent
  - scan-analyst
  - code-reviewer
  - workflow-orchestrator

وفي `artifacts/api-server/src/routes/ai.ts`:
- `/api/ai/chat`
- sessions/messages
- analyze
- review
- orchestrate
- execute task

ومعها في dashboard:
- صفحة `AiChat.tsx`
- quick actions
- session sidebar
- sources badges

**الأثر:** الذكاء هنا ليس “زرًا للتجربة”، بل طبقة تشغيل تستند إلى project context الحقيقي.

---

### 3.6 واجهة التشغيل أصبحت تعكس الحقيقة الداخلية
ملفات مثل:
- `artifacts/dashboard/src/pages/Graph.tsx`
- `Tasks.tsx`
- `Rules.tsx`
- `Workflows.tsx`
- `ProjectDetail.tsx`
- `Events.tsx`
- `DiscoverProjectWizard.tsx`
- `AiChat.tsx`

تُظهر أن الواجهة لم تعد مجرد dashboard ثابتة، بل:
- graph explorer تفاعلي،
- task logs،
- filters حقيقية،
- workflow execution history،
- discovery/onboarding path،
- AI chat operational workspace.

**الأثر:** UI الآن يترجم البنية الداخلية بدل أن يخفيها.

---

## 4) أين تقف الحقيقة الآن: مكتمل / جزئي / مفقود

### مكتمل بنيويًا
- OpenAPI-first pipeline.
- DB schemas الأساسية.
- scanner متعدد اللغات.
- knowledge engine.
- plugin runtime.
- audit/event emission على عمليات mutation.
- AI orchestration layer.
- dashboard صفحات تشغيلية متعددة.

### جزئي
- `recordAudit` best-effort telemetry وليس إلزامًا blocking.
- بعض صفحات الواجهة ما تزال أبسط من الطبقة الخلفية.
- `ProjectDetail` و `Metrics` ما يزالان أقل عمقًا من بقية الطبقات.
- بعض route groups ما زالت بدون tests مباشرة رغم أن المسارات الحرجة مغطاة بشكل غير مباشر.

### مفقود / غير مكتمل
- RBAC الحقيقي.
- shared correlation ID.
- workflow branching logic.
- AI streaming / SSE.
- auto-trigger للذكاء عند تحوّل المهمة أو scan state إلى حالات معينة.
- rollback أوسع للسير العمل بخلاف retry-in-place.

---

## 5) أدلة دقيقة على الفجوات المتبقية

### 5.1 الوصول ما يزال all-or-nothing
`replit.md` يصرّح صراحة:
- كل `/api/*` يتطلب Clerk auth
- **لا يوجد تمييز أدوار بعد**
- أي مستخدم مسجّل له وصول كامل لكل المشاريع والبيانات

هذا أهم gap أمني/حوكمي حاليًا.

### 5.2 traceability غير موحدة بعد
`docs/completion-plan.md` يذكر أن ما يزال غير منفذ:
- correlation ID موحد بين audit/events/task-logs/metrics

هذا يعني أن “منظور العملية الواحدة” لا يزال مقسومًا على أكثر من مفتاح.

### 5.3 workflow engine ليس branching engine بعد
في `docs/completion-plan.md`:
- `phases[].condition` موجودة في schema
- لكنها لا تُقيَّم بعد
- rollback إلى phase سابق ليس موجودًا بعد

هذا يثبت أن المحرك أصبح state machine، لكنه ليس بعد orchestration graph كامل.

### 5.4 الذكاء الاصطناعي ما يزال request/response أكثر من stream/automation
في `docs/completion-plan.md`:
- SSE/streaming ما زال مؤجلًا
- auto-trigger عند `verifying` أو عند توفر `prompt` ما يزال مؤجلًا

هذا يعني أن AI layer قوية، لكن ما تزال “مُستدعاة” أكثر من كونها “مُدمجة سلوكيًا” في كل نقطة مناسبة.

---

## 6) طبقات المشروع كما تظهر الآن

### الطبقة 1: العقد والحوكمة التقنية
- `lib/api-spec/openapi.yaml`
- `scripts/check-codegen-drift.ts`
- `lib/api-zod/src/generated/`
- `lib/api-client-react/src/generated/`

### الطبقة 2: البيانات
- `lib/db/src/schema/*.ts`
- جداول: projects, tasks, workflows, events, metrics, graph, scan_jobs, discovery, plugins, audit_logs, task_logs, ai_chats

### الطبقة 3: التنفيذ
- `artifacts/api-server/src/lib/job-queue.ts`
- `artifacts/api-server/src/lib/job-reconciliation.ts`
- `artifacts/api-server/src/lib/scan-runner.ts`

### الطبقة 4: الاستكشاف والتحليل
- `lib/scanner/`
- `lib/knowledge-engine/`

### الطبقة 5: الذكاء
- `lib/ai-orchestrator/`
- `artifacts/api-server/src/routes/ai.ts`

### الطبقة 6: التشغيل الظاهر
- `artifacts/dashboard/src/pages/*`

### الطبقة 7: الشهادة/الأثر
- `events`
- `audit_logs`
- `task_logs`
- `metrics`
- `docs/fact-record.md`
- `docs/completion-plan.md`

---

## 7) سجل حالة مختصر على مستوى المنظومة

| الطبقة | الحالة | الدليل | الأثر | الخطوة التالية |
|---|---|---|---|---|
| OpenAPI/codegen | مكتمل عمليًا | openapi + drift check + generated clients | يمنع انفصال العقد عن التنفيذ | الحفاظ على الاتساق |
| DB schema | قوي جدًا | 14 schema files + FK تدريجي | أساس صلب للمنصة | تدقيق invariants المتبقية |
| Job execution | مكتمل جزئيًا | queue + reconciliation + transactions | يمنع الانسداد | توسيع durability |
| Scanner | قوي | AST + Python subprocess + tests | استخراج حقيقي متعدد اللغات | تغطية أعمق للحالات النادرة |
| Knowledge graph | قوي | impact/path/summary/neighbors | graph قابل للاستخدام | تحسين UX/visualization |
| Workflows | state machine حقيقية | advance/fail/retry + tests | orchestration فعلية | branching/conditions |
| Traceability | جيد لكن غير موحد | audit + events + task logs | قابل للتتبع | correlation ID موحد |
| AI layer | متقدم | 5 agents + /api/ai/* + chat UI | ذكاء مرتبط بالسياق | streaming + auto-trigger |
| Authz | ضعيف نسبيًا | all authenticated users equal | gap حوكمي كبير | RBAC/ACL/policy engine |
| UI | ناضج تشغيلًا | graph/tasks/rules/workflows/ai | يعكس الحقيقة | تعميق الصفحات البسيطة |

---

## 8) القراءة العملية التالية

لو أردنا إكمال المشروع بطريقة صحيحة، فالتسلسل المنطقي الآن ليس UI، وليس زيادة endpoints عشوائيًا. الأولوية الفعلية هي:

1. **إغلاق RBAC / policy engine**.
2. **توحيد correlation IDs عبر كل الشهادات التشغيلية**.
3. **إكمال branching workflows** بدل retry-in-place فقط.
4. **إضافة streaming و auto-trigger للـ AI**.
5. **تعميق الصفحات التي ما تزال سطحية نسبيًا**.
6. **رفع الوثائق إلى نسخة نهائية متطابقة مع الكود**.

---

## 9) الحكم النهائي لهذه السلسلة

المشروع الآن **ليس prototype**.  
هو **control plane هندسي حقيقي**، متعدّد الطبقات، ومثبت بالأدلة من الكود والملفات.  
لكن الحوكمة النهائية ما تزال ناقصة في ثلاثة أماكن لا ينبغي التقليل منها:
- التفويض.
- التتبّع الموحّد.
- منطق orchestration الشرطي.

هذه هي السلسلة التي تفصل بين “منصة تعمل” و“منصة موثوقة بالكامل”.


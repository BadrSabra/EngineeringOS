# EngineeringOS — السلسلة 17: التحليل العميق بالأدلة من داخل الكود والملفات

**تاريخ القراءة:** 2026-07-13  
**النطاق:** الأرشيف المرفوع `EngineeringOS-main (26).zip`  
**هدف السلسلة:** تثبيت صورة المشروع الحالية بدليل مباشر من الملفات الحاكمة، ثم تحويلها إلى خطة استكمال عملية لا تبدأ من الواجهة بل من الداخل إلى الخارج.

---

## 1) الخلاصة التنفيذية

EngineeringOS لم يعد “فكرة منصة” فقط؛ الأرشيف يثبت أنه وصل إلى **control plane متعدد الطبقات** يعمل على أربع طبقات مترابطة:

1. **طبقة العقد والاتفاقات**: OpenAPI هو المصدر الوحيد للحقيقة، ومعه توليد Zod وReact Query.
2. **طبقة التنفيذ والتشغيل**: API server، scan runner، discovery/import، job queue محدود، reconciliation عند إعادة التشغيل.
3. **طبقة المعرفة والتحليل**: scanner + knowledge-engine + graph + metrics + provenance + audit.
4. **طبقة الذكاء الاصطناعي والتوجيه**: ai-orchestrator + AI routes + AI chat + multi-agent workflow.

النتيجة ليست مجرد تعدد ملفات؛ النتيجة أن المنصة صارت تبني **تتبّعًا موحدًا** بين `events` و`task_logs` و`metrics` و`audit_logs` و`correlationId`، مع آليات تمنع الانهيار الصامت أثناء التشغيل.  
لكن في المقابل، بقيت فجوة واضحة جدًا: **التفويض (authorization) ما يزال أحادي المستوى**؛ يوجد تسجيل دخول، لكن لا توجد أدوار أو صلاحيات تفصيلية بعد.

---

## 2) الأدلة الصلبة التي تثبت مرحلة النضج الحالية

### 2.1 العقد ليست شكلية
في `lib/api-spec/openapi.yaml` يوجد **47 مسارًا** و**58 عملية API** فعلية. التوزيع ليس عشوائيًا:

- Workflows: 10
- Tasks: 9
- Projects: 8
- AI: 7
- Rules: 6
- KnowledgeGraph: 6
- Discovery: 4
- Plugins: 3
- Metrics: 2
- Health / Events / Dashboard: 1 لكل منها

هذا مهم لأن النظام لم يعد “CRUD بسيطًا”، بل أصبح يحتوي على:
- discovery
- scan jobs
- execution
- rollback / retry
- graph impact/path queries
- AI chat / orchestration
- plugin hooks
- metrics / dashboard summarization

### 2.2 قاعدة البيانات أصبحت طبقة حقيقة وليست مجرد تخزين
في `lib/db/src/schema/` توجد **16 جدولًا** مترابطًا:

- `projects`
- `rules`
- `workflows`
- `workflow_executions`
- `tasks`
- `events`
- `metrics`
- `graph_entities`
- `graph_relationships`
- `task_logs`
- `plugins`
- `audit_logs`
- `discovery_sessions`
- `scan_jobs`
- `ai_chat_sessions`
- `ai_chat_messages`

هذه ليست جداول عرضية؛ بل كل جدول يخدم طبقة تشغيل:
- `scan_jobs` و`discovery_sessions` للتنفيذ الخلفي.
- `graph_*` للمعرفة البيانية.
- `audit_logs` و`events` و`task_logs` للتتبع.
- `ai_chat_*` لطبقة الذكاء.
- `workflow_executions` لتاريخ التنفيذ.
- `metrics` لنتائج القياس.

### 2.3 المشروع يكتب نفسه بوصفٍ حاكمٍ لذاته
في `docs/fact-record.md` آخر تحقق مسجّل هو **2026-07-13**، ويذكر بوضوح:
- اكتمال طبقة الذكاء الاصطناعي.
- وجود `lib/ai-orchestrator`.
- وجود `lib/knowledge-engine`.
- وجود 7 endpoints تحت `/api/ai/*`.
- وجود صفحة `AiChat` في اللوحة.
- أن `codegen` يمر بنجاح.
- أن `typecheck` نظيف.

وفي `docs/completion-plan.md` توجد قاعدة تصميم صريحة:  
**العمل يجب أن يبدأ من الداخل إلى الخارج**:  
data → execution → analysis → orchestration → governance → tests → presentation → docs

وهذا ليس مجرد نص تنظيمي؛ هذا هو ترتيب الاستكمال الفعلي.

---

## 3) تحليل الطبقات من داخل الملفات

### 3.1 طبقة التنفيذ: النظام صار يشتغل كـ control plane
#### الأدلة:
- `artifacts/api-server/src/lib/job-queue.ts`
- `artifacts/api-server/src/lib/job-reconciliation.ts`
- `artifacts/api-server/src/lib/scan-runner.ts`
- `artifacts/api-server/src/routes/projects.ts`
- `artifacts/api-server/src/routes/discovery.ts`

#### ما الذي ثبت؟
- هناك **queue محدود التزامن** بسعة 2 فقط.
- scan/discovery لم يعودا fire-and-forget عشوائيين؛ أصبحا تحت queue مضبوط.
- عند إعادة تشغيل الخادم، يتم **تسوية jobs العالقة**:
  - queued / running تتحول failed
  - المشروع stuck in scanning يعود active
  - discovery sessions stuck تتحول error
- `runScanJob()` لا يرمي خارج العملية؛ أي فشل يُسجل ويُغلق بأمان.
- `performScan()` يعامل العملية كوحدة trace واحدة عبر `correlationId`.

#### المعنى:
المنصة لم تعد “تطلق عمليات” فقط؛ بل تدير **دورة حياة تشغيلية**:
enqueue → run → persist → reconcile → audit → metrics

### 3.2 طبقة البيانات: العلاقات الآن هي العمود الفقري
#### أدلة مباشرة:
- `projects.projectId` تُستخدم كجذر ربط في أغلب الجداول.
- `tasks` ترتبط بـ `rules` و`workflows`.
- `workflow_executions` ترتبط بـ `workflows`.
- `graph_entities.scanJobId` يربط المعرفة بعملية الفحص التي ولّدتها.
- `events`, `task_logs`, `metrics` تحمل `correlationId`.
- `audit_logs` تحفظ actor / before / after / changedFields / correlationId.

#### ما الذي يعنيه هذا؟
البيانات ليست مجرد snapshot؛ بل **سلسلة سببية قابلة للتتبع**.  
هذا من أهم ما في EngineeringOS: كل عملية مهمة تستطيع أن تُقرأ كقصة كاملة:
- ماذا بدأ؟
- ماذا حدث؟
- ماذا تغيّر؟
- ماذا فشل؟
- ماذا سجّل؟
- ماذا ولّد معرفة أو مهمة جديدة؟

### 3.3 طبقة المعرفة: الـ scanner لم يعد text search
#### الأدلة:
- `lib/scanner/src/file-walker.ts`
- `lib/scanner/src/graph-extractor.ts`
- `lib/scanner/src/python-extractor.ts`
- `lib/scanner/src/rule-matcher.ts`
- `lib/scanner/src/metrics-calc.ts`
- `lib/knowledge-engine/src/index.ts`

#### ما الذي ثبت؟
- walkProject يلتقط الملفات المصدرية ويحدّد اللغة والحجم والخطورة.
- graph-extractor يبني entities وrelationships من TS/JS وPython.
- Python extraction يستعمل `ast` الحقيقي عبر subprocess.
- rule-matcher يطبّق regex آمنة مع caps على الاستهلاك.
- metrics-calc يحسب score متعدد الأبعاد: security, reliability, maintainability, performance, architecture.
- knowledge-engine يوفّر:
  - impacted entities
  - shortest path
  - neighborhood
  - graph summary
  - centrality / clusters

#### المعنى:
المنصة تبني **graph knowledge layer** حقيقية، وليست مجرد “فهارس ملفات”.

### 3.4 طبقة الذكاء الاصطناعي: متعددة الوكلاء وليست نداءً واحدًا
#### الأدلة:
- `lib/ai-orchestrator/src/index.ts`
- `lib/ai-orchestrator/src/agents/chat-agent.ts`
- `lib/ai-orchestrator/src/agents/task-agent.ts`
- `lib/ai-orchestrator/src/agents/scan-analyst.ts`
- `lib/ai-orchestrator/src/agents/code-reviewer.ts`
- `lib/ai-orchestrator/src/agents/workflow-orchestrator.ts`
- `artifacts/api-server/src/routes/ai.ts`
- `lib/db/src/schema/ai_chats.ts`

#### ما الذي ثبت؟
- هناك orchestrator واحد يجمع عدة قدرات:
  - chat
  - task execution
  - scan analysis
  - code review
  - workflow orchestration
- `ai/chat` يخزن المحادثة في قاعدة البيانات.
- الردود تحفظ مصادرها.
- الـ AI لا يعمل منفصلًا عن المشروع؛ بل يبني context من المشروع نفسه.
- توجد جلسات ورسائل AI مخزنة ومعروضة في الواجهة.

#### المعنى:
هذا ليس “chatbot”؛ هذه **طبقة توجيه وتشغيل معرفي** داخل المنصة.

### 3.5 طبقة الحوكمة: جيدة جدًا، لكن ليست مكتملة
#### الأدلة:
- `lib/db/src/schema/audit_logs.ts`
- `artifacts/api-server/src/lib/audit.ts`
- `artifacts/api-server/src/routes/events.ts`
- `artifacts/api-server/src/lib/plugin-runtime.ts`
- `artifacts/api-server/src/routes/plugins.ts`

#### ما الذي ثبت؟
- audit logs موجودة كطبقة provenance.
- audit writes best-effort حتى لا تكسر mutation الناجحة.
- events وtask_logs وmetrics تشترك في correlationId.
- plugins runtime داخل العملية نفسها، مع hook `onScanComplete`.
- enabled plugins تُشغَّل وتضيف events.

#### ما الذي ما يزال ناقصًا؟
- لا توجد **RBAC** متعددة الأدوار.
- لا توجد **policy engine** موحدة.
- authorization ما يزال “كل المستخدمين الموثّقين لهم وصول كامل”.
- بعض مسارات التتبع ما تزال تحتاج توحيدًا أعمق بين generated schema والاستعلامات اليدوية.

---

## 4) الواجهة الحالية تعكس الداخل بشكل أفضل من المعتاد

### الأدلة:
- `artifacts/dashboard/src/pages/DiscoverProjectWizard.tsx`
- `artifacts/dashboard/src/pages/AiChat.tsx`
- `artifacts/dashboard/src/pages/ProjectDetail.tsx`
- `artifacts/dashboard/src/App.tsx`

#### ما الذي ثبت؟
- يوجد onboarding discovery فعلي بدل “نموذج تسجيل مشروع” بسيط.
- `ProjectDetail` يراقب scan jobs ويعمل polling أثناء حالة `scanning`.
- `AiChat` يتعامل مع جلسات ورسائل ومصادر.
- الواجهة مقسّمة إلى:
  - Projects
  - Tasks
  - Rules
  - Workflows
  - Events
  - Metrics
  - Graph
  - AI Chat

#### المعنى:
الواجهة ليست زينة؛ هي انعكاس مباشر للبنية الداخلية.

---

## 5) أين يقف المشروع الآن فعليًا؟

### مكتمل بدرجة قوية
- OpenAPI-first + codegen
- DB schema مترابط
- execution backend لحالات scan/discovery/tasks/workflows
- knowledge graph / metrics
- AI layer متعددة الوكلاء
- audit / events / task logs
- dashboard التشغيلية
- test files موجودة حول الأجزاء الحساسة

### جزئي
- التفويض التفصيلي
- policy engine
- correlation consistency في كل الحدود
- plugin extensibility خارج runtime الحالي
- workflow engine depth
- scanner depth لبعض اللغات/البنى
- observability الموحدة على مستوى كل العمليات

### مفقود أو غير مكتمل
- RBAC حقيقي
- authorization per project / role / capability
- multi-tenant governance صلب
- durable worker system خارج العملية الواحدة
- contract-level exposure لكل الفلاتر الداخلية في generated schema
- تحول workflows إلى orchestrator ناضج كامل

---

## 6) ما الذي يضيفه هذا التحليل مقارنة بالسلاسل السابقة؟

هذه السلسلة تثبت أن EngineeringOS ليس:
- مجرد dashboard،
- ولا API،
- ولا scanner،
- ولا AI overlay.

بل هو **منصة حوكمة هندسية متعددة الطبقات** فيها:
- عقود
- تشغيل
- معرفة
- ذكاء
- تدقيق
- استرداد بعد الفشل
- وتتبع سببي موحد

والأهم: أثبتت الملفات أن المنصة **تستطيع الآن أن تصف نفسها وتشغّل نفسها وتراقب نفسها** بدرجة معقولة، لكن ما تزال تحتاج إغلاق طبقة الصلاحيات والسياسات كي تصبح “trusted control plane” كاملًا.

---

## 7) خطة الاستكمال التالية، بالترتيب الصحيح

1. **إغلاق RBAC / authorization**
   - أدوار
   - صلاحيات
   - نطاق مشروع
   - حماية endpoints الحساسة

2. **تثبيت policy engine**
   - قواعد قرار موحدة
   - فصل capability عن الوصول
   - منع قرارات متضاربة بين routes

3. **تعميق workflow engine**
   - phase transitions صارمة
   - retry / rollback / failure history
   - execution trace أوضح

4. **توسيع scanner / graph depth**
   - Python and multi-language edges
   - deeper relationships
   - better provenance on every node/edge

5. **توحيد observability**
   - correlationId everywhere
   - one trace across events / logs / metrics / audit

6. **رفع dashboard لتصبح operational truth layer**
   - phase history
   - graph exploration
   - execution logs inline
   - error/failure states أكثر وضوحًا

---

## 8) السجل المختصر النهائي

EngineeringOS الآن:
- **أصبح control plane فعليًا**
- **يملك data plane واضحًا**
- **يبني knowledge layer حقيقية**
- **يستخدم AI layer متعددة الوكلاء**
- **لكن ما يزال ناقصه RBAC/policy/durability كي يكتمل كمنصة موثوقة بالكامل**

---

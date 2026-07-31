# EngineeringOS — السلسلة 28: شبكة التتبّع، الحالة، والحوكمة التشغيلية

## الفكرة المركزية

هذه السلسلة لا تثبت فقط أن EngineeringOS يملك طبقات متعددة، بل تثبت أن المشروع بدأ يتحول إلى **شبكة تتبّع تشغيلية**: كل عملية مهمة تقريبًا تترك أثرًا في أكثر من قناة واحدة، ويستطيع النظام أن يعيد بناء القصة الكاملة للعمل من خلال `events` و`audit_logs` و`task_logs` و`metrics` و`correlationId` و`workflow_executions` و`scan_jobs`.

التحول المهم هنا ليس كثرة الـ endpoints، بل انتقال المشروع من “CRUD” إلى **stateful control plane**: المشروع، المهمة، workflow، scan، discovery، والـ AI layer كلها أصبحت تتصرف كسير عمل ذي حالات، وليس كسجل بيانات ساكن.

---

## ما الذي ثبت من داخل الكود والملفات

### 1) هناك طبقة حماية تشغيلية أساسية، لكن التفويض ما يزال أحادي المستوى

في `artifacts/api-server/src/app.ts`:
- `etag` معطل لتجنب 304 bodyless responses في البيانات الديناميكية.
- `helmet` مفعّل.
- `trust proxy = 1` مضبوط بدقة لقراءة عنوان العميل الحقيقي.
- `rateLimit` مفعّل.
- `Cache-Control: no-store` مفروض على `/api`.
- `/api/healthz` يبقى مفتوحًا، بينما كل ما بعده يمر عبر `requireAuth`.

في `artifacts/api-server/src/middlewares/requireAuth.ts`:
- يوجد bypass صريح في `NODE_ENV=test` لدعم اختبارات supertest.
- خارج الاختبار، أي مستخدم موثّق يمر.
- لا يوجد حتى الآن فصل دور/صلاحية/مشروع؛ السياسة الحالية واحدة: authenticated user = full access.

**الدليل:** الحماية موجودة، لكن **التفويض التفصيلي RBAC / per-project ACL** غير مكتمل.

---

### 2) نظام التتبّع الموحد بدأ يترسخ فعليًا

في `artifacts/api-server/src/lib/audit.ts`:
- `recordAudit()` يكتب `audit_logs` كـ telemetry متعمّد best-effort.
- الفشل في audit لا يكسر mutation الأساسية بعد نجاحها.
- `correlationId` مدعوم صراحةً في سجل التدقيق.

في `artifacts/api-server/src/routes/events.ts`:
- يمكن تصفية الأحداث بـ `projectId` أو `type`.
- ويمكن أيضًا التصفية بـ `correlationId` مباشرة حتى لو لم يكن مدرجًا بعد في schema المولدة.
- هذا يعني أن طبقة التتبّع سبقت طبقة التوليد أحيانًا، لكن الواجهة التنفيذية واعية بالحقل.

في `artifacts/api-server/src/routes/projects.ts` و`tasks.ts` و`workflows.ts` و`scan-runner.ts`:
- نفس الـ operation غالبًا يحمل `correlationId` واحدًا عبر logs/events/audit.
- هذا يسمح بإعادة بناء العملية كاملة من نقطة دخول واحدة.

**الدليل:** المشروع يقترب من “operation tracing” حقيقي، وليس مجرد logging متفرق.

---

### 3) المشاريع أصبحت state machine فعلية، لا مجرد كيان CRUD

في `artifacts/api-server/src/routes/projects.ts`:
- `POST /projects/:projectId/scan` لا ينفذ العمل الثقيل داخل الطلب.
- ينشئ `scan_jobs` row بحالة `queued`.
- يغيّر حالة المشروع إلى `scanning`.
- يطلق `ProjectScanQueued` event.
- يرد فورًا بـ `202`.
- التنفيذ الحقيقي ينتقل إلى `runScanJob()` داخل `scan-runner.ts`.

هذا يعني أن المسح أصبح **out-of-band execution pipeline** وليس request-response blocking.

**الأثر:** المستخدم لم يعد ينتظر walk/extract/metrics على thread الطلب نفسه، والنظام بدأ يفصل بين الاستدعاء والحساب.

---

### 4) الـ Job Queue ما زال داخل العملية، لكنه مضبوط ومُحتوى

في `artifacts/api-server/src/lib/job-queue.ts`:
- يوجد `JobQueue` بحد تزامن صريح.
- `heavyJobQueue` مضبوط على `2`.
- الطوابير لا تُنفذ بلا سقف.
- الخطأ داخل job لا يسقط العملية ولا يوقف drain.

في `artifacts/api-server/src/lib/job-reconciliation.ts`:
- عند startup يتم مسح `scan_jobs` و`discovery_sessions` العالقة.
- أي job بقي `queued` أو `running` بعد crash/kill يتحول إلى `failed`.
- أي مشروع بقي `scanning` يعود `active`.
- أي discovery session بقي `discovering` تتحول `error`.
- `reconcileStuckJobs()` لا ترمي استثناءات حتى لا تمنع الإقلاع.

**الدليل:** النظام يعالج **orphaned state** بعد restart، لكنه لا يستعيد التنفيذ نفسه؛ هو يفضّل التسوية على إعادة التشغيل.

---

### 5) تنفيذ المهام صار state machine حقيقيًا مع claim وretry وrollback

في `artifacts/api-server/src/routes/tasks.ts`:
- `POST /tasks/:taskId/execute` يملك **atomic claim**: لا يسمح إلا لمهمة `pending` أو `queued` بأن تنتقل إلى `running`.
- إذا فشلت المطابقة، يرجع `409`.
- يوجد `correlationId` موحد لكل execute operation.
- يتم كتابة `taskLogs`, `events`, و`audit_logs` لنفس العملية.
- النتيجة النهائية يمكن أن تكون `completed` أو `failed` أو `verifying`.
- التحديث النهائي + اللوج + الحدث يتم داخل transaction في مرحلة الإنهاء.

وفي `retry`:
- توجد guard على `retryCount` و`maxRetries`.
- هناك conditional update يمنع التكرار المتزامن.
- الاستخدام transactionي يمنع double increment أو race مع execute.

وفي `rollback`:
- rollback ينتقل إلى `cancelled` فقط إذا كانت الحالة ما زالت صالحة.
- إذا تغيّرت الحالة، يعود `409`.
- rollback يكتب لوجًا وأثرًا تدقيقيًا.

**الدليل:** المهمة لم تعد مجرد row؛ أصبحت **finite state machine** محكومة بالـ claim والـ rollback والـ retry.

---

### 6) الـ Workflow layer يكرر نفس الفلسفة لكن على مستوى أعلى

في `artifacts/api-server/src/routes/workflows.ts`:
- `start` و`stop` يعملان كتحولات حالة لا كأوامر عشوائية.
- `start` ينشئ execution row ويغيّر workflow إلى `running` داخل transaction.
- يوجد guard يمنع تشغيلين متزامنين لنفس workflow.
- `stop` يغيّر workflow إلى `stopped` ويغلق execution running إن وجد، أو ينشئ terminal synthetic execution إن لم يوجد.
- كلاهما يكتب event ويكتب audit log، ويستخدم `correlationId`.

**الأثر:** workflow أصبح له lifecycle واضح يمكن تتبعه، ولا يعتمد على مجرد “اضغط start وانتهى الأمر”.

---

### 7) الـ scan runner هو قلب المنصة التحقيقية

في `artifacts/api-server/src/lib/scan-runner.ts`:
- يوجد `correlationId` واحد لكل scan operation.
- `walkProject()` يكتشف الملفات.
- `matchRules()` يطبق القواعد الفعالة.
- `extractGraph()` يبني العقد والعلاقات.
- `computeMetrics()` يبني scores.
- يتم إدخال results في الجداول التشغيلية ثم بعد commit:
  - `recordAudit()`
  - `dispatchOnScanComplete()` للـ plugins
- الـ audit والـ plugin dispatch يحدثان خارج transaction وبـ best-effort semantics.

**الدليل:** المسح ليس مجرد فحص ملفات؛ هو **توليد حالة تشغيلية كاملة**: findings + graph + metrics + tasks + events + audit + plugin hooks.

---

### 8) طبقة الذكاء الاصطناعي أصبحت مرتبطة بسياق المشروع، لا تستجيب في فراغ

في `artifacts/api-server/src/routes/ai.ts`:
- يوجد chat sessions/messages.
- يوجد analyze/review/orchestrate endpoints.
- كل العمليات تعتمد على `buildProjectContext(projectId)`.
- بعض العمليات تكتب events: `AiScanAnalysisCompleted` و`AiCodeReviewCompleted`.
- orchestrate workflow يقرأ workflow + execution + context المشروع ثم يطلب قرارًا من النموذج.

في `lib/ai-orchestrator/src/context-builder.ts`:
- context يجمع: المشروع، أحدث المهام، أحدث metrics، graph summary، وأحدث الأحداث.
- هذا يعني أن AI لا ينظر إلى ملف واحد أو prompt معزول؛ بل إلى **صورة تشغيلية مركبة**.

في `lib/ai-orchestrator/src/agents/workflow-orchestrator.ts`:
- النظام يحوّل حالة workflow الحالية إلى JSON decision: advance / wait / fail / complete.

**الدليل:** الذكاء الاصطناعي هنا ليس زينة؛ إنه طبقة reasoning مرتبطة بالبيئة التشغيلية للمشروع.

---

## أين تتكامل الطبقات بالفعل

الآن يمكن رسم سلسلة تشغيل واقعية واحدة:

1. مشروع يُنشأ.
2. scan يُطلب.
3. `scan_jobs` تُسجَّل و`projects.status` ينتقل إلى `scanning`.
4. `JobQueue` يضمن ألا تتفجر العملية بالطلبات المتزامنة.
5. `scan-runner` يقرأ الملفات، يطبّق القواعد، يخرج graph وmetrics.
6. `recordAudit` و`events` و`taskLogs` و`workflowExecutions` تحفظ الأثر.
7. `correlationId` يربط كل ذلك.
8. `buildProjectContext` يجمع الآثار في سياق واحد.
9. AI layer يستخدم هذا السياق في chat/review/analyze/orchestrate.
10. startup reconciliation يعيد تسوية أي عمليات عالقة بعد restart.

هذا ليس مجرد تجميع endpoints؛ هذه **سلسلة سيطرة متماسكة**.

---

## ما المكتمل، ما الجزئي، وما المفقود

| البند | الحالة | الدليل | الأثر | الخطوة التالية |
|---|---|---|---|---|
| حماية API الأساسية | مكتمل جزئيًا | `app.ts`, `requireAuth.ts` | النظام محمي على مستوى الدخول العام | إضافة RBAC وACL per project |
| التتبّع عبر correlationId | جزئي قوي | `audit.ts`, `events.ts`, `tasks.ts`, `workflows.ts`, `scan-runner.ts` | يمكن إعادة بناء أغلب العمليات | إدخال الحقل في الـ generated schema بالكامل |
| state machines للمهام | مكتمل وظيفيًا | `tasks.ts` | execute/retry/rollback محكومة | تحسين اختبارات التنافس والحواف |
| state machines للـ workflows | مكتمل وظيفيًا | `workflows.ts` | start/stop مع atomic claims | إضافة مراحل تنفيذ أعمق | 
| scan pipeline | مكتمل وظيفيًا | `projects.ts`, `scan-runner.ts` | فصل واضح بين الطلب والحساب | توفير queue persistent لاحقًا |
| reconciliation بعد restart | مكتمل ضمن الحدود | `job-reconciliation.ts` | يمنع بقاء states عالقة | دعم resume بدل fail-only إن لزم |
| audit durability | جزئي | `audit.ts` | لا يكسر mutation، لكنه best-effort | قرار حوكمة: transactional audit أم لا |
| AI integration | مكتمل وظيفيًا | `routes/ai.ts`, `context-builder.ts` | AI مرتبط بسياق حي | ربط أعمق بالمسارات العامة |
| authorization tiers | مفقود | `app.ts`, `requireAuth.ts` | أي user موثّق يملك وصولًا عامًا | تصميم roles + project membership |
| persistence خارج الذاكرة للمهام | مفقود جزئيًا | `job-queue.ts`, `job-reconciliation.ts` | queue فعّال لكن in-process | queue persisted أو worker layer |

---

## القراءة الهندسية الحاسمة

EngineeringOS لم يعد مشروعًا “يوجد فيه API”.
هو الآن:

- **Control plane** يملك حالات.
- **Traceability mesh** تربط mutation بـ events بـ logs بـ audit.
- **Execution engine** يفصل بين الطلب والإنجاز.
- **Knowledge-backed AI platform** لا تتكلم في الفراغ بل من داخل سياق المشروع.

لكن في المقابل، يوجد حد واضح جدًا:

- التتبّع قوي، لكن الحوكمة الصارمة بعد غير مكتملة.
- التنفيذ متين داخل العملية الواحدة، لكنه ليس durable بالمعنى الكامل عبر worker system دائم.
- الأمن العام موجود، لكن التفويض الدقيق ما زال أحادي الطبقة.
- audit موجود، لكنه telemetry أكثر من كونه record compliance نهائي.

هذا هو الفرق بين “منصة تعمل” و“منصة محكومة بالكامل”.

---

## خلاصة السلسلة

أقوى نتيجة في هذا الفرع من التحليل هي أن المشروع لم يعد يحتاج إثبات أن طبقاتِه موجودة؛ هذا بات واضحًا. السؤال الحقيقي الآن صار:

**كيف نغلق الفجوة بين control plane المتماسك وبين platform governance الكاملة؟**

والإجابة تظهر بوضوح في ثلاثة محاور قادمة:
1. RBAC / ACL / project membership.
2. durable background execution خارج الذاكرة.
3. توحيد tracing schema والتدقيق ليصبحا مرجعًا رسميًا لا مجرد telemetry.

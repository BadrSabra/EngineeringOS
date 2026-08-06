# EngineeringOS PR-01 — Durable Jobs Fix Patch

**هدف الباتش:** إزالة الاعتماد التشغيلي على queue داخل الذاكرة فقط، وتحويل scan/discovery/AI background execution إلى مسار recoverable بعد restart، مع منع التكرار عبر lease + idempotency + reconciliation.

**ملاحظة مهمة:** هذا ملف patch manifest جاهز للمراجعة والتنفيذ على المستودع الحالي، وليس diff مطبقًا على الشجرة نفسها.

---

## المعايير النهائية للقبول

- لا تضيع أي job بعد crash/restart.
- لا تُنفّذ job أكثر من مرة أثناء recovery.
- أي job running قديم يُلتقط بواسطة reconciliation أو lease expiry.
- لا يتغير سلوك API للمستخدم النهائي، فقط الاعتمادية الداخلية.
- جميع tests الخاصة بـ crash/restart وconcurrency وidempotency تمر.

---

## File → Change → Reason → Test → Risk

| File | Change | Reason | Test | Risk |
|---|---|---|---|---|
| `lib/db/src/schema/scan_jobs.ts` | إضافة حقول `workerId`, `leaseUntil`, `lastHeartbeatAt`, `idempotencyKey`، مع index على `(status, leaseUntil)` و`(status, createdAt)` | job claim/heartbeat يحتاجان حالة قابلة للاسترداد في DB بدل الاعتماد على closure في الذاكرة | Migration test + claim/reclaim test + stale lease test | Medium |
| `lib/db/src/schema/discovery.ts` | إضافة نفس حقول lease/idempotency لجدول `discovery_sessions` | discovery sessions تُدار كـ background work، وتحتاج recovery موحد مع scan jobs | Crash/restart recovery test على session pending/running | Medium |
| `lib/db/src/schema/tasks.ts` | إضافة `workerId`, `leaseUntil`, `lastHeartbeatAt`, `idempotencyKey` إلى tasks أو على الأقل للجزء الذي يتحول إلى execution job | AI task execution يحتاج claim واضح يمنع التكرار ويجعل recovery deterministic | Parallel execute race test + restart recovery test | Medium |
| `artifacts/api-server/src/lib/job-queue.ts` | تحويل queue من pure in-memory dispatch إلى `enqueue → claim → execute → complete/fail` adapter، مع الحفاظ على bounded concurrency | منع ضياع closures عند restart وجعل job lifecycle مرئيًا في DB | Unit tests للـ enqueue/claim dedupe + queue drain under restart | High |
| `artifacts/api-server/src/lib/job-reconciliation.ts` | استبدال sweep الحالي بمفاهيم `stale running lease`, `stale pending`, `orphaned session` وإعادة claim للصفوف المؤهلة فقط | reconciliation الحالي يعالج restart جزئيًا، لكن lease expiry يجعل recovery أقوى وأوضح | Force-lease-expiry test + stale-pending requeue test | High |
| `artifacts/api-server/src/index.ts` | تشغيل reconciliation قبل `listen()`, وإبقاء periodic sweep بعد startup، مع log واضح لعدد jobs recovered/requeued | ضمان أن server لا يقبل traffic قبل تنظيف حالات التشغيل غير المستقرة | Startup recovery integration test | Low |
| `artifacts/api-server/src/routes/ai/tasks.ts` | استبدال أي enqueue مباشر على closure بمنطق `idempotent job enqueue` مرتبط بـ `task.id` و`correlationId` | task execution path هو أحد أكثر المسارات حساسية للفقد/التكرار | Double-click / concurrent execute test | Medium |
| `artifacts/api-server/src/routes/ai/workflows.ts` | تمرير workflow execution عبر نفس آلية claim/lease/idempotency عند أي background transition | توحيد lifecycle بين workflows وباقي الخلفية، ومنع race عند start/stop | Concurrent start/stop test + restart test | Medium |
| `artifacts/api-server/src/routes/discovery.ts` *(إن وجد مسار تشغيل discovery)* | التأكد أن create/run discovery يسجل row قبل أي execution وأن الاستئناف يعتمد على DB row فقط | discovery sessions يجب ألا تعتمد على closure في الذاكرة | Pending discovery restart test | Medium |
| `artifacts/api-server/src/routes/scan.ts` أو المسار الذي ينشئ scan jobs | تسجيل job row + idempotency key قبل بدء التنفيذ، ثم claim job من DB | scan jobs هي المصدر المباشر لخطر job loss | Create-job then kill-process test | Medium |
| `artifacts/api-server/src/lib/scan-runner.ts` | جعل نهاية التنفيذ تكتب completion/failed atomically وتحرر lease/workerId | يمنع بقاء job معلّقًا في running بعد نهاية صحيحة أو فشل | Success/fail completion test | Low |
| `artifacts/api-server/src/lib/discovery-runner.ts` | نفس معاملة scan runner: completion/failed atomically مع lease release | discovery تحتاج نفس الاتساق التشغيلي | Success/fail completion test | Low |
| `tests/integration/job-recovery.test.ts` *(جديد)* | سيناريو kill/restart ثم verify recovery | هذا هو الاختبار الحاسم لمشكلة فقد المهام | Pass if no job is lost | Low |
| `tests/integration/job-lease.test.ts` *(جديد)* | يتحقق أن lease expired job يمكن إعادة claim له فقط بعد timeout | يمنع التكرار ويثبت الاسترداد المنضبط | lease expiry + reclaim | Low |
| `tests/integration/job-idempotency.test.ts` *(جديد)* | إرسال نفس job مرتين بنفس idempotency key ثم التأكد من تنفيذ واحد فقط | يضمن عدم الازدواج أثناء إعادة المحاولة/recovery | duplicate enqueue test | Low |
| `tests/integration/job-concurrency.test.ts` *(جديد)* | تشغيل عاملين/طلبين متزامنين على نفس job | يثبت أن claim/lock يمنع double execution | concurrent worker test | Medium |

---

## التنفيذ المقترح بالترتيب

### 1) توسيع schema
أضف حقول lease/idempotency إلى الجداول التي تمثل background work، ثم نفّذ migration.

### 2) طبقة claim موحّدة
أضف helper مشتركًا:
- `claimJob(id, workerId, leaseMs)`
- `heartbeatJob(id, workerId)`
- `completeJob(id, workerId, result)`
- `failJob(id, workerId, error)`

### 3) تعديل queue التنفيذية
بدل enqueue closure فقط، اجعل التنفيذ يعتمد على row ID ثابت، ثم استرجع payload من DB عند الحاجة.

### 4) reconciliation
- running rows مع lease منتهية → recover/requeue
- pending rows القديمة → requeue
- jobs completed/failed → no-op

### 5) startup gating
لا تبدأ `listen()` قبل أن يكتمل reconciliation الأول.

### 6) tests
نفّذ crash/restart + concurrency + idempotency + lease-expiry.

---

## تعريف السلوك المطلوب

### عند الإنشاء
1. تُكتب row في DB.
2. يُنشأ idempotency key ثابت.
3. تُؤخذ job تحت claim واحد فقط.
4. يبدأ التنفيذ.

### أثناء التنفيذ
1. heartbeat دوري يحدّث `lastHeartbeatAt` / `leaseUntil`.
2. لو انهارت العملية، lease ينتهي.
3. reconciliation يلتقط الصفوف المتروكة.

### عند النجاح
1. status = completed.
2. release lease.
3. persist result / audit / event.

### عند الفشل
1. status = failed أو queued حسب retry policy.
2. release lease.
3. persist error.

---

## ملاحظات هندسية

- أبقِ bounded concurrency، لكن لا تجعلها مصدر الحقيقة الوحيد للتنفيذ.
- لا تعتمد على closure كوسيط الاسترداد الوحيد.
- اجعل `enqueueWithId` dedupe مؤقتًا فقط، بينما DB lease هو المصدر الحاسم.
- أي recovery path يجب أن يكون idempotent.

---

## Acceptance Checklist

- [ ] لا يوجد job ضائع بعد restart.
- [ ] لا يوجد double execution لنفس job.
- [ ] lease expiry يعمل.
- [ ] reconciliation يعمل على startup.
- [ ] stale pending jobs تُعاد معالجتها.
- [ ] tests تمر محليًا وفي CI.


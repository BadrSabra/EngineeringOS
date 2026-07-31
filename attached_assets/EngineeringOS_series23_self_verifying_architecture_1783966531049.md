# EngineeringOS — السلسلة 23: البنية الذاتية التحقق والأدلة التشغيلية

**هدف هذه السلسلة:** تثبيت ما أضافه المشروع فعليًا في هذه الجولة من الداخل: ليس مجرد طبقات وظيفية، بل طبقة تتحقق من نفسها عبر العقود، والتوليد، والاختبارات، والتسوية عند الإقلاع، والتدقيق، وإثبات التحولات الحرجة داخل الكود.

## 1) الخلاصة العامة

المشروع لم يعد مجرد منصة متعددة الطبقات؛ صار يملك **خط تحقق داخلي**:
- العقد المصدرية في OpenAPI.
- توليد Zod/hooks مربوط بحاجز drift واضح.
- قاعدة بيانات بمفاتيح وعلاقات لا تُعامل كهيكل زخرفي.
- scanner يستخرج AST فعليًا بدل الاعتماد على regex فقط.
- discovery/import يثبت الملكية والاتساق بعملية claim/transaction.
- queue محدود ومصحوب بتسوية startup للأعمال العالقة.
- audit logs تربط التغييرات بتتبع correlation موحد.
- اختبارات تركز على race conditions والحالات الفاشلة وليس فقط happy path.

هذه ليست “ميزات منفصلة”، بل **منظومة إثبات داخلية**: أي تغيّر في العقد أو السلوك أو التوليد أو الجداول له أثر يمكن رؤيته واختباره.

---

## 2) أدلة حاسمة من داخل الملفات

### أ) العقد والـ codegen أصبحا مصدر حقيقة يمكن التحقق منهما
- `lib/api-spec/openapi.yaml` يحتوي **47 path** و**58 operation** فعلية.
- `package.json` يفرض:
  - `codegen`
  - `codegen:check`
  - `build`
  - `typecheck`
- `codegen:check` لا يكتفي بـ `git diff`؛ بل يفحص أيضًا الملفات **غير المتتبعة** داخل:
  - `lib/api-zod/src/generated`
  - `lib/api-client-react/src/generated`
- `scripts/check-codegen-drift.ts` يعيد توليد الكود ثم يفحص **tracked + untracked** عبر:
  - `git diff --name-only`
  - `git ls-files --others --exclude-standard`

**الدلالة:** لم يعد الانحراف بين OpenAPI والمخرجات المولدة يمر بصمت. المشروع الآن يملك gate صريحًا ضد drift.

---

### ب) طبقة الأمان الأساسية موجودة لكن بدون أدوار
- `artifacts/api-server/src/app.ts` يثبت:
  - `app.disable("etag")`
  - `app.set("trust proxy", 1)`
  - `helmet(...)`
  - `rateLimit(...)`
  - `express.json({ limit: "2mb" })`
  - `Cache-Control: no-store` على `/api`
  - `requireAuth` لكل `/api/*` ما عدا `/api/healthz`
- `artifacts/api-server/src/middlewares/requireAuth.ts` يوضح أن:
  - المصادقة قائمة
  - لكن **لا يوجد per-role أو per-project authorization layer بعد**
  - في test mode يتم حقن `test-user` فقط لتسهيل اختبارات route handlers

**الدلالة:** الحماية الأساسية ناضجة، لكن التفويض لا يزال **single-tier**: أي مستخدم موثّق يمكنه الوصول لكل شيء.

---

### ج) discovery/import أصبح خطًا مضبوطًا لا مجرد wizard
- `lib/db/src/schema/discovery.ts` يعرّف:
  - `discovery_sessions`
  - حالات: `discovering | ready | error | imported`
  - `result` JSONB غني
  - `importedProjectId` مع FK
- `artifacts/api-server/src/routes/discovery.ts` يثبت:
  - فحص `stat(rootPath)` في البداية
  - رفض المسارات غير الآمنة
  - TTL cleanup للجلسات القديمة
  - claim ذري داخل نفس transaction التي تنشئ `projectsTable`
  - أي concurrent import ثاني يرى 0 rows affected ويفشل
- الاختبارات في `routes/discovery.test.ts` مبنية حول:
  - import مرة واحدة فقط
  - رفض المحاولة المتزامنة الثانية
  - العودة إلى ready بعد failure عند الحاجة

**الدلالة:** discovery/import ليس مسارًا تجميليًا؛ بل pipeline بملكية قابلة للإثبات.

---

### د) scan pipeline لم يعد inline ولا fragile
- `lib/db/src/schema/scan_jobs.ts` ينقل الفحص من inline HTTP إلى job row بحالات:
  - `queued | running | completed | failed`
- `artifacts/api-server/src/lib/job-queue.ts` يحدّ التزامن إلى **2**
- `artifacts/api-server/src/lib/job-reconciliation.ts` يعالج الأعمال العالقة بعد restart:
  - `queued/running` → `failed`
  - المشروع المرتبط يعود `active`
  - discovery sessions العالقة `discovering` → `error`
- `artifacts/api-server/src/lib/scan-runner.ts`:
  - يجري `walkProject`
  - `matchRules`
  - `extractGraph`
  - `computeMetrics`
  - ثم يسجل audit + plugin dispatch
  - ويحتفظ بـ `correlationId` واحد عبر المسار
- الاختبار في `job-queue.test.ts` يثبت:
  - حد التزامن
  - استمرار draining بعد throw
  - رفض concurrency غير الصالح
- الاختبار في `job-reconciliation.test.ts` يثبت:
  - jobs العالقة تُغلق
  - المشروع يعود active
  - الجهود غير المكتملة لا تبقى عالقة للأبد

**الدلالة:** التنفيذ أصبح bounded + recoverable بدل fire-and-forget غير محدود.

---

### هـ) scanner أصبح أكثر من regex
- `lib/scanner/src/graph-extractor.ts` يعتمد:
  - TypeScript compiler API لـ TS/JS
  - Python import resolution بطبقة منطقية
- `lib/scanner/src/python-extractor.ts` ينفذ:
  - subprocess واحد batched لكل scan
  - `python3` مع script مؤقت
  - parse AST حقيقي عبر Python `ast`
  - fallback إلى path متدهور عند الفشل
- `/.agents/memory/scanner-ast-extraction.md` يثبت أن:
  - Python parsing structural
  - batching يقلل overhead
  - `extractGraph` صار `async`
  - واستدعى ذلك تعديل callers والاختبارات

**الدلالة:** graph extraction أصبح قائمًا على بنية لغوية حقيقية، لا مجرد matching سطحي.

---

### و) audit أصبح wired لكنه ما يزال best-effort
- `lib/db/src/schema/audit_logs.ts` يعرّف سجل provenance كامل:
  - entityType
  - entityId
  - action
  - actor
  - changedFields
  - stateBefore / stateAfter
  - reason
  - correlationId
- `artifacts/api-server/src/lib/audit.ts` يكتب السجل لكنه:
  - لا يعرقل mutation الأساسية
  - يتعامل معه كـ best-effort telemetry
- `artifacts/api-server/src/lib/scan-runner.ts` يربط نفس `correlationId` في scan outcome
- `artifacts/api-server/src/routes/tasks.ts`, `workflows.ts`, `discovery.ts` وغيرها تستعمل audit/event wiring بشكل أوضح من السابق

**الدلالة:** التتبع موجود وفعّال، لكن ليس بعد بنفس صرامة mutation transactional النهائية.

---

### ز) الـ AI layer صار حقيقيًا ومربوطًا بالبنية
- `lib/ai-orchestrator/` يحتوي:
  - `groq-client.ts`
  - `context-builder.ts`
  - `chat-agent.ts`
  - `task-agent.ts`
  - `scan-analyst.ts`
  - `code-reviewer.ts`
  - `workflow-orchestrator.ts`
- `lib/db/src/schema/ai_chats.ts` يضيف:
  - `ai_chat_sessions`
  - `ai_chat_messages`
- `artifacts/api-server/src/routes/ai.ts` يضيف 7 endpoints:
  - chat
  - sessions
  - messages
  - analyze
  - review
  - orchestrate
  - execute task
- `openapi.yaml` يعكس هذه المسارات، وبالتالي تدخل ضمن codegen أيضًا

**الدلالة:** الذكاء الاصطناعي لم يعد “فكرة جانبية”، بل طبقة تشغيلية فعلية داخل control plane.

---

## 3) ما الذي أصبح مكتملًا فعلًا

### مكتمل
- contract-first workflow
- drift gate للعقود والمخرجات المولدة
- security hardening الأساسية في Express
- discovery/import بذَرْيًا وtransactional
- bounded in-process job execution
- startup reconciliation للأعمال العالقة
- AST-based graph extraction + Python structural parsing
- audit/event correlation الأساسية
- AI orchestration layer وواجهاتها وschema الخاصة بها

### جزئي
- audit ما يزال best-effort وليس transactional
- authorization ما يزال single-tier بلا roles أو per-project ACL
- in-process queue ما يزال محدودًا بطبيعته مقارنة بــ durable external worker
- AI layer موجودة لكن ليست مفعّلة تلقائيًا في كل مسار تشغيل عام

### مفقود / يحتاج إغلاقًا
- RBAC حقيقي
- policy engine موحد
- traceability موحدة عبر كل الجداول التشغيلية بشكل صارم
- durable execution خارجي إذا أردنا مقاومة أعلى لانقطاع العملية
- توسيع اختبارات race/error-paths لتغطية كل المسارات الحرجة بنفس العمق

---

## 4) التقييم الحقيقي للوضع الحالي

EngineeringOS الآن ليس “مشروعًا قيد البناء” فقط، بل **منصة بدأت تتحقق من نفسها**.  
الفرق هنا مهم:

- في المرحلة السابقة كان التحدي: هل توجد الطبقات؟
- الآن أصبح التحدي: هل يمكن إثبات صحة الطبقات والتغييرات والانتقالات؟
- الجواب: **نعم، بدرجة جيدة ومتزايدة**، لكن الحوكمة النهائية ما تزال ناقصة في التفويض الصريح والـ durable orchestration.

---

## 5) الخطوة التالية العملية

الأولوية المنطقية التالية هي:
1. إغلاق RBAC / ACL
2. جعل audit أكثر صرامة عند الحاجة
3. تقوية traceability في كل العمليات الحرجة
4. تقييم ما إذا كان in-process queue يكفي أو يحتاج worker خارجي
5. توسيع الاختبارات لتشمل المزيد من race/error conditions

هذه الخطوة هي التي تنقل المنصة من **self-verifying** إلى **governed and enforceable**.

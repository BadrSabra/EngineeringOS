# EngineeringOS — السلسلة 33: خريطة السلطة والتتبّع (Provenance Authority Graph)

هذه السلسلة لا تعيد شرح المشروع من جديد، بل تقيس **من يملك الحقيقة** داخل EngineeringOS، وكيف تنتقل الثقة من وثائق الحوكمة إلى العقد، ثم إلى التوليد، ثم إلى الطبقات التشغيلية.

## 1) ما الذي تم تحليله
تمت مراجعة:
- `docs/fact-record.md`
- `docs/completion-plan.md`
- `lib/api-spec/openapi.yaml`
- `scripts/check-codegen-drift.ts`
- `.agents/memory/MEMORY.md`
- سجل الـ provenance:
  - `attached_assets/EngineeringOS_provenance_registry_seed_1783911530658.json`
  - `attached_assets/EngineeringOS_provenance_registry_linked_1783911530593.json`

## 2) النتيجة المختصرة
EngineeringOS لم يعد مجرد مجموعة ملفات؛ بل أصبح **نظامًا هرميًا للحقيقة**:
- وثائق الحوكمة في القمة (`docs/fact-record.md`, `docs/completion-plan.md`).
- العقد (`openapi.yaml`) كمرجع سلوكي رسمي.
- التوليد التلقائي (codegen + drift check) يمنع انحراف العقد عن التنفيذ.
- الطبقات التنفيذية (`api-server`, `scanner`, `knowledge-engine`, `ai-orchestrator`, `dashboard`) تتغذى من ذلك المرجع.
- الملفات المولدة والـ assets لا تدّعي سلطة ذاتية؛ هي تابعة في الأسفل.

## 3) أرقام أساسية من سجل الـ provenance
- إجمالي السجلات: **459**
- توزيع authority level:
  - A: **23**
  - B: **154**
  - C: **223**
  - D: **59**
- توزيع الطبقات:
  - `api-zod`: **110**
  - `dashboard`: **92**
  - `mockup-sandbox`: **62**
  - `attached_assets`: **51**
  - `root`: **40**
  - `api-server`: **36**
  - `db`: **18**
  - `.agents`: **14**
  - `scanner`: **12**
  - `ai-orchestrator`: **8**
  - `knowledge-engine`: **4**
- أكبر الأدوار:
  - `generated-schema`: **110**
  - `mockup-ui`: **62**
  - `ui-primitive`: **55**
  - `attached-asset`: **51**
  - `config/root`: **40**
  - `api-route`: **20**
  - `decision-memory`: **14**

## 4) قراءة طبقية للسلطة
### A-level: مصادر الحقيقة/الحوكمة
هذه الطبقة تضم الوثائق والعقد المرجعية والأساس التشغيلي:
- `docs/fact-record.md`
- `docs/completion-plan.md`
- `lib/api-spec/openapi.yaml`
- `package.json`
- `pnpm-workspace.yaml`
- `.replit`

الدلالة: الحقيقة لا تأتي من UI ولا من الملفات المولدة، بل من وثائق الحوكمة والعقد وإعدادات workspace.

### B-level: التنفيذ المباشر
أغلب `api-server`, `scanner`, `knowledge-engine`, `ai-orchestrator` تقع هنا.
الدلالة: هذه طبقة تنفيذ حقيقية لكنها لا تدّعي المرجعية النهائية؛ هي تعمل تحت سقف العقد والسياسات.

### C-level: التوليد والمخرجات المشتقة
هنا تقع `api-zod`, أجزاء كبيرة من `dashboard`, وبعض `root` helpers.
الدلالة: هذه طبقة تابعة وليست مصدرًا للحقيقة. أي drift هنا يجب أن يُكتشف ويُصلح من الأعلى.

### D-level: الأصول المرجعية/المرفقات
`attached_assets` تمثل التقارير، اللقطات، والوثائق المساندة.
الدلالة: مفيدة للتتبع، لكنها لا تحل محل المرجع الأصلي.

## 5) ماذا تقول البنية عن EngineeringOS؟
### 5.1 الحقيقة مُقننة لا عشوائية
وجود `docs/fact-record.md` و`docs/completion-plan.md` كـ A-level يعني أن المشروع اختار:
- وصفًا دقيقًا للحالة
- ترتيبًا مرحليًا للعمل
- منعًا للبدء من الواجهة قبل تثبيت الأساسات

### 5.2 العقد ليست وثيقة شكلية
`openapi.yaml` ليس مجرد spec؛ بل يتغذى عليه codegen، وتوجد أداة drift-check:
- `package.json` يحتوي `codegen` و`codegen:check`
- `scripts/check-codegen-drift.ts` يعيد توليد المخرجات ثم يقارنها مع git status/diff
- `.agents/memory/orval-openapi-codegen.md` يشرح أن أي drift في التوليد يجب أن يُعامل كخطأ

النتيجة: العقد محمية عمليًا من التدهور الصامت.

### 5.3 الذاكرة التشغيلية ليست مرجعًا أعلى من العقد
`.agents/memory/*` هي Decision Memory؛ مفيدة جدًا، لكن سجل الـ provenance يصنفها كـ decision-memory لا كـ source-of-truth.
النتيجة: الذاكرة تحفظ الخبرة، لكنها لا تنافس docs والعقد.

### 5.4 الواجهة مبنية على الحقيقة المشتقة
`dashboard` يعتمد على ما يصدر من API وسياق البيانات، وليس على نموذج مستقل للحقيقة.
النتيجة: الواجهة أقوى من كونها عرضًا بسيطًا، لكنها ما تزال **derived control surface** وليست المصدر.

## 6) أمثلة على السجلات A-level
- .agents/memory/MEMORY.md — layer=.agents / role=decision-memory / status=operational-doc
- .agents/memory/ai-orchestrator-layer.md — layer=.agents / role=decision-memory / status=operational-doc
- .agents/memory/audit-fixes.md — layer=.agents / role=decision-memory / status=operational-doc
- .agents/memory/clerk-401-race-cookie-vs-bearer.md — layer=.agents / role=decision-memory / status=operational-doc
- .agents/memory/clerk-auth-testing.md — layer=.agents / role=decision-memory / status=operational-doc
- .agents/memory/discovery-feature.md — layer=.agents / role=decision-memory / status=operational-doc
- .agents/memory/drizzle-error-wrapping.md — layer=.agents / role=decision-memory / status=operational-doc
- .agents/memory/engineeringos-completion-plan.md — layer=.agents / role=decision-memory / status=operational-doc
- .agents/memory/fk-atomic-claim-ordering.md — layer=.agents / role=decision-memory / status=operational-doc
- .agents/memory/imported-project-workflow-failures.md — layer=.agents / role=decision-memory / status=operational-doc
- .agents/memory/knowledge-engine.md — layer=.agents / role=decision-memory / status=operational-doc
- .agents/memory/orval-openapi-codegen.md — layer=.agents / role=decision-memory / status=operational-doc

## 7) أمثلة على السجلات B-level
- artifacts/api-server/src/app.ts — layer=api-server / role=server-core / status=source/config
- artifacts/api-server/src/config.ts — layer=api-server / role=server-core / status=source/config
- artifacts/api-server/src/index.ts — layer=api-server / role=server-core / status=source/config
- artifacts/api-server/src/lib/audit.ts — layer=api-server / role=server-lib / status=source/config
- artifacts/api-server/src/lib/job-queue.test.ts — layer=api-server / role=server-lib / status=test
- artifacts/api-server/src/lib/job-queue.ts — layer=api-server / role=server-lib / status=source/config
- artifacts/api-server/src/lib/job-reconciliation.test.ts — layer=api-server / role=server-lib / status=test
- artifacts/api-server/src/lib/job-reconciliation.ts — layer=api-server / role=server-lib / status=source/config
- artifacts/api-server/src/lib/logger.ts — layer=api-server / role=server-lib / status=source/config
- artifacts/api-server/src/lib/plugin-runtime.test.ts — layer=api-server / role=server-lib / status=test
- artifacts/api-server/src/lib/plugin-runtime.ts — layer=api-server / role=server-lib / status=source/config
- artifacts/api-server/src/lib/scan-runner.ts — layer=api-server / role=server-lib / status=source/config

## 8) توزيع الأوامر التشغيلية داخل OpenAPI
`openapi.yaml` يحتوي:
- **47** path
- **58** operation

أثقل العناقيد الوظيفية:
- `Workflows`: **10**
- `Tasks`: **9**
- `Projects`: **8**
- `AI`: **7**
- `Rules`: **6**
- `KnowledgeGraph`: **6**
- `Discovery`: **4**

الاستنتاج: المنصة ليست API واحدة؛ إنها مجموعة أنظمة فرعية متداخلة، ويجب أن يظل مصدر الحقيقة موحدًا حتى لا يتشعب السلوك.

## 9) الخلاصة التنفيذية
EngineeringOS الآن يملك:
- **سلم سلطة واضح**
- **عقدًا محميًا من drift**
- **ذاكرة قرارات تُراكم الخبرة**
- **تنفيذًا متعدد الطبقات يتغذى من الأعلى**

الفجوة ليست في غياب البنية، بل في **استكمال الطبقات الأدنى** حتى تصبح:
- الصلاحيات أدق،
- التتبّع أوضح،
- التشغيل أكثر ديمومة،
- والواجهة أكثر صدقًا مع الحقيقة الداخلية.

## 10) الخطوة التالية
أولوية السلسلة التالية هي تحويل هذا السلم إلى **مصفوفة اعتماد تشغيلي**:
- source of truth
- derived surfaces
- generated artifacts
- runtime services
- audit/trace
- test gates


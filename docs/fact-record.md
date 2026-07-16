# EngineeringOS — سجل حقيقة منظّم ملفًا ملفًا

_آخر تحقق: 2026-07-14 (تحديث ثالث) — إغلاق خطة الـ 14-PR للتصلّب الأمني الشامل. الملخص التنفيذي: كل route في api-server يتحقق الآن من ملكية المشروع قبل إعادة أي بيانات أو تنفيذ أي عملية؛ كل استدعاء `recordAudit` يُمرّر `actor: req.userId` الحقيقي بدل "system". تفصيل التغييرات: (1) `requireProjectAccess.ts` — أُضيف `loadProjectByIdForUser(projectId, userId, res)` كتصدير مُسمّى للاستخدام في routes يأتي فيها projectId من query/body لا من params؛ (2) `routes/tasks.ts` — إلزامية projectId في GET /tasks (لا fallback لكل المهام)، فحص ملكية على كل العمليات العشر (list/create/get/patch/delete/execute/retry/rollback/logs)، إضافة actor+correlationId لـ audit؛ (3) `routes/rules.ts` — GET /rules بلا projectId يعيد القواعد العالمية فقط (`isNull`، لا تسريب لقواعد المشاريع الأخرى)، فحص ملكية على project-scoped rules، DELETE بقي idempotent (204 حتى عند عدم الوجود)؛ (4) `routes/workflows.ts` — projectId إلزامي في GET /workflows (400 بلا filter)، فحص ملكية على 11 endpoint، actor على كل audit؛ (5) `routes/events.ts` — إعادة كتابة كاملة: projectId إلزامي + فحص ملكية + حد أقصى 500 نتيجة؛ (6) `routes/metrics.ts` — إعادة كتابة: GET /metrics يتحقق من الملكية، GET /metrics/latest بلا filter يعيد مشاريع المستخدم فقط (لا كل المشاريع)؛ (7) `routes/graph.ts` — projectId إلزامي على list endpoints + فحص ملكية، حد 1000 كيان/علاقة، neighbors/impact/path تُحمّل الـ entity أولًا للتحقق من ملكية مشروعها؛ (8) `routes/ai.ts` — chat/sessions تتحقق من ملكية، analyze/review يضمّان `requireProjectAccess` كوسيط مسار، orchestrate/execute يُحمّلان workflow/task للتحقق من مشروعهما؛ (9) `routes/discovery.ts` — audit import يحمل `actor: req.userId`؛ (10) `lib/job-reconciliation.ts` — يُسجّل الآن job IDs وproject IDs (scan) وsession IDs (discovery) الفعلية في رسائل التحذير، لا مجرد العدد. النتيجة: 219/219 اختبار يمر (لا انحدار). لا أخطاء TypeScript جديدة (الأخطاء المتبقية TS7006 على tx/f/t/m في الـ lambda callbacks موجودة مسبقًا بسبب dist غير مبني لحزم workspace).

**آخر تحقق سابق (2026-07-14، تحديث ثانٍ)** — PR توحيد سياق المصادقة وتمهيد التفويض المُوسَّع بالمشروع. أُضيف `AuthContext` موحّد، `optionalAuth`، `requireProjectWriteAccess`، واختبارات وحدة جديدة لـ requireAuth. النتيجة: 218/218 اختبار.

**آخر تحقق سابق (2026-07-14، تحديث أول)** — إغلاق PR-01→PR-07: نموذج ملكية/تفويض + `requireProjectAccess.ts` + توسيع correlationId. التفويض بالملكية كان مطبَّقًا في routes/projects.ts فقط آنذاك — **أُغلق الآن بالكامل في هذا التحديث الثالث**. الجلسة السابقة: مراجعة السلاسل 20–33 (14 وثيقة تحليل متقاطع)، إجمالي موثّق 401. الجلسة قبلها: طبقة الذكاء الاصطناعي الكاملة (lib/ai-orchestrator Groq + 5 وكلاء + lib/knowledge-engine + ai_chat_sessions/ai_chat_messages + 7 endpoints + AiChat.tsx)._

## الفئات الأربع للبيانات في Truth Flow

هذا السجل يتعامل مع أربعة أنواع من البيانات تختلف في أصلها وصلاحيتها وطريقة استخدامها:

| الفئة | التعريف | الحالة | المرجع |
|---|---|---|---|
| **baseline** | الحقيقة المجمّدة المخزّنة في `EXPECTED_CURRENT_TRUTH_FLOW_MATRIX`. هي ما يُقارَن به كل شيء آخر. لا تتغيّر إلا بقرار هندسي واعٍ + تحديث يدوي + نجاح `pnpm run truth:validate`. | السلطة المرجعية | `lib/api-zod/src/truth-flow-matrix.schema.ts` + `attached_assets/EngineeringOS_Truth_Flow_Matrix_*.json` |
| **derived** | إشارات drift تنتجها `listTruthFlowDriftSignals()` بالمقارنة بين الـ baseline والـ JSON الحيّ. مؤقتة تمامًا: تُحسَب عند التشغيل ولا تُخزَّن. | مؤقت / للتشخيص | `scripts/validate-truth-flow.ts` (Layer 2) |
| **historical** | ملفات `attached_assets/*` والوثائق الأرشيفية القديمة. صالحة كسياق ودليل تاريخي، **لكنها لا تمثّل الحقيقة الحالية أبداً**. أي تعارض بينها وبين الـ baseline يُحسَم لصالح الـ baseline. | قراءة فقط / أرشيف | `attached_assets/*` |
| **runtime** | ما ينتجه pipeline الفعلي أثناء التشغيل: صفوف DB، نتائج scan jobs، جلسات discovery، graph entities. يُعلم تحديثات الـ baseline لكن لا يُحدّثها تلقائياً. تحديث الـ baseline يستلزم مراجعة بشرية. | قيد التشغيل / للمراجعة | DB + scan-runner + discovery |

**قاعدة التعارض:** historical < runtime < derived < baseline. الـ baseline يكسب دائماً حتى يُقرَّر تغييره.

---

هذا السجل يصف **ما يوجد** و**ما ينقص** و**الأثر** و**الأولوية** لكل ملف ظاهر في الأرشيف. الأوصاف هنا عملية ومختصرة، وتُعامل ملفات التوليد والأصول المكررة باعتبارها جزءًا من السطح الفعلي الذي يجب تتبعه.

## إحصاءات سريعة

- إجمالي الملفات الموثّقة: **427** (+19 في تحديث 2026-07-15: 2 docs جديدة، 1 lib/api-zod، 16 api-server lib/routes/scripts) (+1 في PR توحيد سياق المصادقة (2026-07-14): `middlewares/requireAuth.test.ts` جديد، مع إضافة `optionalAuth`/`requireProjectWriteAccess`/`AuthContext` كتصديرات جديدة داخل ملفات موجودة أصلاً (لا صفوف جديدة إضافية)؛ +2 سابقًا في جلسة إغلاق PR-01→PR-07: 2 .agents/memory جديدة؛ +18 سابقًا في مراجعة السلاسل 20–33: 3 .agents/memory + 1 scripts/check-codegen-drift.ts + 14 attached_assets/series)
- أكبر كتلة: `artifacts/dashboard` بعدد **87** ملفًا
- ثاني أكبر كتلة: `lib/api-zod` بعدد **79** ملفًا
- ثالث أكبر كتلة: `artifacts/mockup-sandbox` بعدد **69** ملفًا
- `attached_assets`: **52** ملفًا (+14 وثائق السلاسل 20–33)

## سجل الملفات

### الجذر (11)

| الملف | الموجود | الناقص | الأثر | الأولوية | الدليل |
|---|---|---|---|---|---|
| .gitattributes | تعريف LFS لبعض الأصول الكبيرة. | أي أصل ثنائي كبير جديد قد يحتاج إدراجًا. | يدير تخزين الملفات الكبيرة. | Low | .gitattributes |
| .gitignore | قائمة تجاهل للمخرجات والبيئات والأدوات. | يجب أن تبقى محدثة مع أي أصول أو أدوات جديدة. | يمنع تسرب الملفات المولدة. | Low | .gitignore |
| .npmrc | سياسة npm/pnpm على مستوى workspace. | تؤثر في التثبيت والاعتمادات. | تضبط سلوك إدارة الحزم. | Medium | .npmrc |
| .replit | تهيئة تشغيل Replit والاستضافة والـ postMerge. | يحتاج مواكبة المسارات الفعلية للتشغيل. | يشغّل تجربة التطوير/النشر داخل Replit. | Medium | .replit |
| .replitignore | تجاهل deploy image. | يحتاج فقط لمواكبة artifacts غير المرغوبة. | يقلل حجم النشر. | Low | .replitignore |
| package.json | جذر workspace يعرّف scripts الشاملة وسياسة pnpm/publish. | يجب أن يبقى متوافقًا مع كل الحزم المتعددة. | يحكم build/typecheck/codegen على مستوى المستودع. | High | package.json |
| pnpm-lock.yaml | ملف إعداد/دعم. | يُراجع بحسب الاستهلاك. | يساند البناء والتشغيل. | Medium | pnpm-lock.yaml |
| pnpm-workspace.yaml | تعريف workspace وسياسة أمان supply-chain عبر minimum release age. | أي تعديل هنا حساس ويؤثر على التثبيت. | يحمي سلسلة التوريد ويحدد نطاق الحزم. | High | pnpm-workspace.yaml |
| replit.md | دليل تشغيل/بنية عالي المستوى. | تحتاج الأرقام داخله تحديثًا دوريًا مع التقدم. | يساعد فهم التشغيل السريع. | Medium | replit.md |
| tsconfig.base.json | إعدادات compiler موحدة للمستودع. | أية صرامة/مرونة هنا تؤثر على كل الحزم. | يطبع قواعد TypeScript على كامل المشروع. | High | tsconfig.base.json |
| tsconfig.json | جذر مراجع TypeScript للحزم الأساسية. | يعتمد على صيانة المراجع عند إضافة حزم جديدة. | يضمن typecheck موحدًا. | High | tsconfig.json |

### docs (8)

| الملف | الموجود | الناقص | الأثر | الأولوية | الدليل |
|---|---|---|---|---|---|
| docs/completion-plan.md | خطة مرحلية رسمية لترتيب الاستكمال من الداخل إلى الخارج. | يحتاج مواءمة مع أي تغيّر في الأسبقيات. | يحدد التسلسل الصحيح للتطوير. | High | docs/completion-plan.md |
| docs/fact-record.md | سجل حقيقة معتمد يصف ما يوجد وما ينقص طبقةً طبقة. | يجب تحديثه كلما تغيّر الكود أو العقد. | يمنع بناء قرارات على افتراضات قديمة. | High | docs/fact-record.md |
| docs/ENGINEERINGOS_MASTER_EXECUTION_CONSTITUTION.md | وثيقة Engineering Truth Verification الرئيسية: تصف 6 طبقات حقيقة، بنية ETV المقترحة، وخريطة المسارات ضمن الكود الحالي. المرجع الحاكم لبناء طبقة الحوكمة. | تحتاج مواءمة دورية مع كل تغيير جوهري في البنية. | تمنع الانفصال بين الحقيقة المعلنة والحقيقة المنفَّذة. | High | docs/ENGINEERINGOS_MASTER_EXECUTION_CONSTITUTION.md |
| docs/truth-flow-pr-checklist.md | قائمة إغلاق PR-ready للـ 12 node في Truth Flow Matrix؛ كل node يملك 3 بنود تنفيذية قابلة للإغلاق. | تحتاج تحديثًا كلما أُغلق node. | تحوّل المصفوفة من وثيقة إلى backlog PR منضبط. | High | docs/truth-flow-pr-checklist.md |
| docs/PR_BACKLOG.md | خارطة الطريق التنفيذية: 12 PR مرتبة بالمخاطر مع scope/files/risk/acceptance/dependency وstatus لكل PR؛ يُحدَّث بعد كل إغلاق (2026-07-15). | يُحدَّث مع كل PR مُغلق. | نقطة الحقيقة الوحيدة لتسلسل التنفيذ القادم. | High | docs/PR_BACKLOG.md |
| docs/EXECUTION_ALIGNMENT_REPORT.md | تقرير مواءمة التنفيذ: جرد 595 ملف، حالة 9 طبقات، posture لـ 12 feature، مسح كمي لـ 255 placeholder hit، وقائمة الـ 20 hot file (2026-07-15). | يُحدَّث عند تغيير حالة أي طبقة. | خط الأساس للقرارات التقنية اللاحقة. | High | docs/EXECUTION_ALIGNMENT_REPORT.md |
| docs/PLACEHOLDER_REGISTER.md | سجل placeholder: 35 ملف مع تصنيف حقيقي (stub/stub-like/test-only/correct-pattern) وتحديد 3 stubs حقيقية تحتاج عملًا في PR 04 (2026-07-15). | يُحدَّث مع كل إغلاق placeholder. | يمنع الخلط بين stubs الاختبار وstubs الإنتاج. | High | docs/PLACEHOLDER_REGISTER.md |
| docs/RUNTIME_EXECUTION_MATRIX.md | مصفوفة التنفيذ الفعلية: 12 feature × 8 أبعاد (UI/API/DB/Events/Audit/Tests/Status/Evidence)؛ كل feature بحالة Aligned وأدلة مباشرة (2026-07-15). | يُحدَّث عند إضافة feature جديدة أو تغيير حالة قائمة. | المرجع السريع لحالة كل feature في المنصة. | High | docs/RUNTIME_EXECUTION_MATRIX.md |

### .agents/memory (15)

| الملف | الموجود | الناقص | الأثر | الأولوية | الدليل |
|---|---|---|---|---|---|
| .agents/memory/MEMORY.md | مذكرة قرار/ذاكرة تشغيلية للجانب الهندسي. | تحتاج البقاء متوافقة مع الكود والوثائق الرسمية. | تحفظ القرارات والقواعد بين الجلسات. | Medium | .agents/memory/MEMORY.md |
| .agents/memory/audit-fixes.md | مذكرة قرار/ذاكرة تشغيلية للجانب الهندسي. | تحتاج البقاء متوافقة مع الكود والوثائق الرسمية. | تحفظ القرارات والقواعد بين الجلسات. | Medium | .agents/memory/audit-fixes.md |
| .agents/memory/discovery-feature.md | مذكرة قرار/ذاكرة تشغيلية للجانب الهندسي. | تحتاج البقاء متوافقة مع الكود والوثائق الرسمية. | تحفظ القرارات والقواعد بين الجلسات. | Medium | .agents/memory/discovery-feature.md |
| .agents/memory/engineeringos-completion-plan.md | مذكرة قرار/ذاكرة تشغيلية للجانب الهندسي. | تحتاج البقاء متوافقة مع الكود والوثائق الرسمية. | تحفظ القرارات والقواعد بين الجلسات. | Medium | .agents/memory/engineeringos-completion-plan.md |
| .agents/memory/fk-atomic-claim-ordering.md | مذكرة قرار/ذاكرة تشغيلية للجانب الهندسي. | تحتاج البقاء متوافقة مع الكود والوثائق الرسمية. | تحفظ القرارات والقواعد بين الجلسات. | Medium | .agents/memory/fk-atomic-claim-ordering.md |
| .agents/memory/scanner-ast-extraction.md | مذكرة قرار/ذاكرة تشغيلية للجانب الهندسي. | تحتاج البقاء متوافقة مع الكود والوثائق الرسمية. | تحفظ القرارات والقواعد بين الجلسات. | Medium | .agents/memory/scanner-ast-extraction.md |
| .agents/memory/testing-drift-checks.md | مذكرة قرار/ذاكرة تشغيلية للجانب الهندسي. | تحتاج البقاء متوافقة مع الكود والوثائق الرسمية. | تحفظ القرارات والقواعد بين الجلسات. | Medium | .agents/memory/testing-drift-checks.md |
| .agents/memory/orval-openapi-codegen.md | قواعد توليد Orval: inline request-body schemas تتعارض مع zod-type-folder؛ استخدم $ref دائمًا لأجسام غير فارغة. | يُراجع عند أي تعديل على OpenAPI أو إضافة endpoint جديد. | يمنع أخطاء codegen الصامتة. | Medium | .agents/memory/orval-openapi-codegen.md |
| .agents/memory/drizzle-error-wrapping.md | ملاحظة: خطأ Postgres الخام (`.code`/`.constraint`) يظهر على `err.cause` لا على `err` نفسه عند استخدام سائق node-postgres في drizzle-orm. | يُراجع عند كتابة أي معالجة أخطاء تعتمد على أكواد Postgres (مثل unique-violation 23505). | يمنع أخطاء صامتة في معالجة تعارضات القيود الفريدة. | Medium | .agents/memory/drizzle-error-wrapping.md |
| .agents/memory/ai-orchestrator-layer.md | توثيق طبقة الذكاء الاصطناعي: الوكلاء الخمسة، نقاط API، جداول DB، وسلوك customFetch في dashboard. | يُراجع عند تعديل أي وكيل أو إضافة endpoint جديد. | يحفظ القرارات الهندسية للـ AI layer عبر الجلسات. | Medium | .agents/memory/ai-orchestrator-layer.md |
| .agents/memory/clerk-auth-testing.md | vitest يضع NODE_ENV=test؛ requireAuth يتجاوز Clerk ويحقن test-user في هذه الحالة. لا حاجة لـ mock tokens في supertest. | يُراجع عند كتابة اختبارات integration تمس auth. | يمنع إضاعة الوقت في plumbing اختبارات Clerk. | Medium | .agents/memory/clerk-auth-testing.md |
| .agents/memory/clerk-401-race-cookie-vs-bearer.md | "فشل" يبدو كـ 401 لكنه في الحقيقة ETag يسبب 304 bodyless؛ العلاج: تعطيل etag + no-store + فحص status codes قبل إلقاء اللوم على auth. | يُراجع عند تشخيص أي فشل غامض في API يشبه auth failure. | يمنع إضاعة وقت التشخيص على auth بينما المشكلة cache. | Medium | .agents/memory/clerk-401-race-cookie-vs-bearer.md |
| .agents/memory/imported-project-workflow-failures.md | بعد import تفشل workflows لسببين مستقلين: غياب node_modules (يحل بـ pnpm install) وعدم push الـ schema إلى DB الجديدة (يحل بـ db push). | يُراجع عند أي import لنسخة جديدة من المشروع. | يوفر التسلسل الصحيح لإعادة الإقلاع بعد import. | Medium | .agents/memory/imported-project-workflow-failures.md |
| .agents/memory/project-ownership-scoping.md | نموذج ملكية المشروع الكامل (مُحدَّث 2026-07-14): نمطان للتطبيق — (1) وسيط `requireProjectAccess`/`requireProjectWriteAccess` لـ routes ذات `:projectId` في المسار، (2) `loadProjectByIdForUser(projectId, userId, res)` المُصدَّر للـ routes التي يأتي فيها projectId من query/body. جدول يوثّق أي نمط يستخدمه كل ملف. `actor: req.userId` إلزامي في كل `recordAudit`. اصطلاح 404 مقابل 403 موثّق. | لا توسيع متبقٍّ — كل routes تتحقق الآن. | يمنع أي مستخدم مسجّل من رؤية/تعديل مشاريع الآخرين عبر أي endpoint. | High | .agents/memory/project-ownership-scoping.md |
| .agents/memory/imported-project-clerk-secrets.md | نمط أعراض: `clerkMiddleware` يرمي "Missing Clerk Secret Key" على كل طلب (بما فيها الاختبارات) قبل تجاوز `requireAuth` في NODE_ENV=test؛ العلاج هو تزويد أسرار Clerk (`setupClerkWhitelabelAuth()`) لا تعديل الكود. | يُراجع عند استنساخ/استيراد نسخة جديدة من المشروع وفشل كل الاختبارات/الطلبات بنفس الخطأ. | يوفر وقت تشخيص كبير بتمييز مشكلة بيئة عن خلل كود. | Medium | .agents/memory/imported-project-clerk-secrets.md |

### lib/api-spec (3)

| الملف | الموجود | الناقص | الأثر | الأولوية | الدليل |
|---|---|---|---|---|---|
| lib/api-spec/openapi.yaml | العقد الرسمية للـ API ومصدر التوليد. | بعض المسارات التنفيذية تحتاج مواءمة/إدراجًا في العقد. | أي drift هنا ينعكس على الواجهة والخادم المولّدين. | High | lib/api-spec/openapi.yaml |
| lib/api-spec/orval.config.ts | تهيئة Orval لتوليد schemas/hooks من OpenAPI. | تعتمد سلامته على سلامة openapi.yaml. | يحكم مسار التوليد الآلي. | Medium | lib/api-spec/orval.config.ts |
| lib/api-spec/package.json | حزمة التوليد للعقد. | لا نقص مستقل ظاهر. | تجميع أدوات codegen. | Medium | lib/api-spec/package.json |

### lib/api-client-react (6)

| الملف | الموجود | الناقص | الأثر | الأولوية | الدليل |
|---|---|---|---|---|---|
| lib/api-client-react/package.json | حزمة عميل React Query المولّد. | تعتمد على codegen المتزامن. | تجمع الاعتماديات والهوية. | Medium | lib/api-client-react/package.json |
| lib/api-client-react/src/custom-fetch.ts | طبقة fetch مخصصة لعميل React Query. | لا نقص مستقل ظاهر. | توحّد الاستدعاء للشبكة. | Medium | lib/api-client-react/src/custom-fetch.ts |
| lib/api-client-react/src/generated/api.schemas.ts | schemas/metadata مولدة للعميل. | تحتاج تحديثًا عند drift. | تدعم type-safe client. | Medium | lib/api-client-react/src/generated/api.schemas.ts |
| lib/api-client-react/src/generated/api.ts | hooks/عميل React Query مولد من OpenAPI. | قد لا يرى المسارات غير المضافة للعقد. | واجهة الاستهلاك القياسية للـ API. | Medium | lib/api-client-react/src/generated/api.ts |
| lib/api-client-react/src/index.ts | نقطة تصدير للعميل المولّد. | لا نقص مستقل ظاهر. | يجعل الاستيراد موحدًا. | Medium | lib/api-client-react/src/index.ts |
| lib/api-client-react/tsconfig.json | إعداد TypeScript للحزمة. | لا نقص مستقل ظاهر. | يبني التحقق النوعي. | Medium | lib/api-client-react/tsconfig.json |

### lib/api-zod (80)

| الملف | الموجود | الناقص | الأثر | الأولوية | الدليل |
|---|---|---|---|---|---|
| lib/api-zod/package.json | حزمة Zod schemas المولدة. | تعتمد على codegen. | تجميع schemas للعميل والخادم. | Medium | lib/api-zod/package.json |
| lib/api-zod/src/generated/api.ts | entry schemas المولدة من OpenAPI. | تحتاج synchronization مع العقد. | تنقّل schemas بين الحزم. | Medium | lib/api-zod/src/generated/api.ts |
| lib/api-zod/src/generated/types/createProjectInput.ts | Schema/type مولد لـ `createProjectInput` من OpenAPI. | يجب أن يُعاد توليده عند أي تغيير في العقد. | يحافظ على التوافق النوعي. | Medium | lib/api-zod/src/generated/types/createProjectInput.ts |
| lib/api-zod/src/generated/types/createRuleInput.ts | Schema/type مولد لـ `createRuleInput` من OpenAPI. | يجب أن يُعاد توليده عند أي تغيير في العقد. | يحافظ على التوافق النوعي. | Medium | lib/api-zod/src/generated/types/createRuleInput.ts |
| lib/api-zod/src/generated/types/createTaskInput.ts | Schema/type مولد لـ `createTaskInput` من OpenAPI. | يجب أن يُعاد توليده عند أي تغيير في العقد. | يحافظ على التوافق النوعي. | Medium | lib/api-zod/src/generated/types/createTaskInput.ts |
| lib/api-zod/src/generated/types/createWorkflowInput.ts | Schema/type مولد لـ `createWorkflowInput` من OpenAPI. | يجب أن يُعاد توليده عند أي تغيير في العقد. | يحافظ على التوافق النوعي. | Medium | lib/api-zod/src/generated/types/createWorkflowInput.ts |
| lib/api-zod/src/generated/types/dashboardOverview.ts | Schema/type مولد لـ `dashboardOverview` من OpenAPI. | يجب أن يُعاد توليده عند أي تغيير في العقد. | يحافظ على التوافق النوعي. | Medium | lib/api-zod/src/generated/types/dashboardOverview.ts |
| lib/api-zod/src/generated/types/dashboardOverviewProjectScoresItem.ts | Schema/type مولد لـ `dashboardOverviewProjectScoresItem` من OpenAPI. | يجب أن يُعاد توليده عند أي تغيير في العقد. | يحافظ على التوافق النوعي. | Medium | lib/api-zod/src/generated/types/dashboardOverviewProjectScoresItem.ts |
| lib/api-zod/src/generated/types/dashboardOverviewProjectScoresItemTrend.ts | Schema/type مولد لـ `dashboardOverviewProjectScoresItemTrend` من OpenAPI. | يجب أن يُعاد توليده عند أي تغيير في العقد. | يحافظ على التوافق النوعي. | Medium | lib/api-zod/src/generated/types/dashboardOverviewProjectScoresItemTrend.ts |
| lib/api-zod/src/generated/types/dashboardOverviewTaskStatusBreakdown.ts | Schema/type مولد لـ `dashboardOverviewTaskStatusBreakdown` من OpenAPI. | يجب أن يُعاد توليده عند أي تغيير في العقد. | يحافظ على التوافق النوعي. | Medium | lib/api-zod/src/generated/types/dashboardOverviewTaskStatusBreakdown.ts |
| lib/api-zod/src/generated/types/dashboardOverviewTopRulesItem.ts | Schema/type مولد لـ `dashboardOverviewTopRulesItem` من OpenAPI. | يجب أن يُعاد توليده عند أي تغيير في العقد. | يحافظ على التوافق النوعي. | Medium | lib/api-zod/src/generated/types/dashboardOverviewTopRulesItem.ts |
| lib/api-zod/src/generated/types/discoveryGraphSummaryData.ts | Schema/type مولد لـ `discoveryGraphSummaryData` من OpenAPI. | يجب أن يُعاد توليده عند أي تغيير في العقد. | يحافظ على التوافق النوعي. | Medium | lib/api-zod/src/generated/types/discoveryGraphSummaryData.ts |
| lib/api-zod/src/generated/types/discoveryReport.ts | Schema/type مولد لـ `discoveryReport` من OpenAPI. | يجب أن يُعاد توليده عند أي تغيير في العقد. | يحافظ على التوافق النوعي. | Medium | lib/api-zod/src/generated/types/discoveryReport.ts |
| lib/api-zod/src/generated/types/discoveryRuleViolationItem.ts | Schema/type مولد لـ `discoveryRuleViolationItem` من OpenAPI. | يجب أن يُعاد توليده عند أي تغيير في العقد. | يحافظ على التوافق النوعي. | Medium | lib/api-zod/src/generated/types/discoveryRuleViolationItem.ts |
| lib/api-zod/src/generated/types/discoverySessionStatus.ts | Schema/type مولد لـ `discoverySessionStatus` من OpenAPI. | يجب أن يُعاد توليده عند أي تغيير في العقد. | يحافظ على التوافق النوعي. | Medium | lib/api-zod/src/generated/types/discoverySessionStatus.ts |
| lib/api-zod/src/generated/types/discoverySessionStatusStatus.ts | Schema/type مولد لـ `discoverySessionStatusStatus` من OpenAPI. | يجب أن يُعاد توليده عند أي تغيير في العقد. | يحافظ على التوافق النوعي. | Medium | lib/api-zod/src/generated/types/discoverySessionStatusStatus.ts |
| lib/api-zod/src/generated/types/discoveryStepItem.ts | Schema/type مولد لـ `discoveryStepItem` من OpenAPI. | يجب أن يُعاد توليده عند أي تغيير في العقد. | يحافظ على التوافق النوعي. | Medium | lib/api-zod/src/generated/types/discoveryStepItem.ts |
| lib/api-zod/src/generated/types/discoveryStepItemStatus.ts | Schema/type مولد لـ `discoveryStepItemStatus` من OpenAPI. | يجب أن يُعاد توليده عند أي تغيير في العقد. | يحافظ على التوافق النوعي. | Medium | lib/api-zod/src/generated/types/discoveryStepItemStatus.ts |
| lib/api-zod/src/generated/types/entityType.ts | Schema/type مولد لـ `entityType` من OpenAPI. | يجب أن يُعاد توليده عند أي تغيير في العقد. | يحافظ على التوافق النوعي. | Medium | lib/api-zod/src/generated/types/entityType.ts |
| lib/api-zod/src/generated/types/evaluateRuleRequest.ts | Schema/type مولد لـ `evaluateRuleRequest` من OpenAPI. | يجب أن يُعاد توليده عند أي تغيير في العقد. | يحافظ على التوافق النوعي. | Medium | lib/api-zod/src/generated/types/evaluateRuleRequest.ts |
| lib/api-zod/src/generated/types/event.ts | Schema/type مولد لـ `event` من OpenAPI. | يجب أن يُعاد توليده عند أي تغيير في العقد. | يحافظ على التوافق النوعي. | Medium | lib/api-zod/src/generated/types/event.ts |
| lib/api-zod/src/generated/types/eventPayload.ts | Schema/type مولد لـ `eventPayload` من OpenAPI. | يجب أن يُعاد توليده عند أي تغيير في العقد. | يحافظ على التوافق النوعي. | Medium | lib/api-zod/src/generated/types/eventPayload.ts |
| lib/api-zod/src/generated/types/eventSeverity.ts | Schema/type مولد لـ `eventSeverity` من OpenAPI. | يجب أن يُعاد توليده عند أي تغيير في العقد. | يحافظ على التوافق النوعي. | Medium | lib/api-zod/src/generated/types/eventSeverity.ts |
| lib/api-zod/src/generated/types/failWorkflowPhaseInput.ts | Schema/type مولد لـ `failWorkflowPhaseInput` من OpenAPI (أُضيف مع endpoint fail-phase). | يجب أن يُعاد توليده عند أي تغيير في العقد. | يحافظ على التوافق النوعي. | Medium | lib/api-zod/src/generated/types/failWorkflowPhaseInput.ts |
| lib/api-zod/src/generated/types/getGraphEntityNeighbors200.ts | Schema/type مولد لاستجابة 200 لـ `getGraphEntityNeighbors`. | يجب أن يُعاد توليده عند أي تغيير في العقد. | يحافظ على التوافق النوعي. | Medium | lib/api-zod/src/generated/types/getGraphEntityNeighbors200.ts |
| lib/api-zod/src/generated/types/getGraphEntityNeighbors404.ts | Schema/type مولد لاستجابة 404 لـ `getGraphEntityNeighbors`. | يجب أن يُعاد توليده عند أي تغيير في العقد. | يحافظ على التوافق النوعي. | Medium | lib/api-zod/src/generated/types/getGraphEntityNeighbors404.ts |
| lib/api-zod/src/generated/types/getLatestMetricsParams.ts | Schema/type مولد لـ `getLatestMetricsParams` من OpenAPI. | يجب أن يُعاد توليده عند أي تغيير في العقد. | يحافظ على التوافق النوعي. | Medium | lib/api-zod/src/generated/types/getLatestMetricsParams.ts |
| lib/api-zod/src/generated/types/graphEntity.ts | Schema/type مولد لـ `graphEntity` من OpenAPI. | يجب أن يُعاد توليده عند أي تغيير في العقد. | يحافظ على التوافق النوعي. | Medium | lib/api-zod/src/generated/types/graphEntity.ts |
| lib/api-zod/src/generated/types/graphEntityMetadata.ts | Schema/type مولد لـ `graphEntityMetadata` من OpenAPI. | يجب أن يُعاد توليده عند أي تغيير في العقد. | يحافظ على التوافق النوعي. | Medium | lib/api-zod/src/generated/types/graphEntityMetadata.ts |
| lib/api-zod/src/generated/types/graphRelationship.ts | Schema/type مولد لـ `graphRelationship` من OpenAPI. | يجب أن يُعاد توليده عند أي تغيير في العقد. | يحافظ على التوافق النوعي. | Medium | lib/api-zod/src/generated/types/graphRelationship.ts |
| lib/api-zod/src/generated/types/graphRelationshipMetadata.ts | Schema/type مولد لـ `graphRelationshipMetadata` من OpenAPI. | يجب أن يُعاد توليده عند أي تغيير في العقد. | يحافظ على التوافق النوعي. | Medium | lib/api-zod/src/generated/types/graphRelationshipMetadata.ts |
| lib/api-zod/src/generated/types/healthStatus.ts | Schema/type مولد لـ `healthStatus` من OpenAPI. | يجب أن يُعاد توليده عند أي تغيير في العقد. | يحافظ على التوافق النوعي. | Medium | lib/api-zod/src/generated/types/healthStatus.ts |
| lib/api-zod/src/generated/types/healthStatusStatus.ts | Schema/type مولد لـ `healthStatusStatus` من OpenAPI. | يجب أن يُعاد توليده عند أي تغيير في العقد. | يحافظ على التوافق النوعي. | Medium | lib/api-zod/src/generated/types/healthStatusStatus.ts |
| lib/api-zod/src/generated/types/importProjectInput.ts | Schema/type مولد لـ `importProjectInput` من OpenAPI. | يجب أن يُعاد توليده عند أي تغيير في العقد. | يحافظ على التوافق النوعي. | Medium | lib/api-zod/src/generated/types/importProjectInput.ts |
| lib/api-zod/src/generated/types/importProjectInputOverrides.ts | Schema/type مولد لـ `importProjectInputOverrides` من OpenAPI. | يجب أن يُعاد توليده عند أي تغيير في العقد. | يحافظ على التوافق النوعي. | Medium | lib/api-zod/src/generated/types/importProjectInputOverrides.ts |
| lib/api-zod/src/generated/types/index.ts | إعادة تصدير لأنواع/schemas المولدة. | لا نقص مستقل ظاهر. | يدعم استيرادًا موحدًا. | Medium | lib/api-zod/src/generated/types/index.ts |
| lib/api-zod/src/generated/types/listEventsParams.ts | Schema/type مولد لـ `listEventsParams` من OpenAPI. | يجب أن يُعاد توليده عند أي تغيير في العقد. | يحافظ على التوافق النوعي. | Medium | lib/api-zod/src/generated/types/listEventsParams.ts |
| lib/api-zod/src/generated/types/listGraphEntitiesParams.ts | Schema/type مولد لـ `listGraphEntitiesParams` من OpenAPI. | يجب أن يُعاد توليده عند أي تغيير في العقد. | يحافظ على التوافق النوعي. | Medium | lib/api-zod/src/generated/types/listGraphEntitiesParams.ts |
| lib/api-zod/src/generated/types/listGraphRelationshipsParams.ts | Schema/type مولد لـ `listGraphRelationshipsParams` من OpenAPI. | يجب أن يُعاد توليده عند أي تغيير في العقد. | يحافظ على التوافق النوعي. | Medium | lib/api-zod/src/generated/types/listGraphRelationshipsParams.ts |
| lib/api-zod/src/generated/types/listMetricsParams.ts | Schema/type مولد لـ `listMetricsParams` من OpenAPI. | يجب أن يُعاد توليده عند أي تغيير في العقد. | يحافظ على التوافق النوعي. | Medium | lib/api-zod/src/generated/types/listMetricsParams.ts |
| lib/api-zod/src/generated/types/listRulesParams.ts | Schema/type مولد لـ `listRulesParams` من OpenAPI. | يجب أن يُعاد توليده عند أي تغيير في العقد. | يحافظ على التوافق النوعي. | Medium | lib/api-zod/src/generated/types/listRulesParams.ts |
| lib/api-zod/src/generated/types/listTasksParams.ts | Schema/type مولد لـ `listTasksParams` من OpenAPI. | يجب أن يُعاد توليده عند أي تغيير في العقد. | يحافظ على التوافق النوعي. | Medium | lib/api-zod/src/generated/types/listTasksParams.ts |
| lib/api-zod/src/generated/types/listWorkflowsParams.ts | Schema/type مولد لـ `listWorkflowsParams` من OpenAPI. | يجب أن يُعاد توليده عند أي تغيير في العقد. | يحافظ على التوافق النوعي. | Medium | lib/api-zod/src/generated/types/listWorkflowsParams.ts |
| lib/api-zod/src/generated/types/metricRecord.ts | Schema/type مولد لـ `metricRecord` من OpenAPI. | يجب أن يُعاد توليده عند أي تغيير في العقد. | يحافظ على التوافق النوعي. | Medium | lib/api-zod/src/generated/types/metricRecord.ts |
| lib/api-zod/src/generated/types/metricRecordBuildStatus.ts | Schema/type مولد لـ `metricRecordBuildStatus` من OpenAPI. | يجب أن يُعاد توليده عند أي تغيير في العقد. | يحافظ على التوافق النوعي. | Medium | lib/api-zod/src/generated/types/metricRecordBuildStatus.ts |
| lib/api-zod/src/generated/types/plugin.ts | Schema/type مولد لـ `plugin` من OpenAPI. | يجب أن يُعاد توليده عند أي تغيير في العقد. | يحافظ على التوافق النوعي. | Medium | lib/api-zod/src/generated/types/plugin.ts |
| lib/api-zod/src/generated/types/pluginCapabilitiesItem.ts | Schema/type مولد لـ `pluginCapabilitiesItem` من OpenAPI. | يجب أن يُعاد توليده عند أي تغيير في العقد. | يحافظ على التوافق النوعي. | Medium | lib/api-zod/src/generated/types/pluginCapabilitiesItem.ts |
| lib/api-zod/src/generated/types/pluginProjectRequest.ts | Schema/type مولد لـ `pluginProjectRequest` من OpenAPI. | يجب أن يُعاد توليده عند أي تغيير في العقد. | يحافظ على التوافق النوعي. | Medium | lib/api-zod/src/generated/types/pluginProjectRequest.ts |
| lib/api-zod/src/generated/types/project.ts | Schema/type مولد لـ `project` من OpenAPI. | يجب أن يُعاد توليده عند أي تغيير في العقد. | يحافظ على التوافق النوعي. | Medium | lib/api-zod/src/generated/types/project.ts |
| lib/api-zod/src/generated/types/projectStatus.ts | Schema/type مولد لـ `projectStatus` من OpenAPI. | يجب أن يُعاد توليده عند أي تغيير في العقد. | يحافظ على التوافق النوعي. | Medium | lib/api-zod/src/generated/types/projectStatus.ts |
| lib/api-zod/src/generated/types/projectSummary.ts | Schema/type مولد لـ `projectSummary` من OpenAPI. | يجب أن يُعاد توليده عند أي تغيير في العقد. | يحافظ على التوافق النوعي. | Medium | lib/api-zod/src/generated/types/projectSummary.ts |
| lib/api-zod/src/generated/types/projectSummaryTaskCounts.ts | Schema/type مولد لـ `projectSummaryTaskCounts` من OpenAPI. | يجب أن يُعاد توليده عند أي تغيير في العقد. | يحافظ على التوافق النوعي. | Medium | lib/api-zod/src/generated/types/projectSummaryTaskCounts.ts |
| lib/api-zod/src/generated/types/rule.ts | Schema/type مولد لـ `rule` من OpenAPI. | يجب أن يُعاد توليده عند أي تغيير في العقد. | يحافظ على التوافق النوعي. | Medium | lib/api-zod/src/generated/types/rule.ts |
| lib/api-zod/src/generated/types/ruleEvaluationResult.ts | Schema/type مولد لـ `ruleEvaluationResult` من OpenAPI. | يجب أن يُعاد توليده عند أي تغيير في العقد. | يحافظ على التوافق النوعي. | Medium | lib/api-zod/src/generated/types/ruleEvaluationResult.ts |
| lib/api-zod/src/generated/types/ruleEvaluationResultMatchesItem.ts | Schema/type مولد لـ `ruleEvaluationResultMatchesItem` من OpenAPI. | يجب أن يُعاد توليده عند أي تغيير في العقد. | يحافظ على التوافق النوعي. | Medium | lib/api-zod/src/generated/types/ruleEvaluationResultMatchesItem.ts |
| lib/api-zod/src/generated/types/ruleSeverity.ts | Schema/type مولد لـ `ruleSeverity` من OpenAPI. | يجب أن يُعاد توليده عند أي تغيير في العقد. | يحافظ على التوافق النوعي. | Medium | lib/api-zod/src/generated/types/ruleSeverity.ts |
| lib/api-zod/src/generated/types/scanJob.ts | Schema/type مولد لـ `scanJob` من OpenAPI. | يجب أن يُعاد توليده عند أي تغيير في العقد. | يحافظ على التوافق النوعي. | Medium | lib/api-zod/src/generated/types/scanJob.ts |
| lib/api-zod/src/generated/types/scanJobStatus.ts | Schema/type مولد لـ `scanJobStatus` من OpenAPI. | يجب أن يُعاد توليده عند أي تغيير في العقد. | يحافظ على التوافق النوعي. | Medium | lib/api-zod/src/generated/types/scanJobStatus.ts |
| lib/api-zod/src/generated/types/scanResult.ts | Schema/type مولد لـ `scanResult` من OpenAPI. | يجب أن يُعاد توليده عند أي تغيير في العقد. | يحافظ على التوافق النوعي. | Medium | lib/api-zod/src/generated/types/scanResult.ts |
| lib/api-zod/src/generated/types/startDiscoveryInput.ts | Schema/type مولد لـ `startDiscoveryInput` من OpenAPI. | يجب أن يُعاد توليده عند أي تغيير في العقد. | يحافظ على التوافق النوعي. | Medium | lib/api-zod/src/generated/types/startDiscoveryInput.ts |
| lib/api-zod/src/generated/types/startDiscoveryInputSource.ts | Schema/type مولد لـ `startDiscoveryInputSource` من OpenAPI. | يجب أن يُعاد توليده عند أي تغيير في العقد. | يحافظ على التوافق النوعي. | Medium | lib/api-zod/src/generated/types/startDiscoveryInputSource.ts |
| lib/api-zod/src/generated/types/task.ts | Schema/type مولد لـ `task` من OpenAPI. | يجب أن يُعاد توليده عند أي تغيير في العقد. | يحافظ على التوافق النوعي. | Medium | lib/api-zod/src/generated/types/task.ts |
| lib/api-zod/src/generated/types/taskLog.ts | Schema/type مولد لـ `taskLog` من OpenAPI. | يجب أن يُعاد توليده عند أي تغيير في العقد. | يحافظ على التوافق النوعي. | Medium | lib/api-zod/src/generated/types/taskLog.ts |
| lib/api-zod/src/generated/types/taskLogLevel.ts | Schema/type مولد لـ `taskLogLevel` من OpenAPI. | يجب أن يُعاد توليده عند أي تغيير في العقد. | يحافظ على التوافق النوعي. | Medium | lib/api-zod/src/generated/types/taskLogLevel.ts |
| lib/api-zod/src/generated/types/taskLogMetadata.ts | Schema/type مولد لـ `taskLogMetadata` من OpenAPI. | يجب أن يُعاد توليده عند أي تغيير في العقد. | يحافظ على التوافق النوعي. | Medium | lib/api-zod/src/generated/types/taskLogMetadata.ts |
| lib/api-zod/src/generated/types/taskPriority.ts | Schema/type مولد لـ `taskPriority` من OpenAPI. | يجب أن يُعاد توليده عند أي تغيير في العقد. | يحافظ على التوافق النوعي. | Medium | lib/api-zod/src/generated/types/taskPriority.ts |
| lib/api-zod/src/generated/types/taskStatus.ts | Schema/type مولد لـ `taskStatus` من OpenAPI. | يجب أن يُعاد توليده عند أي تغيير في العقد. | يحافظ على التوافق النوعي. | Medium | lib/api-zod/src/generated/types/taskStatus.ts |
| lib/api-zod/src/generated/types/updateProjectInput.ts | Schema/type مولد لـ `updateProjectInput` من OpenAPI. | يجب أن يُعاد توليده عند أي تغيير في العقد. | يحافظ على التوافق النوعي. | Medium | lib/api-zod/src/generated/types/updateProjectInput.ts |
| lib/api-zod/src/generated/types/updateProjectInputStatus.ts | Schema/type مولد لـ `updateProjectInputStatus` من OpenAPI. | يجب أن يُعاد توليده عند أي تغيير في العقد. | يحافظ على التوافق النوعي. | Medium | lib/api-zod/src/generated/types/updateProjectInputStatus.ts |
| lib/api-zod/src/generated/types/updateRuleInput.ts | Schema/type مولد لـ `updateRuleInput` من OpenAPI. | يجب أن يُعاد توليده عند أي تغيير في العقد. | يحافظ على التوافق النوعي. | Medium | lib/api-zod/src/generated/types/updateRuleInput.ts |
| lib/api-zod/src/generated/types/updateTaskInput.ts | Schema/type مولد لـ `updateTaskInput` من OpenAPI. | يجب أن يُعاد توليده عند أي تغيير في العقد. | يحافظ على التوافق النوعي. | Medium | lib/api-zod/src/generated/types/updateTaskInput.ts |
| lib/api-zod/src/generated/types/verificationResult.ts | Schema/type مولد لـ `verificationResult` من OpenAPI. | يجب أن يُعاد توليده عند أي تغيير في العقد. | يحافظ على التوافق النوعي. | Medium | lib/api-zod/src/generated/types/verificationResult.ts |
| lib/api-zod/src/generated/types/verificationResultStepsItem.ts | Schema/type مولد لـ `verificationResultStepsItem` من OpenAPI. | يجب أن يُعاد توليده عند أي تغيير في العقد. | يحافظ على التوافق النوعي. | Medium | lib/api-zod/src/generated/types/verificationResultStepsItem.ts |
| lib/api-zod/src/generated/types/workflow.ts | Schema/type مولد لـ `workflow` من OpenAPI. | يجب أن يُعاد توليده عند أي تغيير في العقد. | يحافظ على التوافق النوعي. | Medium | lib/api-zod/src/generated/types/workflow.ts |
| lib/api-zod/src/generated/types/workflowExecution.ts | Schema/type مولد لـ `workflowExecution` من OpenAPI. | يجب أن يُعاد توليده عند أي تغيير في العقد. | يحافظ على التوافق النوعي. | Medium | lib/api-zod/src/generated/types/workflowExecution.ts |
| lib/api-zod/src/generated/types/workflowPhase.ts | Schema/type مولد لـ `workflowPhase` من OpenAPI. | يجب أن يُعاد توليده عند أي تغيير في العقد. | يحافظ على التوافق النوعي. | Medium | lib/api-zod/src/generated/types/workflowPhase.ts |
| lib/api-zod/src/generated/types/workflowStatus.ts | Schema/type مولد لـ `workflowStatus` من OpenAPI. | يجب أن يُعاد توليده عند أي تغيير في العقد. | يحافظ على التوافق النوعي. | Medium | lib/api-zod/src/generated/types/workflowStatus.ts |
| lib/api-zod/src/index.ts | إعادة تصدير لأنواع/schemas المولدة + truth-flow-matrix.schema (2026-07-15). | لا نقص مستقل ظاهر. | يدعم استيرادًا موحدًا. | Medium | lib/api-zod/src/index.ts |
| lib/api-zod/src/truth-flow-matrix.schema.ts | مخطط Zod للـ Truth Flow Matrix: TruthFlowMatrixSchema (عام) + CurrentTruthFlowMatrixSchema (يتحقق من 12 node مع status/confidence/paths محددة) + EXPECTED_CURRENT_TRUTH_FLOW_MATRIX كـ baseline مرجعية + دوال validate/assert/safeValidate + listTruthFlowDriftSignals لكشف الانحراف (2026-07-15). | يجب تحديث EXPECTED_CURRENT_TRUTH_FLOW_MATRIX عند تغيير حالة أي node. | gate الحوكمة: يمنع قبول matrix منحرفة عن الـ baseline المعتمد. | High | lib/api-zod/src/truth-flow-matrix.schema.ts |
| lib/api-zod/tsconfig.json | إعداد TypeScript للحزمة. | لا نقص مستقل ظاهر. | يدعم التحقق والتجميع. | Medium | lib/api-zod/tsconfig.json |

### lib/db (4)

| الملف | الموجود | الناقص | الأثر | الأولوية | الدليل |
|---|---|---|---|---|---|
| lib/db/drizzle.config.ts | تهيئة drizzle-kit: يحدد مسار schema، dialect (postgresql)، وdbCredentials من DATABASE_URL. | يجب تحديثه إذا تغير مسار schema أو dialect. | يشغّل push/migrate في بيئة التطوير. | High | lib/db/drizzle.config.ts |
| lib/db/package.json | تعريف حزمة lib/db ضمن workspace. | يُراجع عند إضافة اعتماديات db جديدة. | يجمع اعتماديات طبقة البيانات. | Medium | lib/db/package.json |
| lib/db/src/index.ts | نقطة تصدير رئيسية: ينشئ Pool وdrizzle instance ويعيد تصدير كل schema. | يفشل مبكرًا إذا غاب DATABASE_URL. | مدخل موحد لكل المستهلكين من lib/db. | High | lib/db/src/index.ts |
| lib/db/tsconfig.json | إعداد TypeScript لحزمة lib/db. | لا نقص مستقل ظاهر. | يضمن التحقق النوعي للحزمة. | Medium | lib/db/tsconfig.json |

### lib/db/src/schema (14)

| الملف | الموجود | الناقص | الأثر | الأولوية | الدليل |
|---|---|---|---|---|---|
| lib/db/src/schema/audit_logs.ts | سجل تدقيق للعمليات الحساسة. | best-effort لا يشارك دائمًا نفس transaction. | يسمح بالمراجعة والحوكمة. | High | lib/db/src/schema/audit_logs.ts |
| lib/db/src/schema/discovery.ts | جلسات discovery وخطواتها وخيارات الاستيراد. | بعض حالات الفشل الجزئي تتطلب ضبطًا دائمًا. | يدخل المشاريع إلى النظام. | High | lib/db/src/schema/discovery.ts |
| lib/db/src/schema/events.ts | سجل الأحداث المرتبط بالمشاريع/المهام/الـ workflows. | يتطلب correlating أكثر مع logs/metrics. | ذاكرة تشغيلية تاريخية. | High | lib/db/src/schema/events.ts |
| lib/db/src/schema/graph.ts | كيانات وعلاقات الرسم/المعرفة الداخلية. | الواجهة لا تستفيد بعد من كل العمق. | يعطي بنية معرفة قابلة للاستكشاف. | High | lib/db/src/schema/graph.ts |
| lib/db/src/schema/index.ts | تجميع/إعادة تصدير مخطط DB. | لا نقص مستقل ظاهر. | نقطة دخول موحدة للمخطط. | High | lib/db/src/schema/index.ts |
| lib/db/src/schema/metrics.ts | تخزين المقاييس ونتائج القياس. | يحتاج مواءمة دورية مع الحسابات الفعلية. | يعرض صحة المشروع. | High | lib/db/src/schema/metrics.ts |
| lib/db/src/schema/plugins.ts | جدول الإضافات/القدرات. | يحتاج lifecycle واضح إذا توسعت المنصة. | يفتح باب التوسعة. | High | lib/db/src/schema/plugins.ts |
| lib/db/src/schema/projects.ts | جدول المشاريع وحالاتها وحقولها الأساسية. | أي FK/قيد غير مضبوط هنا يربك بقية الطبقات. | كيان البداية لكل العمليات. | High | lib/db/src/schema/projects.ts |
| lib/db/src/schema/rules.ts | جدول القواعد وتعريفات severity/reference. | يحتاج اتساقًا مع تقييمات scanner والواجهات. | يحدد سياسة الفحص. | High | lib/db/src/schema/rules.ts |
| lib/db/src/schema/scan_jobs.ts | مهام فحص الخلفية وحالاتها. | تحتاج دقة في lifecycle مع project linkage. | تشغّل التحليل على المشاريع. | High | lib/db/src/schema/scan_jobs.ts |
| lib/db/src/schema/task_logs.ts | سجل تفصيلي لتاريخ تنفيذ المهام. | يحتاج مواءمة أعمق مع traceability. | يتتبع ما حدث أثناء التنفيذ. | High | lib/db/src/schema/task_logs.ts |
| lib/db/src/schema/tasks.ts | جدول المهام وحالاتها وأولوياتها. | يعتمد على سلامة transitions والارتباطات. | محور التشغيل والتنفيذ. | High | lib/db/src/schema/tasks.ts |
| lib/db/src/schema/workflows.ts | تعريف workflow execution/phases/currentPhase. | منطق branching الشرطي غير ممثل بالكامل. | يمثل orchestration state. | High | lib/db/src/schema/workflows.ts |
| lib/db/src/schema/ai_chats.ts | جدولا `ai_chat_sessions` (id, projectId, title, timestamps) و`ai_chat_messages` (id, sessionId, role enum, content, sources JSON string, createdAt)؛ مُدفوعان إلى Postgres. | sources مخزَّن كـ JSON string لا JSONB — مقبول للقراءة/الكتابة البسيطة. | يُخزَّن تاريخ المحادثات مع AI assistant لكل مشروع. | High | lib/db/src/schema/ai_chats.ts |

### scripts (5)

| الملف | الموجود | الناقص | الأثر | الأولوية | الدليل |
|---|---|---|---|---|---|
| scripts/package.json | تعريف حزمة scripts ضمن workspace (`@workspace/scripts`). | لا نقص مستقل ظاهر. | يجمع سكريبتات الأدوات والصيانة. | Low | scripts/package.json |
| scripts/post-merge.sh | سكريبت ما بعد الدمج: يُشغَّل تلقائيًا عند دمج task agent؛ يفحص تثبيت الحزم وتهيئة البيئة. | يجب تحديثه إذا تغيرت متطلبات البيئة بعد أي دمج. | يضمن جاهزية البيئة فور الدمج. | Medium | scripts/post-merge.sh |
| scripts/src/hello.ts | سكريبت مرجعي بسيط (`console.log("Hello from @workspace/scripts")`). | placeholder حاليًا، لا منطق حقيقي. | نموذج لإضافة سكريبتات أدوات مستقبلية. | Low | scripts/src/hello.ts |
| scripts/check-codegen-drift.ts | فحص CI: يُعيد توليد الكود ثم يفحص `git diff` و untracked files في مجلدات الـ generated؛ يخرج بـ exit 1 مع رسالة واضحة عند أي drift. يُكمّل `codegen:check` في package.json. | يُشغَّل في CI وقبل أي merge. | يمنع دمج تغييرات openapi.yaml بدون تحديث الكود المولَّد. | High | scripts/check-codegen-drift.ts |
| scripts/tsconfig.json | إعداد TypeScript لحزمة scripts. | لا نقص مستقل ظاهر. | يضمن تجميع السكريبتات. | Low | scripts/tsconfig.json |

### lib/scanner (12)

| الملف | الموجود | الناقص | الأثر | الأولوية | الدليل |
|---|---|---|---|---|---|
| lib/scanner/package.json | ملف مساند داخل scanner. | يتحدد حسب الاستهلاك. | يسهم في التحليل. | Medium | lib/scanner/package.json |
| lib/scanner/src/__tests__/file-walker.test.ts | ملف مساند داخل scanner. | يتحدد حسب الاستهلاك. | يسهم في التحليل. | Medium | lib/scanner/src/__tests__/file-walker.test.ts |
| lib/scanner/src/__tests__/graph-extractor.test.ts | اختبارات لاستخراج الرسم والعلاقات. | تحتاج تغطية أوسع لحواف اللغات والبنية. | تثبت صحة AST extraction. | Medium | lib/scanner/src/__tests__/graph-extractor.test.ts |
| lib/scanner/src/__tests__/metrics-calc.test.ts | اختبارات حساب المقاييس. | قد تحتاج حالات بيانات أكثر تنوعًا. | تحقق عدالة حسابات الجودة. | Medium | lib/scanner/src/__tests__/metrics-calc.test.ts |
| lib/scanner/src/__tests__/rule-matcher.test.ts | اختبارات مطابقة القواعد. | تحتاج حالات حدودية إضافية. | تثبت heuristics المطابقة. | Medium | lib/scanner/src/__tests__/rule-matcher.test.ts |
| lib/scanner/src/file-walker.ts | يمشي على الملفات مع حدود استثناء/حجم. | قد يحتاج اتساعًا لأنماط المشاريع المختلفة. | مصدر المدخلات للمحلل. | High | lib/scanner/src/file-walker.ts |
| lib/scanner/src/graph-extractor.ts | يستخرج كيانات وعلاقات TS/JS عبر AST؛ بايثون الآن عبر `ast` حقيقي (subprocess) مع fallback regex عند الفشل؛ أُضيفت فجوتا CommonJS (`Object.assign(module.exports,...)` و`module.exports = require(...)`). | fallback الـregex ما يزال heuristic بحت عند فشل الـsubprocess بالكامل. | يبني المعرفة البنيوية. | High | lib/scanner/src/graph-extractor.ts |
| lib/scanner/src/python-extractor.ts | يشغّل عملية `python3` واحدة مجمّعة (batch) عبر stdin/stdout لاستخراج AST بايثون الحقيقي، مع timeout وتعامل مع الأخطاء. | يعتمد على توفر `python3` في البيئة (مضاف كموديول Replit). | يزوّد graph-extractor ببيانات AST حقيقية بدل regex. | High | lib/scanner/src/python-extractor.ts |
| lib/scanner/src/python-ast-script.py | مصدر سكربت بايثون (قابل للقراءة/التعديل) يفسّر الملفات عبر `ast.parse`/`ast.walk` ويصدر JSON. | يجب إعادة توليد python-ast-script.ts يدويًا بعد أي تعديل هنا. | مرجع قابل للقراءة لمنطق الاستخراج الفعلي. | Medium | lib/scanner/src/python-ast-script.py |
| lib/scanner/src/python-ast-script.ts | نسخة مولّدة (ثابت نصي) من python-ast-script.py، مضمّنة لأن esbuild يجمّع الحزمة في ملف واحد ولا ينسخ أصول `.py` جانبية. | يجب أن تبقى متزامنة مع الملف المصدر .py. | ما يُشحن فعليًا في الحزمة المبنية. | Medium | lib/scanner/src/python-ast-script.ts |
| lib/scanner/src/index.ts | واجهة تصدير للحزمة scanner. | لا نقص مستقل ظاهر. | مدخل موحد للمكتبة. | Medium | lib/scanner/src/index.ts |
| lib/scanner/src/metrics-calc.ts | يحسب درجات الجودة/الدين/التغطية. | يحتاج معايرة مستمرة. | يحوّل الإشارات إلى رقم قابل للقراءة. | High | lib/scanner/src/metrics-calc.ts |
| lib/scanner/src/rule-matcher.ts | يطابق القواعد على النص/المحتوى. | ما يزال regex-driven. | يحدد المخالفات/الإشارات. | High | lib/scanner/src/rule-matcher.ts |
| lib/scanner/tsconfig.json | ملف مساند داخل scanner. | يتحدد حسب الاستهلاك. | يسهم في التحليل. | Medium | lib/scanner/tsconfig.json |
| lib/scanner/vitest.config.ts | ملف مساند داخل scanner. | يتحدد حسب الاستهلاك. | يسهم في التحليل. | Medium | lib/scanner/vitest.config.ts |

### lib/knowledge-engine (6)

| الملف | الموجود | الناقص | الأثر | الأولوية | الدليل |
|---|---|---|---|---|---|
| lib/knowledge-engine/package.json | تعريف حزمة lib/knowledge-engine ضمن workspace؛ يتضمن drizzle-orm كاعتمادية مباشرة (ليس فقط transitive). | يجب أن تبقى drizzle-orm اعتمادية مباشرة هنا — الـ compiler لا يحل transitive deps. | يُجمِّع اعتماديات طبقة الاستعلام. | Medium | lib/knowledge-engine/package.json |
| lib/knowledge-engine/tsconfig.json | إعداد TypeScript للحزمة مع مرجع لـ lib/db. | لا نقص مستقل. | يضمن التحقق النوعي. | Medium | lib/knowledge-engine/tsconfig.json |
| lib/knowledge-engine/src/index.ts | barrel export لكل types/queries/inference. | لا نقص مستقل. | مدخل موحد للمكتبة. | Medium | lib/knowledge-engine/src/index.ts |
| lib/knowledge-engine/src/types.ts | أنواع مشتركة لنتائج الاستعلامات (ImpactResult, PathResult, NeighbourhoodResult, CentralityResult, ClusterResult). | لا نقص مستقل. | يضمن اتساق الأنواع بين الاستعلامات والـ inference. | Medium | lib/knowledge-engine/src/types.ts |
| lib/knowledge-engine/src/queries.ts | استعلامات BFS على graph_entities/relationships: impact (التأثير الأدنى لكيان)، path (أقصر مسار بين كيانين)، neighbourhood (الجوار المباشر). | تعتمد على بيانات graph مكتملة — إذا كان الـ graph فارغاً لمشروع فالنتائج فارغة. | يُحوِّل الـ graph من بيانات ثابتة إلى طبقة معرفة قابلة للتنقل. | High | lib/knowledge-engine/src/queries.ts |
| lib/knowledge-engine/src/inference.ts | استنتاجات مُشتقة من الـ graph: centrality (الكيانات الأكثر ارتباطاً)، clustering (تجميع الكيانات المتصلة). | heuristics بسيطة حالياً — مرشَّحة للتعميق لاحقاً. | يُضيف معرفة مُستنتجة فوق البيانات الخام. | High | lib/knowledge-engine/src/inference.ts |

### lib/ai-orchestrator (10)

| الملف | الموجود | الناقص | الأثر | الأولوية | الدليل |
|---|---|---|---|---|---|
| lib/ai-orchestrator/package.json | تعريف حزمة lib/ai-orchestrator؛ يعتمد على @workspace/db وdrizzle-orm وgroq-sdk. | لا نقص مستقل. | يُجمِّع اعتماديات طبقة الذكاء الاصطناعي. | Medium | lib/ai-orchestrator/package.json |
| lib/ai-orchestrator/tsconfig.json | إعداد TypeScript مع مرجع لـ lib/db. | لا نقص مستقل. | يضمن التحقق النوعي للحزمة. | Medium | lib/ai-orchestrator/tsconfig.json |
| lib/ai-orchestrator/src/index.ts | barrel export لكل الوكلاء والأنواع. | لا نقص مستقل. | مدخل موحد للمكتبة. | Medium | lib/ai-orchestrator/src/index.ts |
| lib/ai-orchestrator/src/groq-client.ts | wrapper حول groq-sdk: دالة `complete()` تأخذ messages+options وتُرجع GroqResponse؛ يُصنِّع client مرة واحدة (singleton) ويقرأ GROQ_API_KEY من process.env؛ يُصدِّر MODEL_POWERFUL (llama-3.3-70b-versatile) وMODEL_FAST (llama-3.1-8b-instant). | لا retry/exponential backoff حالياً. | البوابة الوحيدة لاستدعاء Groq في المنصة. | High | lib/ai-orchestrator/src/groq-client.ts |
| lib/ai-orchestrator/src/context-builder.ts | `buildProjectContext()`: يستعلم DB بالتوازي (projects, tasks, metrics, graph_entities, events) ويُرجع ProjectContext كسلاسل نصية جاهزة لـ system prompt. | لا caching — كل طلب يستعلم DB من جديد. | يُزوِّد الوكلاء بسياق حي للمشروع. | High | lib/ai-orchestrator/src/context-builder.ts |
| lib/ai-orchestrator/src/agents/chat-agent.ts | `chat()`: محادثة مع سياق المشروع الكامل؛ يُرسل آخر 10 رسائل كـ history؛ يُرجع JSON بحقلي `response` و`sources`. يستخدم MODEL_FAST. | لا streaming حالياً. | المحادثة التفاعلية مع المشروع. | High | lib/ai-orchestrator/src/agents/chat-agent.ts |
| lib/ai-orchestrator/src/agents/task-agent.ts | `executeTask()`: يُنفِّذ مهمة engineering عبر LLM ويُرجع TaskAgentOutput (summary, steps, result, confidence, needsHumanReview). يستخدم MODEL_POWERFUL. | لا وصول مباشر للملفات — يعتمد على السياق النصي فقط. | تنفيذ المهام عبر الذكاء الاصطناعي. | High | lib/ai-orchestrator/src/agents/task-agent.ts |
| lib/ai-orchestrator/src/agents/scan-analyst.ts | `analyzeScan()`: يُحلِّل المقاييس والـ graph وسجل المهام ويُنتج ScanAnalysisOutput (summary, insights[], topPriority, estimatedImpact). يستخدم MODEL_POWERFUL. | لا نقص مستقل. | تحليل نتائج الفحص وإنتاج توصيات عملية. | High | lib/ai-orchestrator/src/agents/scan-analyst.ts |
| lib/ai-orchestrator/src/agents/code-reviewer.ts | `reviewCode()`: مراجعة الكود مع دعم fileContents اختياري (حتى 5 ملفات × 1500 حرف)؛ يُرجع CodeReviewOutput (score, verdict, issues[], strengths[]). يستخدم MODEL_POWERFUL. | اقتطاع محتوى الملفات في 1500 حرف. | مراجعة الجودة بالذكاء الاصطناعي. | High | lib/ai-orchestrator/src/agents/code-reviewer.ts |
| lib/ai-orchestrator/src/agents/workflow-orchestrator.ts | `orchestrateWorkflow()`: يُقرِّر الخطوة التالية (advance/wait/fail/complete) بناءً على phases وcurrentPhase وcompletedPhases وسياق المشروع. يستخدم MODEL_POWERFUL. | لا يُنفِّذ القرار تلقائياً — يُرجعه فقط للـ API route لتطبيقه. | اتخاذ قرارات orchestration بالذكاء الاصطناعي. | High | lib/ai-orchestrator/src/agents/workflow-orchestrator.ts |

### artifacts/api-server (54)

| الملف | الموجود | الناقص | الأثر | الأولوية | الدليل |
|---|---|---|---|---|---|
| artifacts/api-server/.replit-artifact/artifact.toml | ملف backend داعم. | يُراجع حسب دوره المباشر. | يسهم في التنفيذ. | Medium | artifacts/api-server/.replit-artifact/artifact.toml |
| artifacts/api-server/build.mjs | ملف backend داعم. | يُراجع حسب دوره المباشر. | يسهم في التنفيذ. | Medium | artifacts/api-server/build.mjs |
| artifacts/api-server/package.json | ملف backend داعم. | يُراجع حسب دوره المباشر. | يسهم في التنفيذ. | Medium | artifacts/api-server/package.json |
| artifacts/api-server/src/app.ts | تهيئة Express وتسجيل الوسطاء والمسارات؛ Clerk proxy + `clerkMiddleware` + `requireAuth` على `/api/*` عدا `/api/healthz`؛ ETag معطَّل + Cache-Control no-store على `/api`؛ معالج مركزي للأخطاء (Zod→400، غير ذلك→500)؛ trust proxy=1 لـ rate limiting صحيح. التعليق الداخلي مُحدَّث (2026-07-14) ليعكس أن التفويض بالملكية مُطبَّق الآن على كل routes لا على projects.ts فقط. | يجب أن يبقى متسقًا مع routes الفعلية. | نواة الخادم. | High | artifacts/api-server/src/app.ts |
| artifacts/api-server/src/config.ts | تهيئة بيئة مركزية موثّقة بـ Zod (NODE_ENV, LOG_LEVEL) + `getPort()` كفحص كسول عند الإقلاع فقط. | مصدر الحقيقة الوحيد لقراءة process.env في هذه الحزمة؛ يحتاج توسيعًا إذا ظهرت متغيرات بيئة جديدة. | يمنع فشلًا متأخرًا وغامضًا بسبب متغيرات بيئة ناقصة/خاطئة. | Medium | artifacts/api-server/src/config.ts |
| artifacts/api-server/src/index.ts | نقطة تشغيل الخادم. | لا نقص مستقل ظاهر. | يشغّل API server. | High | artifacts/api-server/src/index.ts |
| artifacts/api-server/src/lib/audit.ts | مساعد audit للعمليات الحساسة؛ الأنواع AuditEntityType/AuditAction مشتقة من enum قاعدة البيانات مباشرة؛ الحقل `actor` يعود إلى "system" فقط عند غياب userId — كل مواقع الاستدعاء في routes تمرّر الآن `actor: req.userId` (مُحدَّث 2026-07-14). | best-effort وليس transaction-bound (متعمَّد: فشل audit لا يُسقط العملية الأصلية). | يوثق التغييرات المهمة برابط حقيقي للمستخدم المنفِّذ. | Medium | artifacts/api-server/src/lib/audit.ts |
| artifacts/api-server/src/lib/logger.ts | إعداد logging موحد. | يحتاج اتساقًا مع traceability الشاملة. | يسهل التتبع والتشخيص. | Medium | artifacts/api-server/src/lib/logger.ts |
| artifacts/api-server/src/lib/scan-runner.ts | pipeline كاملة: walk → match → graph → metrics → persist؛ يُستدعى الآن عبر `heavyJobQueue` بدل fire-and-forget مباشر (2026-07-11). كل الكتابات المشتقة (tasks، عدّادات القواعد، graph entities/relationships، metrics، حالة المشروع، audit، event) داخل معاملة DB واحدة؛ `runScanJob` الخارجي يضمن وسم الـ job failed وإعادة المشروع إلى active حتى عند رمي منتصف الفحص. | أصبح all-or-nothing؛ لا يحتفظ بنتائج جزئية عند الفشل. اختبار واحد لسيناريو الفشل منتصف الفحص يفشل عند تشغيله منفردًا فقط (سباق توقيت موجود مسبقًا، غير ناتج عن هذه الجلسة). | يضمن سلامة تشغيل الفحص. | High | artifacts/api-server/src/lib/scan-runner.ts |
| artifacts/api-server/src/lib/job-queue.ts | queue بسيط داخل العملية بسقف تزامن (2) مشترك بين scan وdiscovery jobs؛ اختبارات وحدة تثبت الحد وعدم توقف الطابور عند رمي job لخطأ. | لا backpressure (رفض الطلبات الزائدة)؛ الطابور غير محدود الحجم في الذاكرة. | يمنع burst من طلبات scan/discovery من إنهاك event loop. | High | artifacts/api-server/src/lib/job-queue.ts |
| artifacts/api-server/src/lib/job-reconciliation.ts | يفحص عند إقلاع الخادم أي scan_jobs/discovery_sessions عالقة في queued/running/discovering ويوسمها failed/error، ويعيد أي مشروع عالق في scanning إلى active؛ يُسجّل الآن (2026-07-14) job IDs وproject IDs وsession IDs الفعلية في رسائل التحذير، لا مجرد العدد — مما يُمكّن التتبع المباشر دون استعلام DB. | لا resume تلقائي (فقط fail-clearly). | يمنع بقاء jobs/مشاريع في حالة غير نهائية بعد crash وإعادة التشغيل. | High | artifacts/api-server/src/lib/job-reconciliation.ts |
| artifacts/api-server/src/middlewares/clerkProxyMiddleware.ts | يمرر Clerk Frontend API عبر نفس الدومين في الإنتاج فقط (no-op في dev). | لا نقص مستقل ظاهر. | يمكّن custom domains بدون DNS إضافي. | Medium | artifacts/api-server/src/middlewares/clerkProxyMiddleware.ts |
| artifacts/api-server/src/middlewares/requireAuth.ts | يفرض جلسة Clerk صالحة على أي route محمي، ويبني `req.authContext` موحّدًا (`userId`, `sessionId`, `orgId`, `isAuthenticated`) بدل حقول متفرقة؛ يصدّر أيضًا `optionalAuth` (لا يرفض الطلب، يُرفق authContext فقط إن وُجدت جلسة). يتجاوَز في `NODE_ENV=test` بمستخدم synthetic ثابت (نفس شكل authContext) لأن اختبارات supertest لا تحمل كوكي جلسة متصفح. اختُبر (2026-07-14) عبر mocking لـ `@clerk/express`/`config.ts` مع `vi.resetModules` لتغطية الفروع الحقيقية التي يستحيل الوصول إليها بينما NODE_ENV=test ثابتة طوال تشغيل vitest. | لا تمييز أدوار (roles) بعد داخل نفس المستخدم — التفويض الحالي هو ملكية مشروع فردية عبر `requireProjectAccess`، وليس RBAC. `optionalAuth` غير مستهلك من أي route بعد (سطح جاهز لروابط عامة/معاينة مستقبلية). | بوابة المصادقة (من أنت)، منفصلة الآن عن بوابة التفويض (هل تملك هذا المورد)، وموحّدة الشكل لكل مستهلك. | High | artifacts/api-server/src/middlewares/requireAuth.ts |
| artifacts/api-server/src/middlewares/requireProjectAccess.ts | وسيط تفويض موسَّع (2026-07-14): يُصدِّر ثلاثة رموز — (1) `requireProjectAccess`: وسيط للقراءة يقرأ `:projectId` من params؛ (2) `requireProjectWriteAccess`: alias للكتابة (نفس المنطق حالياً، اسم مستقل استعداداً لـ RBAC)؛ (3) `loadProjectByIdForUser(projectId, userId, res)`: دالة مساعدة مُصدَّرة للـ routes التي يأتي فيها projectId من query/body لا من المسار (tasks, rules, workflows, events, metrics, graph, ai) — تعيد الـ project row عند النجاح، أو تكتب 400/404/403 وتعيد undefined ليتحقق المُستدعي بـ `if (!project) return`. الاصطلاح: 404 إن لم يوجد المشروع (لا تأكيد للوجود لغير المالك)، 403 إن وُجد ولم يكن مملوكًا. | القراءة/الكتابة متطابقتان منطقيًا حتى الآن (لا يوجد دور "مُشاهد"). توسيع RBAC المستقبلي لا يحتاج مراجعة كل route — التسمية جاهزة. | نقطة تحكم مركزية في التفويض — كل route تمر من هنا أو من `loadProjectByIdForUser`. | High | artifacts/api-server/src/middlewares/requireProjectAccess.ts |
| artifacts/api-server/src/middlewares/requireAuth.test.ts | ملف جديد (2026-07-14): اختبارات وحدة لـ requireAuth/optionalAuth عبر mocking لـ `@clerk/express` و`../config.js` مع `vi.resetModules` بين كل حالة — الطريقة الوحيدة لتمرين الفروع الحقيقية (401 لغياب الجلسة، شكل authContext الكامل) لأن NODE_ENV=test يفرض مسار bypass طوال تشغيل vitest. | لا نقص مستقل ظاهر. | يحمي من regressions في شكل authContext وسلوك 401/optionalAuth. | Medium | artifacts/api-server/src/middlewares/requireAuth.test.ts |
| artifacts/api-server/src/types/express.d.ts | يوسّع `Express.Request` عالميًا بـ `userId` و`authContext?: AuthContext` (موحّد: userId/sessionId/orgId/isAuthenticated، من requireAuth/optionalAuth، مصادقة) و`project?` (من requireProjectAccess/requireProjectWriteAccess، تفويض) بدل casts محلية في كل route. وسِّع (2026-07-14) لإضافة `AuthContext` وربط requireAuth به. | نقطة توسّع موثّقة داخل الملف لاحقًا لـ role/permissions أو organization/team عند تجاوز نموذج الملكية الفردية. | يفصل بوضوح نوعيًا بين "من أنت" و"هل تملك هذا المورد" لكل route handler، بشكل موحّد لكل مستهلك. | Medium | artifacts/api-server/src/types/express.d.ts |
| artifacts/api-server/src/routes/dashboard.ts | endpoint لبيانات dashboard العامة. | قد يحتاج اتساعًا حسب ما تعرضه الواجهة. | يغذي الصفحة الرئيسية. | Medium | artifacts/api-server/src/routes/dashboard.ts |
| artifacts/api-server/src/routes/discovery.test.ts | اختبارات endpoints وسلوك الخادم. | تحتاج توسيعًا في العقد والجراف وworkflow phases. | تحمي من regressions. | Medium | artifacts/api-server/src/routes/discovery.test.ts |
| artifacts/api-server/src/routes/discovery.ts | إدارة discovery/import وخطواته؛ `graphSummary` الآن يتضمن `entitiesByType`/`filesByLanguage` (تفصيل حسب النوع/اللغة) بدل عدّين إجماليين فقط. | حواف الفشل الجزئي تحتاج ربطًا دائمًا بالاختبارات. | يدخل المشاريع إلى المنصة. | High | artifacts/api-server/src/routes/discovery.ts |
| artifacts/api-server/src/routes/events.ts | قراءة/تصفية الأحداث. | يحتاج مواءمة أقوى مع التتبع الموحد. | يعرض سجل التشغيل. | Medium | artifacts/api-server/src/routes/events.ts |
| artifacts/api-server/src/routes/graph.ts | إدارة entities/relationships وneighbors. | neighbors أصبح منعكسًا في OpenAPI والواجهة (2026-07-10)؛ التخطيط لا يزال pseudo-layout وليس force-directed حقيقيًا. | طبقة المعرفة. | High | artifacts/api-server/src/routes/graph.ts |
| artifacts/api-server/src/routes/health.ts | فحص صحة الخدمة. | لا نقص مستقل ظاهر. | يعطي readiness سريع. | Low | artifacts/api-server/src/routes/health.ts |
| artifacts/api-server/src/routes/index.ts | نقطة تشغيل الخادم. | لا نقص مستقل ظاهر. | يشغّل API server. | High | artifacts/api-server/src/routes/index.ts |
| artifacts/api-server/src/routes/metrics.ts | قراءة المقاييس. | يحتاج ربطًا أوضح مع العمليات الأساسية. | يعرض صحة النظام. | Medium | artifacts/api-server/src/routes/metrics.ts |
| artifacts/api-server/src/routes/plugins.ts | إدارة الإضافات. | يتطلب ضبطًا أدق للحياة التشغيلية. | يسمح بالتوسعة. | Medium | artifacts/api-server/src/routes/plugins.ts |
| artifacts/api-server/src/routes/projects.test.ts | اختبارات endpoints وسلوك الخادم. | تحتاج توسيعًا في العقد والجراف وworkflow phases. | تحمي من regressions. | Medium | artifacts/api-server/src/routes/projects.test.ts |
| artifacts/api-server/src/routes/projects.ts | CRUD وإدارة المشاريع؛ `ownerId` يُختم من جلسة Clerk عند الإنشاء/الاستيراد، `GET /projects` يعرض مشاريع المستخدم الحالي فقط. القراءة (`GET :projectId`, `GET summary`, `GET scan-jobs/:jobId`) محمية بـ `requireProjectAccess`؛ الكتابة (`PATCH`, `DELETE`, `POST scan`) محمية بـ `requireProjectWriteAccess` (2026-07-14 — نفس المنطق حاليًا، أسماء منفصلة استعدادًا لتفريق مستقبلي). عمليات الإنشاء/التعديل/الحذف تولّد `correlationId` جديدًا يربط سجل audit بسجل event لنفس الطلب؛ حدث scan-queued يستخدم `jobId` نفسه كـ correlationId. | يحتاج اتساقًا تامًا مع schema والـ audit. | مدخل البيانات الأساسية وبوابة التفويض بالملكية الوحيدة حاليًا. | High | artifacts/api-server/src/routes/projects.ts |
| artifacts/api-server/src/routes/rules.ts | CRUD/تقييم القواعد. | يحتاج مزيدًا من اختبارات التكامل. | يحكم سياسة الفحص. | High | artifacts/api-server/src/routes/rules.ts |
| artifacts/api-server/src/routes/tasks.ts | إدارة tasks مع execute/retry/rollback. | لا يوجد saga عبر مهام متعددة. | محور التنفيذ. | High | artifacts/api-server/src/routes/tasks.ts |
| artifacts/api-server/src/routes/workflows.test.ts | اختبارات endpoints وسلوك الخادم، بما فيها advance/fail-phase/retry-phase. | لا نقص مستقل ظاهر. | تحمي من regressions. | Medium | artifacts/api-server/src/routes/workflows.test.ts |
| artifacts/api-server/src/routes/graph.test.ts | اختبارات neighbors (outgoing/incoming، عزلة، 404). | لا نقص مستقل ظاهر. | تحمي من regressions. | Medium | artifacts/api-server/src/routes/graph.test.ts |
| artifacts/api-server/src/routes/tasks.test.ts | اختبارات دورة حياة المهام (execute/retry/rollback). | لا نقص مستقل ظاهر. | تحمي من regressions. | Medium | artifacts/api-server/src/routes/tasks.test.ts |
| artifacts/api-server/src/routes/plugins.test.ts | اختبارات تفعيل/تعطيل الإضافات. | لا نقص مستقل ظاهر. | تحمي من regressions. | Medium | artifacts/api-server/src/routes/plugins.test.ts |
| artifacts/api-server/src/routes/metrics.test.ts | اختبارات ترتيب السلاسل الزمنية وأحدث قيمة لكل مشروع. | لا نقص مستقل ظاهر. | تحمي من regressions. | Medium | artifacts/api-server/src/routes/metrics.test.ts |
| artifacts/api-server/src/routes/workflows.ts | إدارة workflows مع advance/fail-phase/retry-phase (أصبحت الثلاثة منعكسة في OpenAPI/الواجهة، 2026-07-10). | condition branching غير مفعّل. | محرك orchestration. | High | artifacts/api-server/src/routes/workflows.ts |
| artifacts/api-server/src/routes/ai.ts | 7 endpoints تحت `/api/ai/*`: chat (POST + sessions GET + messages GET)، analyze (POST)، review (POST)، orchestrate (POST)، task execute (POST)؛ يستورد من @workspace/ai-orchestrator؛ يُسجِّل أحداثاً في events table ويستدعي recordAudit. | لا اختبارات بعد. | بوابة الذكاء الاصطناعي للمنصة. | High | artifacts/api-server/src/routes/ai.ts |
| artifacts/api-server/tsconfig.json | ملف backend داعم. | يُراجع حسب دوره المباشر. | يسهم في التنفيذ. | Medium | artifacts/api-server/tsconfig.json |
| artifacts/api-server/vitest.config.ts | ملف إعداد/بناء للحزمة. | لا نقص مستقل ظاهر. | يدعم البناء والتشغيل. | Medium | artifacts/api-server/vitest.config.ts |
| artifacts/api-server/src/lib/credentials-crypto.ts | تشفير/فك تشفير مفاتيح Groq per-user بـ AES-256-GCM؛ يستخدم SESSION_SECRET كمفتاح اشتقاق؛ لا يعيد المفتاح الخام أبدًا (2026-07-15). | SESSION_SECRET يجب أن يبقى مضبوطًا وثابتًا أو تُفقد المفاتيح المشفرة. | يمكّن تخزين credentials شخصية بأمان دون قاعدة بيانات مفاتيح مستقلة. | High | artifacts/api-server/src/lib/credentials-crypto.ts |
| artifacts/api-server/src/lib/discovery-adapters.ts | نمط SourceAdapter مع registry مُنظَّم: 6 أنواع مصادر (github, gitlab, local, zip, url, workspace)؛ كل adapter يُعرِّف resolve/validate/clone؛ يُستدعى من route discovery بدل switch ضخم (2026-07-15). | إضافة مصدر جديد تستلزم إدخالًا واحدًا في ADAPTERS فقط. | يوحّد منطق اكتشاف المصادر ويقضي على التكرار. | High | artifacts/api-server/src/lib/discovery-adapters.ts |
| artifacts/api-server/src/lib/discovery-adapters.test.ts | اختبارات وحدة لـ discovery adapter registry (2026-07-15). | لا نقص مستقل ظاهر. | تحمي من regressions في منطق الاكتشاف. | Medium | artifacts/api-server/src/lib/discovery-adapters.test.ts |
| artifacts/api-server/src/lib/job-queue.test.ts | اختبارات وحدة للـ in-process job queue: الحد، سلوك overflow، معالجة أخطاء الـ job (2026-07-15). | لا نقص مستقل ظاهر. | تحمي ضمانات bounded concurrency. | Medium | artifacts/api-server/src/lib/job-queue.test.ts |
| artifacts/api-server/src/lib/job-reconciliation.test.ts | اختبارات وحدة لـ startup reconciliation: يتحقق من وسم الـ jobs العالقة failed وإعادة المشاريع إلى active (2026-07-15). | لا نقص مستقل ظاهر. | تحمي من regressions في دورة حياة الـ jobs. | Medium | artifacts/api-server/src/lib/job-reconciliation.test.ts |
| artifacts/api-server/src/lib/path-validation.ts | دالتا validateRootPath (تتحقق من صحة مسار المشروع) وverifyProjectRoot (تتحقق من وجود المجلد فعليًا)؛ يستخدمهما discovery pipeline لمنع مسارات مشبوهة (2026-07-15). | يجب توسيعهما إذا دُعمت أنواع مصادر إضافية تملك تسطيح مسارات مختلف. | يمنع injection عبر مسارات غير صالحة أو غير موجودة. | High | artifacts/api-server/src/lib/path-validation.ts |
| artifacts/api-server/src/lib/path-validation.test.ts | اختبارات وحدة لـ path validation (2026-07-15). | لا نقص مستقل ظاهر. | تحمي من regressions في التحقق من مسارات المشاريع. | Medium | artifacts/api-server/src/lib/path-validation.test.ts |
| artifacts/api-server/src/lib/plugin-runtime.ts | 6 plugins قياسية (React, Node, Security, Performance, Accessibility, TypeScript) يُشغَّلها في العملية بعد كل scan؛ dispatched من scan-runner عبر dispatchOnScanComplete (2026-07-15). | إضافة plugin تستلزم تعريف handler وتسجيله في الـ registry. | يضخّ تحليلًا إضافيًا في كل scan دون تغيير pipeline الأساسية. | High | artifacts/api-server/src/lib/plugin-runtime.ts |
| artifacts/api-server/src/lib/plugin-runtime.test.ts | 14 اختبار وحدة لـ plugin runtime: تغطي التفعيل، التعطيل، تسجيل plugins، وسلوك الخطأ (2026-07-15). | لا نقص مستقل ظاهر. | تحمي من regressions في نظام الـ plugins. | Medium | artifacts/api-server/src/lib/plugin-runtime.test.ts |
| artifacts/api-server/src/lib/project-error.test.ts | اختبارات وحدة لـ project error classification (2026-07-15). | لا نقص مستقل ظاهر. | تحمي تصنيف الأخطاء من regressions. | Medium | artifacts/api-server/src/lib/project-error.test.ts |
| artifacts/api-server/src/routes/ai.test.ts | smoke tests لـ AI endpoints: chat, analyze, review, orchestrate, execute (NODE_ENV=test bypass) (2026-07-15). | تغطية محدودة نسبيًا — توسّع عند إضافة streaming. | تحمي بوابة AI من regressions. | Medium | artifacts/api-server/src/routes/ai.test.ts |
| artifacts/api-server/src/routes/dashboard.test.ts | اختبارات dashboard route (2026-07-15). | لا نقص مستقل ظاهر. | تحمي من regressions في بيانات الـ dashboard. | Medium | artifacts/api-server/src/routes/dashboard.test.ts |
| artifacts/api-server/src/routes/events.test.ts | اختبارات events route: create, list with projectId filter, correlationId filter (2026-07-15). | لا نقص مستقل ظاهر. | تحمي من regressions في سجل الأحداث. | Medium | artifacts/api-server/src/routes/events.test.ts |
| artifacts/api-server/src/routes/health.test.ts | اختبار بسيط: GET /api/healthz يعيد 200 بدون auth (2026-07-15). | لا نقص مستقل ظاهر. | يثبت أن health check لا يتطلب مصادقة. | Low | artifacts/api-server/src/routes/health.test.ts |
| artifacts/api-server/src/routes/rules.test.ts | اختبارات rules route: CRUD + evaluate (2026-07-15). | لا نقص مستقل ظاهر. | تحمي محرك القواعد من regressions. | Medium | artifacts/api-server/src/routes/rules.test.ts |
| artifacts/api-server/src/scripts/seed-provenance.ts | pipeline استيراد provenance: يقرأ ملفات JSON من attached_assets ويُدخل 459 entity و4,231 relationship في قاعدة البيانات؛ يستخدم upsert لأمان التشغيل المتكرر (2026-07-15). | يحتاج versioning ومقارنة seed/linked/current snapshots للكشف عن drift. | يُهجّر سجل provenance التاريخي إلى داخل المنصة. | High | artifacts/api-server/src/scripts/seed-provenance.ts |

### artifacts/dashboard (87)

| الملف | الموجود | الناقص | الأثر | الأولوية | الدليل |
|---|---|---|---|---|---|
| artifacts/dashboard/.replit-artifact/artifact.toml | ملف واجهة داعم. | يُراجع حسب الاستهلاك. | يسهم في التجربة البصرية. | Low | artifacts/dashboard/.replit-artifact/artifact.toml |
| artifacts/dashboard/components.json | ملف واجهة داعم. | يُراجع حسب الاستهلاك. | يسهم في التجربة البصرية. | Low | artifacts/dashboard/components.json |
| artifacts/dashboard/index.html | ملف واجهة داعم. | يُراجع حسب الاستهلاك. | يسهم في التجربة البصرية. | Low | artifacts/dashboard/index.html |
| artifacts/dashboard/package.json | ملف واجهة داعم. | يُراجع حسب الاستهلاك. | يسهم في التجربة البصرية. | Low | artifacts/dashboard/package.json |
| artifacts/dashboard/public/favicon.svg | ملف واجهة داعم. | يُراجع حسب الاستهلاك. | يسهم في التجربة البصرية. | Low | artifacts/dashboard/public/favicon.svg |
| artifacts/dashboard/public/logo.svg | شعار مخصص يُستخدم في صفحات Clerk (sign-in/sign-up) والـ landing page. | لا نقص مستقل ظاهر. | يمنع ظهور صفحات Clerk الافتراضية غير المصممة. | Low | artifacts/dashboard/public/logo.svg |
| artifacts/dashboard/public/robots.txt | ملف واجهة داعم. | يُراجع حسب الاستهلاك. | يسهم في التجربة البصرية. | Low | artifacts/dashboard/public/robots.txt |
| artifacts/dashboard/src/App.tsx | يضم `ClerkProvider` وتوجيه wouter؛ `/` عام (landing لغير المسجّلين، dashboard للمسجّلين)، وباقي الصفحات محمية وتُعيد التوجيه لـ `/` عند تسجيل الخروج (2026-07-11). | لا نقص مستقل ظاهر. | نقطة الدخول لكامل الواجهة وبوابتها للمصادقة. | High | artifacts/dashboard/src/App.tsx |
| artifacts/dashboard/src/components/layout/Shell.tsx | مكوّن تخطيط عام. | مرتبط باستقرار التنقل. | يحكم shell العام. | Medium | artifacts/dashboard/src/components/layout/Shell.tsx |
| artifacts/dashboard/src/components/layout/Sidebar.tsx | مكوّن تخطيط عام. | مرتبط باستقرار التنقل. | يحكم shell العام. | Medium | artifacts/dashboard/src/components/layout/Sidebar.tsx |
| artifacts/dashboard/src/components/ui/accordion.tsx | Primitive UI component reusable داخل النظام. | ليس منطقًا محصولًا؛ يعتمد على الاستهلاك الصحيح. | يوحّد لغة الواجهة. | Low | artifacts/dashboard/src/components/ui/accordion.tsx |
| artifacts/dashboard/src/components/ui/alert-dialog.tsx | Primitive UI component reusable داخل النظام. | ليس منطقًا محصولًا؛ يعتمد على الاستهلاك الصحيح. | يوحّد لغة الواجهة. | Low | artifacts/dashboard/src/components/ui/alert-dialog.tsx |
| artifacts/dashboard/src/components/ui/alert.tsx | Primitive UI component reusable داخل النظام. | ليس منطقًا محصولًا؛ يعتمد على الاستهلاك الصحيح. | يوحّد لغة الواجهة. | Low | artifacts/dashboard/src/components/ui/alert.tsx |
| artifacts/dashboard/src/components/ui/aspect-ratio.tsx | Primitive UI component reusable داخل النظام. | ليس منطقًا محصولًا؛ يعتمد على الاستهلاك الصحيح. | يوحّد لغة الواجهة. | Low | artifacts/dashboard/src/components/ui/aspect-ratio.tsx |
| artifacts/dashboard/src/components/ui/avatar.tsx | Primitive UI component reusable داخل النظام. | ليس منطقًا محصولًا؛ يعتمد على الاستهلاك الصحيح. | يوحّد لغة الواجهة. | Low | artifacts/dashboard/src/components/ui/avatar.tsx |
| artifacts/dashboard/src/components/ui/badge.tsx | Primitive UI component reusable داخل النظام. | ليس منطقًا محصولًا؛ يعتمد على الاستهلاك الصحيح. | يوحّد لغة الواجهة. | Low | artifacts/dashboard/src/components/ui/badge.tsx |
| artifacts/dashboard/src/components/ui/breadcrumb.tsx | Primitive UI component reusable داخل النظام. | ليس منطقًا محصولًا؛ يعتمد على الاستهلاك الصحيح. | يوحّد لغة الواجهة. | Low | artifacts/dashboard/src/components/ui/breadcrumb.tsx |
| artifacts/dashboard/src/components/ui/button-group.tsx | Primitive UI component reusable داخل النظام. | ليس منطقًا محصولًا؛ يعتمد على الاستهلاك الصحيح. | يوحّد لغة الواجهة. | Low | artifacts/dashboard/src/components/ui/button-group.tsx |
| artifacts/dashboard/src/components/ui/button.tsx | Primitive UI component reusable داخل النظام. | ليس منطقًا محصولًا؛ يعتمد على الاستهلاك الصحيح. | يوحّد لغة الواجهة. | Low | artifacts/dashboard/src/components/ui/button.tsx |
| artifacts/dashboard/src/components/ui/calendar.tsx | Primitive UI component reusable داخل النظام. | ليس منطقًا محصولًا؛ يعتمد على الاستهلاك الصحيح. | يوحّد لغة الواجهة. | Low | artifacts/dashboard/src/components/ui/calendar.tsx |
| artifacts/dashboard/src/components/ui/card.tsx | Primitive UI component reusable داخل النظام. | ليس منطقًا محصولًا؛ يعتمد على الاستهلاك الصحيح. | يوحّد لغة الواجهة. | Low | artifacts/dashboard/src/components/ui/card.tsx |
| artifacts/dashboard/src/components/ui/carousel.tsx | Primitive UI component reusable داخل النظام. | ليس منطقًا محصولًا؛ يعتمد على الاستهلاك الصحيح. | يوحّد لغة الواجهة. | Low | artifacts/dashboard/src/components/ui/carousel.tsx |
| artifacts/dashboard/src/components/ui/chart.tsx | Primitive UI component reusable داخل النظام. | ليس منطقًا محصولًا؛ يعتمد على الاستهلاك الصحيح. | يوحّد لغة الواجهة. | Low | artifacts/dashboard/src/components/ui/chart.tsx |
| artifacts/dashboard/src/components/ui/checkbox.tsx | Primitive UI component reusable داخل النظام. | ليس منطقًا محصولًا؛ يعتمد على الاستهلاك الصحيح. | يوحّد لغة الواجهة. | Low | artifacts/dashboard/src/components/ui/checkbox.tsx |
| artifacts/dashboard/src/components/ui/collapsible.tsx | Primitive UI component reusable داخل النظام. | ليس منطقًا محصولًا؛ يعتمد على الاستهلاك الصحيح. | يوحّد لغة الواجهة. | Low | artifacts/dashboard/src/components/ui/collapsible.tsx |
| artifacts/dashboard/src/components/ui/command.tsx | Primitive UI component reusable داخل النظام. | ليس منطقًا محصولًا؛ يعتمد على الاستهلاك الصحيح. | يوحّد لغة الواجهة. | Low | artifacts/dashboard/src/components/ui/command.tsx |
| artifacts/dashboard/src/components/ui/context-menu.tsx | Primitive UI component reusable داخل النظام. | ليس منطقًا محصولًا؛ يعتمد على الاستهلاك الصحيح. | يوحّد لغة الواجهة. | Low | artifacts/dashboard/src/components/ui/context-menu.tsx |
| artifacts/dashboard/src/components/ui/dialog.tsx | Primitive UI component reusable داخل النظام. | ليس منطقًا محصولًا؛ يعتمد على الاستهلاك الصحيح. | يوحّد لغة الواجهة. | Low | artifacts/dashboard/src/components/ui/dialog.tsx |
| artifacts/dashboard/src/components/ui/drawer.tsx | Primitive UI component reusable داخل النظام. | ليس منطقًا محصولًا؛ يعتمد على الاستهلاك الصحيح. | يوحّد لغة الواجهة. | Low | artifacts/dashboard/src/components/ui/drawer.tsx |
| artifacts/dashboard/src/components/ui/dropdown-menu.tsx | Primitive UI component reusable داخل النظام. | ليس منطقًا محصولًا؛ يعتمد على الاستهلاك الصحيح. | يوحّد لغة الواجهة. | Low | artifacts/dashboard/src/components/ui/dropdown-menu.tsx |
| artifacts/dashboard/src/components/ui/empty.tsx | Primitive UI component reusable داخل النظام. | ليس منطقًا محصولًا؛ يعتمد على الاستهلاك الصحيح. | يوحّد لغة الواجهة. | Low | artifacts/dashboard/src/components/ui/empty.tsx |
| artifacts/dashboard/src/components/ui/field.tsx | Primitive UI component reusable داخل النظام. | ليس منطقًا محصولًا؛ يعتمد على الاستهلاك الصحيح. | يوحّد لغة الواجهة. | Low | artifacts/dashboard/src/components/ui/field.tsx |
| artifacts/dashboard/src/components/ui/form.tsx | Primitive UI component reusable داخل النظام. | ليس منطقًا محصولًا؛ يعتمد على الاستهلاك الصحيح. | يوحّد لغة الواجهة. | Low | artifacts/dashboard/src/components/ui/form.tsx |
| artifacts/dashboard/src/components/ui/hover-card.tsx | Primitive UI component reusable داخل النظام. | ليس منطقًا محصولًا؛ يعتمد على الاستهلاك الصحيح. | يوحّد لغة الواجهة. | Low | artifacts/dashboard/src/components/ui/hover-card.tsx |
| artifacts/dashboard/src/components/ui/input-group.tsx | Primitive UI component reusable داخل النظام. | ليس منطقًا محصولًا؛ يعتمد على الاستهلاك الصحيح. | يوحّد لغة الواجهة. | Low | artifacts/dashboard/src/components/ui/input-group.tsx |
| artifacts/dashboard/src/components/ui/input-otp.tsx | Primitive UI component reusable داخل النظام. | ليس منطقًا محصولًا؛ يعتمد على الاستهلاك الصحيح. | يوحّد لغة الواجهة. | Low | artifacts/dashboard/src/components/ui/input-otp.tsx |
| artifacts/dashboard/src/components/ui/input.tsx | Primitive UI component reusable داخل النظام. | ليس منطقًا محصولًا؛ يعتمد على الاستهلاك الصحيح. | يوحّد لغة الواجهة. | Low | artifacts/dashboard/src/components/ui/input.tsx |
| artifacts/dashboard/src/components/ui/item.tsx | Primitive UI component reusable داخل النظام. | ليس منطقًا محصولًا؛ يعتمد على الاستهلاك الصحيح. | يوحّد لغة الواجهة. | Low | artifacts/dashboard/src/components/ui/item.tsx |
| artifacts/dashboard/src/components/ui/kbd.tsx | Primitive UI component reusable داخل النظام. | ليس منطقًا محصولًا؛ يعتمد على الاستهلاك الصحيح. | يوحّد لغة الواجهة. | Low | artifacts/dashboard/src/components/ui/kbd.tsx |
| artifacts/dashboard/src/components/ui/label.tsx | Primitive UI component reusable داخل النظام. | ليس منطقًا محصولًا؛ يعتمد على الاستهلاك الصحيح. | يوحّد لغة الواجهة. | Low | artifacts/dashboard/src/components/ui/label.tsx |
| artifacts/dashboard/src/components/ui/menubar.tsx | Primitive UI component reusable داخل النظام. | ليس منطقًا محصولًا؛ يعتمد على الاستهلاك الصحيح. | يوحّد لغة الواجهة. | Low | artifacts/dashboard/src/components/ui/menubar.tsx |
| artifacts/dashboard/src/components/ui/navigation-menu.tsx | Primitive UI component reusable داخل النظام. | ليس منطقًا محصولًا؛ يعتمد على الاستهلاك الصحيح. | يوحّد لغة الواجهة. | Low | artifacts/dashboard/src/components/ui/navigation-menu.tsx |
| artifacts/dashboard/src/components/ui/pagination.tsx | Primitive UI component reusable داخل النظام. | ليس منطقًا محصولًا؛ يعتمد على الاستهلاك الصحيح. | يوحّد لغة الواجهة. | Low | artifacts/dashboard/src/components/ui/pagination.tsx |
| artifacts/dashboard/src/components/ui/popover.tsx | Primitive UI component reusable داخل النظام. | ليس منطقًا محصولًا؛ يعتمد على الاستهلاك الصحيح. | يوحّد لغة الواجهة. | Low | artifacts/dashboard/src/components/ui/popover.tsx |
| artifacts/dashboard/src/components/ui/progress.tsx | Primitive UI component reusable داخل النظام. | ليس منطقًا محصولًا؛ يعتمد على الاستهلاك الصحيح. | يوحّد لغة الواجهة. | Low | artifacts/dashboard/src/components/ui/progress.tsx |
| artifacts/dashboard/src/components/ui/radio-group.tsx | Primitive UI component reusable داخل النظام. | ليس منطقًا محصولًا؛ يعتمد على الاستهلاك الصحيح. | يوحّد لغة الواجهة. | Low | artifacts/dashboard/src/components/ui/radio-group.tsx |
| artifacts/dashboard/src/components/ui/resizable.tsx | Primitive UI component reusable داخل النظام. | ليس منطقًا محصولًا؛ يعتمد على الاستهلاك الصحيح. | يوحّد لغة الواجهة. | Low | artifacts/dashboard/src/components/ui/resizable.tsx |
| artifacts/dashboard/src/components/ui/scroll-area.tsx | Primitive UI component reusable داخل النظام. | ليس منطقًا محصولًا؛ يعتمد على الاستهلاك الصحيح. | يوحّد لغة الواجهة. | Low | artifacts/dashboard/src/components/ui/scroll-area.tsx |
| artifacts/dashboard/src/components/ui/select.tsx | Primitive UI component reusable داخل النظام. | ليس منطقًا محصولًا؛ يعتمد على الاستهلاك الصحيح. | يوحّد لغة الواجهة. | Low | artifacts/dashboard/src/components/ui/select.tsx |
| artifacts/dashboard/src/components/ui/separator.tsx | Primitive UI component reusable داخل النظام. | ليس منطقًا محصولًا؛ يعتمد على الاستهلاك الصحيح. | يوحّد لغة الواجهة. | Low | artifacts/dashboard/src/components/ui/separator.tsx |
| artifacts/dashboard/src/components/ui/sheet.tsx | Primitive UI component reusable داخل النظام. | ليس منطقًا محصولًا؛ يعتمد على الاستهلاك الصحيح. | يوحّد لغة الواجهة. | Low | artifacts/dashboard/src/components/ui/sheet.tsx |
| artifacts/dashboard/src/components/ui/sidebar.tsx | Primitive UI component reusable داخل النظام. | ليس منطقًا محصولًا؛ يعتمد على الاستهلاك الصحيح. | يوحّد لغة الواجهة. | Low | artifacts/dashboard/src/components/ui/sidebar.tsx |
| artifacts/dashboard/src/components/ui/skeleton.tsx | Primitive UI component reusable داخل النظام. | ليس منطقًا محصولًا؛ يعتمد على الاستهلاك الصحيح. | يوحّد لغة الواجهة. | Low | artifacts/dashboard/src/components/ui/skeleton.tsx |
| artifacts/dashboard/src/components/ui/slider.tsx | Primitive UI component reusable داخل النظام. | ليس منطقًا محصولًا؛ يعتمد على الاستهلاك الصحيح. | يوحّد لغة الواجهة. | Low | artifacts/dashboard/src/components/ui/slider.tsx |
| artifacts/dashboard/src/components/ui/sonner.tsx | Primitive UI component reusable داخل النظام. | ليس منطقًا محصولًا؛ يعتمد على الاستهلاك الصحيح. | يوحّد لغة الواجهة. | Low | artifacts/dashboard/src/components/ui/sonner.tsx |
| artifacts/dashboard/src/components/ui/spinner.tsx | Primitive UI component reusable داخل النظام. | ليس منطقًا محصولًا؛ يعتمد على الاستهلاك الصحيح. | يوحّد لغة الواجهة. | Low | artifacts/dashboard/src/components/ui/spinner.tsx |
| artifacts/dashboard/src/components/ui/switch.tsx | Primitive UI component reusable داخل النظام. | ليس منطقًا محصولًا؛ يعتمد على الاستهلاك الصحيح. | يوحّد لغة الواجهة. | Low | artifacts/dashboard/src/components/ui/switch.tsx |
| artifacts/dashboard/src/components/ui/table.tsx | Primitive UI component reusable داخل النظام. | ليس منطقًا محصولًا؛ يعتمد على الاستهلاك الصحيح. | يوحّد لغة الواجهة. | Low | artifacts/dashboard/src/components/ui/table.tsx |
| artifacts/dashboard/src/components/ui/tabs.tsx | Primitive UI component reusable داخل النظام. | ليس منطقًا محصولًا؛ يعتمد على الاستهلاك الصحيح. | يوحّد لغة الواجهة. | Low | artifacts/dashboard/src/components/ui/tabs.tsx |
| artifacts/dashboard/src/components/ui/textarea.tsx | Primitive UI component reusable داخل النظام. | ليس منطقًا محصولًا؛ يعتمد على الاستهلاك الصحيح. | يوحّد لغة الواجهة. | Low | artifacts/dashboard/src/components/ui/textarea.tsx |
| artifacts/dashboard/src/components/ui/toast.tsx | Primitive UI component reusable داخل النظام. | ليس منطقًا محصولًا؛ يعتمد على الاستهلاك الصحيح. | يوحّد لغة الواجهة. | Low | artifacts/dashboard/src/components/ui/toast.tsx |
| artifacts/dashboard/src/components/ui/toaster.tsx | Primitive UI component reusable داخل النظام. | ليس منطقًا محصولًا؛ يعتمد على الاستهلاك الصحيح. | يوحّد لغة الواجهة. | Low | artifacts/dashboard/src/components/ui/toaster.tsx |
| artifacts/dashboard/src/components/ui/toggle-group.tsx | Primitive UI component reusable داخل النظام. | ليس منطقًا محصولًا؛ يعتمد على الاستهلاك الصحيح. | يوحّد لغة الواجهة. | Low | artifacts/dashboard/src/components/ui/toggle-group.tsx |
| artifacts/dashboard/src/components/ui/toggle.tsx | Primitive UI component reusable داخل النظام. | ليس منطقًا محصولًا؛ يعتمد على الاستهلاك الصحيح. | يوحّد لغة الواجهة. | Low | artifacts/dashboard/src/components/ui/toggle.tsx |
| artifacts/dashboard/src/components/ui/tooltip.tsx | Primitive UI component reusable داخل النظام. | ليس منطقًا محصولًا؛ يعتمد على الاستهلاك الصحيح. | يوحّد لغة الواجهة. | Low | artifacts/dashboard/src/components/ui/tooltip.tsx |
| artifacts/dashboard/src/hooks/use-mobile.tsx | Hook مساعد. | تابع للاستهلاك. | يحسن UX. | Low | artifacts/dashboard/src/hooks/use-mobile.tsx |
| artifacts/dashboard/src/hooks/use-toast.ts | Hook مساعد. | تابع للاستهلاك. | يحسن UX. | Low | artifacts/dashboard/src/hooks/use-toast.ts |
| artifacts/dashboard/src/index.css | ملف واجهة داعم. | يُراجع حسب الاستهلاك. | يسهم في التجربة البصرية. | Low | artifacts/dashboard/src/index.css |
| artifacts/dashboard/src/lib/utils.ts | دوال مساعدة. | لا نقص مستقل ظاهر. | يدعم المكوّنات. | Low | artifacts/dashboard/src/lib/utils.ts |
| artifacts/dashboard/src/lib/clerk.ts | `basePath`/`stripBase`/`clerkAppearance` مشتركة بين App.tsx وصفحات المصادقة؛ الألوان مطابقة لمتغيرات index.css. | لا نقص مستقل ظاهر. | يوحّد إعداد Clerk بدل تكراره في كل صفحة. | Medium | artifacts/dashboard/src/lib/clerk.ts |
| artifacts/dashboard/src/main.tsx | ملف واجهة داعم. | يُراجع حسب الاستهلاك. | يسهم في التجربة البصرية. | Low | artifacts/dashboard/src/main.tsx |
| artifacts/dashboard/src/pages/Dashboard.tsx | ملف واجهة داعم. | يُراجع حسب الاستهلاك. | يسهم في التجربة البصرية. | Low | artifacts/dashboard/src/pages/Dashboard.tsx |
| artifacts/dashboard/src/pages/DiscoverProjectWizard.tsx | ملف واجهة داعم. | يُراجع حسب الاستهلاك. | يسهم في التجربة البصرية. | Low | artifacts/dashboard/src/pages/DiscoverProjectWizard.tsx |
| artifacts/dashboard/src/pages/Events.tsx | ملف واجهة داعم. | يُراجع حسب الاستهلاك. | يسهم في التجربة البصرية. | Low | artifacts/dashboard/src/pages/Events.tsx |
| artifacts/dashboard/src/pages/Graph.tsx | ملف واجهة داعم. | يُراجع حسب الاستهلاك. | يسهم في التجربة البصرية. | Low | artifacts/dashboard/src/pages/Graph.tsx |
| artifacts/dashboard/src/pages/Metrics.tsx | ملف واجهة داعم. | يُراجع حسب الاستهلاك. | يسهم في التجربة البصرية. | Low | artifacts/dashboard/src/pages/Metrics.tsx |
| artifacts/dashboard/src/pages/ProjectDetail.tsx | ملف واجهة داعم. | يُراجع حسب الاستهلاك. | يسهم في التجربة البصرية. | Low | artifacts/dashboard/src/pages/ProjectDetail.tsx |
| artifacts/dashboard/src/pages/Projects.tsx | ملف واجهة داعم. | يُراجع حسب الاستهلاك. | يسهم في التجربة البصرية. | Low | artifacts/dashboard/src/pages/Projects.tsx |
| artifacts/dashboard/src/pages/Rules.tsx | ملف واجهة داعم. | يُراجع حسب الاستهلاك. | يسهم في التجربة البصرية. | Low | artifacts/dashboard/src/pages/Rules.tsx |
| artifacts/dashboard/src/pages/Tasks.tsx | ملف واجهة داعم. | يُراجع حسب الاستهلاك. | يسهم في التجربة البصرية. | Low | artifacts/dashboard/src/pages/Tasks.tsx |
| artifacts/dashboard/src/pages/Workflows.tsx | ملف واجهة داعم. | يُراجع حسب الاستهلاك. | يسهم في التجربة البصرية. | Low | artifacts/dashboard/src/pages/Workflows.tsx |
| artifacts/dashboard/src/pages/AiChat.tsx | واجهة محادثة AI: sidebar للـ sessions، project selector، message bubbles (user/assistant) مع sources badges، quick-action buttons (Analyze/Review/Tasks/Workflow)، optimistic UI؛ يستدعي `/api/ai/*` عبر native fetch مباشرة (لا generated hooks). | لا streaming؛ أزرار AI Analyze/Review غير مدمجة في Projects/Tasks بعد. | مدخل المستخدم لكل قدرات الذكاء الاصطناعي. | High | artifacts/dashboard/src/pages/AiChat.tsx |
| artifacts/dashboard/src/pages/not-found.tsx | ملف واجهة داعم. | يُراجع حسب الاستهلاك. | يسهم في التجربة البصرية. | Low | artifacts/dashboard/src/pages/not-found.tsx |
| artifacts/dashboard/src/pages/Landing.tsx | صفحة عامة لغير المسجّلين على `/`؛ تعرض القيمة المقترحة وزرّي Sign In / Create Account. | لا نقص مستقل ظاهر. | يمنع دخول المستخدم غير المسجّل مباشرة لشاشة تسجيل بلا سياق. | Medium | artifacts/dashboard/src/pages/Landing.tsx |
| artifacts/dashboard/src/pages/SignIn.tsx | صفحة `/sign-in` مخصصة بمظهر العلامة التجارية. | لا نقص مستقل ظاهر. | مسار الدخول الوحيد للمستخدمين الحاليين. | Medium | artifacts/dashboard/src/pages/SignIn.tsx |
| artifacts/dashboard/src/pages/SignUp.tsx | صفحة `/sign-up` مخصصة بمظهر العلامة التجارية. | لا نقص مستقل ظاهر. | مسار التسجيل الوحيد للمستخدمين الجدد. | Medium | artifacts/dashboard/src/pages/SignUp.tsx |
| artifacts/dashboard/tsconfig.json | ملف واجهة داعم. | يُراجع حسب الاستهلاك. | يسهم في التجربة البصرية. | Low | artifacts/dashboard/tsconfig.json |
| artifacts/dashboard/vite.config.ts | ملف واجهة داعم. | يُراجع حسب الاستهلاك. | يسهم في التجربة البصرية. | Low | artifacts/dashboard/vite.config.ts |

### artifacts/mockup-sandbox (69)

| الملف | الموجود | الناقص | الأثر | الأولوية | الدليل |
|---|---|---|---|---|---|
| artifacts/mockup-sandbox/.replit-artifact/artifact.toml | ملف تهيئة/واجهة sandbox. | ليس جزءًا من نواة المنصة. | للاستكشاف البصري. | Low | artifacts/mockup-sandbox/.replit-artifact/artifact.toml |
| artifacts/mockup-sandbox/components.json | ملف تهيئة/واجهة sandbox. | ليس جزءًا من نواة المنصة. | للاستكشاف البصري. | Low | artifacts/mockup-sandbox/components.json |
| artifacts/mockup-sandbox/index.html | ملف تهيئة/واجهة sandbox. | ليس جزءًا من نواة المنصة. | للاستكشاف البصري. | Low | artifacts/mockup-sandbox/index.html |
| artifacts/mockup-sandbox/mockupPreviewPlugin.ts | ملف تجربة/عرض داخل sandbox بصري. | غير موجه للإنتاج. | يفيد النمذجة السريعة. | Low | artifacts/mockup-sandbox/mockupPreviewPlugin.ts |
| artifacts/mockup-sandbox/package.json | ملف تهيئة/واجهة sandbox. | ليس جزءًا من نواة المنصة. | للاستكشاف البصري. | Low | artifacts/mockup-sandbox/package.json |
| artifacts/mockup-sandbox/src/.generated/mockup-components.ts | تجميع/توليد لمكونات mockup. | ليس المسار الإنتاجي الأساسي. | يسهّل التجريب السريع. | Low | artifacts/mockup-sandbox/src/.generated/mockup-components.ts |
| artifacts/mockup-sandbox/src/App.tsx | ملف تجربة/عرض داخل sandbox بصري. | غير موجه للإنتاج. | يفيد النمذجة السريعة. | Low | artifacts/mockup-sandbox/src/App.tsx |
| artifacts/mockup-sandbox/src/components/ui/accordion.tsx | ملف تجربة/عرض داخل sandbox بصري. | غير موجه للإنتاج. | يفيد النمذجة السريعة. | Low | artifacts/mockup-sandbox/src/components/ui/accordion.tsx |
| artifacts/mockup-sandbox/src/components/ui/alert-dialog.tsx | ملف تجربة/عرض داخل sandbox بصري. | غير موجه للإنتاج. | يفيد النمذجة السريعة. | Low | artifacts/mockup-sandbox/src/components/ui/alert-dialog.tsx |
| artifacts/mockup-sandbox/src/components/ui/alert.tsx | ملف تجربة/عرض داخل sandbox بصري. | غير موجه للإنتاج. | يفيد النمذجة السريعة. | Low | artifacts/mockup-sandbox/src/components/ui/alert.tsx |
| artifacts/mockup-sandbox/src/components/ui/aspect-ratio.tsx | ملف تجربة/عرض داخل sandbox بصري. | غير موجه للإنتاج. | يفيد النمذجة السريعة. | Low | artifacts/mockup-sandbox/src/components/ui/aspect-ratio.tsx |
| artifacts/mockup-sandbox/src/components/ui/avatar.tsx | ملف تجربة/عرض داخل sandbox بصري. | غير موجه للإنتاج. | يفيد النمذجة السريعة. | Low | artifacts/mockup-sandbox/src/components/ui/avatar.tsx |
| artifacts/mockup-sandbox/src/components/ui/badge.tsx | ملف تجربة/عرض داخل sandbox بصري. | غير موجه للإنتاج. | يفيد النمذجة السريعة. | Low | artifacts/mockup-sandbox/src/components/ui/badge.tsx |
| artifacts/mockup-sandbox/src/components/ui/breadcrumb.tsx | ملف تجربة/عرض داخل sandbox بصري. | غير موجه للإنتاج. | يفيد النمذجة السريعة. | Low | artifacts/mockup-sandbox/src/components/ui/breadcrumb.tsx |
| artifacts/mockup-sandbox/src/components/ui/button-group.tsx | ملف تجربة/عرض داخل sandbox بصري. | غير موجه للإنتاج. | يفيد النمذجة السريعة. | Low | artifacts/mockup-sandbox/src/components/ui/button-group.tsx |
| artifacts/mockup-sandbox/src/components/ui/button.tsx | ملف تجربة/عرض داخل sandbox بصري. | غير موجه للإنتاج. | يفيد النمذجة السريعة. | Low | artifacts/mockup-sandbox/src/components/ui/button.tsx |
| artifacts/mockup-sandbox/src/components/ui/calendar.tsx | ملف تجربة/عرض داخل sandbox بصري. | غير موجه للإنتاج. | يفيد النمذجة السريعة. | Low | artifacts/mockup-sandbox/src/components/ui/calendar.tsx |
| artifacts/mockup-sandbox/src/components/ui/card.tsx | ملف تجربة/عرض داخل sandbox بصري. | غير موجه للإنتاج. | يفيد النمذجة السريعة. | Low | artifacts/mockup-sandbox/src/components/ui/card.tsx |
| artifacts/mockup-sandbox/src/components/ui/carousel.tsx | ملف تجربة/عرض داخل sandbox بصري. | غير موجه للإنتاج. | يفيد النمذجة السريعة. | Low | artifacts/mockup-sandbox/src/components/ui/carousel.tsx |
| artifacts/mockup-sandbox/src/components/ui/chart.tsx | ملف تجربة/عرض داخل sandbox بصري. | غير موجه للإنتاج. | يفيد النمذجة السريعة. | Low | artifacts/mockup-sandbox/src/components/ui/chart.tsx |
| artifacts/mockup-sandbox/src/components/ui/checkbox.tsx | ملف تجربة/عرض داخل sandbox بصري. | غير موجه للإنتاج. | يفيد النمذجة السريعة. | Low | artifacts/mockup-sandbox/src/components/ui/checkbox.tsx |
| artifacts/mockup-sandbox/src/components/ui/collapsible.tsx | ملف تجربة/عرض داخل sandbox بصري. | غير موجه للإنتاج. | يفيد النمذجة السريعة. | Low | artifacts/mockup-sandbox/src/components/ui/collapsible.tsx |
| artifacts/mockup-sandbox/src/components/ui/command.tsx | ملف تجربة/عرض داخل sandbox بصري. | غير موجه للإنتاج. | يفيد النمذجة السريعة. | Low | artifacts/mockup-sandbox/src/components/ui/command.tsx |
| artifacts/mockup-sandbox/src/components/ui/context-menu.tsx | ملف تجربة/عرض داخل sandbox بصري. | غير موجه للإنتاج. | يفيد النمذجة السريعة. | Low | artifacts/mockup-sandbox/src/components/ui/context-menu.tsx |
| artifacts/mockup-sandbox/src/components/ui/dialog.tsx | ملف تجربة/عرض داخل sandbox بصري. | غير موجه للإنتاج. | يفيد النمذجة السريعة. | Low | artifacts/mockup-sandbox/src/components/ui/dialog.tsx |
| artifacts/mockup-sandbox/src/components/ui/drawer.tsx | ملف تجربة/عرض داخل sandbox بصري. | غير موجه للإنتاج. | يفيد النمذجة السريعة. | Low | artifacts/mockup-sandbox/src/components/ui/drawer.tsx |
| artifacts/mockup-sandbox/src/components/ui/dropdown-menu.tsx | ملف تجربة/عرض داخل sandbox بصري. | غير موجه للإنتاج. | يفيد النمذجة السريعة. | Low | artifacts/mockup-sandbox/src/components/ui/dropdown-menu.tsx |
| artifacts/mockup-sandbox/src/components/ui/empty.tsx | ملف تجربة/عرض داخل sandbox بصري. | غير موجه للإنتاج. | يفيد النمذجة السريعة. | Low | artifacts/mockup-sandbox/src/components/ui/empty.tsx |
| artifacts/mockup-sandbox/src/components/ui/field.tsx | ملف تجربة/عرض داخل sandbox بصري. | غير موجه للإنتاج. | يفيد النمذجة السريعة. | Low | artifacts/mockup-sandbox/src/components/ui/field.tsx |
| artifacts/mockup-sandbox/src/components/ui/form.tsx | ملف تجربة/عرض داخل sandbox بصري. | غير موجه للإنتاج. | يفيد النمذجة السريعة. | Low | artifacts/mockup-sandbox/src/components/ui/form.tsx |
| artifacts/mockup-sandbox/src/components/ui/hover-card.tsx | ملف تجربة/عرض داخل sandbox بصري. | غير موجه للإنتاج. | يفيد النمذجة السريعة. | Low | artifacts/mockup-sandbox/src/components/ui/hover-card.tsx |
| artifacts/mockup-sandbox/src/components/ui/input-group.tsx | ملف تجربة/عرض داخل sandbox بصري. | غير موجه للإنتاج. | يفيد النمذجة السريعة. | Low | artifacts/mockup-sandbox/src/components/ui/input-group.tsx |
| artifacts/mockup-sandbox/src/components/ui/input-otp.tsx | ملف تجربة/عرض داخل sandbox بصري. | غير موجه للإنتاج. | يفيد النمذجة السريعة. | Low | artifacts/mockup-sandbox/src/components/ui/input-otp.tsx |
| artifacts/mockup-sandbox/src/components/ui/input.tsx | ملف تجربة/عرض داخل sandbox بصري. | غير موجه للإنتاج. | يفيد النمذجة السريعة. | Low | artifacts/mockup-sandbox/src/components/ui/input.tsx |
| artifacts/mockup-sandbox/src/components/ui/item.tsx | ملف تجربة/عرض داخل sandbox بصري. | غير موجه للإنتاج. | يفيد النمذجة السريعة. | Low | artifacts/mockup-sandbox/src/components/ui/item.tsx |
| artifacts/mockup-sandbox/src/components/ui/kbd.tsx | ملف تجربة/عرض داخل sandbox بصري. | غير موجه للإنتاج. | يفيد النمذجة السريعة. | Low | artifacts/mockup-sandbox/src/components/ui/kbd.tsx |
| artifacts/mockup-sandbox/src/components/ui/label.tsx | ملف تجربة/عرض داخل sandbox بصري. | غير موجه للإنتاج. | يفيد النمذجة السريعة. | Low | artifacts/mockup-sandbox/src/components/ui/label.tsx |
| artifacts/mockup-sandbox/src/components/ui/menubar.tsx | ملف تجربة/عرض داخل sandbox بصري. | غير موجه للإنتاج. | يفيد النمذجة السريعة. | Low | artifacts/mockup-sandbox/src/components/ui/menubar.tsx |
| artifacts/mockup-sandbox/src/components/ui/navigation-menu.tsx | ملف تجربة/عرض داخل sandbox بصري. | غير موجه للإنتاج. | يفيد النمذجة السريعة. | Low | artifacts/mockup-sandbox/src/components/ui/navigation-menu.tsx |
| artifacts/mockup-sandbox/src/components/ui/pagination.tsx | ملف تجربة/عرض داخل sandbox بصري. | غير موجه للإنتاج. | يفيد النمذجة السريعة. | Low | artifacts/mockup-sandbox/src/components/ui/pagination.tsx |
| artifacts/mockup-sandbox/src/components/ui/popover.tsx | ملف تجربة/عرض داخل sandbox بصري. | غير موجه للإنتاج. | يفيد النمذجة السريعة. | Low | artifacts/mockup-sandbox/src/components/ui/popover.tsx |
| artifacts/mockup-sandbox/src/components/ui/progress.tsx | ملف تجربة/عرض داخل sandbox بصري. | غير موجه للإنتاج. | يفيد النمذجة السريعة. | Low | artifacts/mockup-sandbox/src/components/ui/progress.tsx |
| artifacts/mockup-sandbox/src/components/ui/radio-group.tsx | ملف تجربة/عرض داخل sandbox بصري. | غير موجه للإنتاج. | يفيد النمذجة السريعة. | Low | artifacts/mockup-sandbox/src/components/ui/radio-group.tsx |
| artifacts/mockup-sandbox/src/components/ui/resizable.tsx | ملف تجربة/عرض داخل sandbox بصري. | غير موجه للإنتاج. | يفيد النمذجة السريعة. | Low | artifacts/mockup-sandbox/src/components/ui/resizable.tsx |
| artifacts/mockup-sandbox/src/components/ui/scroll-area.tsx | ملف تجربة/عرض داخل sandbox بصري. | غير موجه للإنتاج. | يفيد النمذجة السريعة. | Low | artifacts/mockup-sandbox/src/components/ui/scroll-area.tsx |
| artifacts/mockup-sandbox/src/components/ui/select.tsx | ملف تجربة/عرض داخل sandbox بصري. | غير موجه للإنتاج. | يفيد النمذجة السريعة. | Low | artifacts/mockup-sandbox/src/components/ui/select.tsx |
| artifacts/mockup-sandbox/src/components/ui/separator.tsx | ملف تجربة/عرض داخل sandbox بصري. | غير موجه للإنتاج. | يفيد النمذجة السريعة. | Low | artifacts/mockup-sandbox/src/components/ui/separator.tsx |
| artifacts/mockup-sandbox/src/components/ui/sheet.tsx | ملف تجربة/عرض داخل sandbox بصري. | غير موجه للإنتاج. | يفيد النمذجة السريعة. | Low | artifacts/mockup-sandbox/src/components/ui/sheet.tsx |
| artifacts/mockup-sandbox/src/components/ui/sidebar.tsx | ملف تجربة/عرض داخل sandbox بصري. | غير موجه للإنتاج. | يفيد النمذجة السريعة. | Low | artifacts/mockup-sandbox/src/components/ui/sidebar.tsx |
| artifacts/mockup-sandbox/src/components/ui/skeleton.tsx | ملف تجربة/عرض داخل sandbox بصري. | غير موجه للإنتاج. | يفيد النمذجة السريعة. | Low | artifacts/mockup-sandbox/src/components/ui/skeleton.tsx |
| artifacts/mockup-sandbox/src/components/ui/slider.tsx | ملف تجربة/عرض داخل sandbox بصري. | غير موجه للإنتاج. | يفيد النمذجة السريعة. | Low | artifacts/mockup-sandbox/src/components/ui/slider.tsx |
| artifacts/mockup-sandbox/src/components/ui/sonner.tsx | ملف تجربة/عرض داخل sandbox بصري. | غير موجه للإنتاج. | يفيد النمذجة السريعة. | Low | artifacts/mockup-sandbox/src/components/ui/sonner.tsx |
| artifacts/mockup-sandbox/src/components/ui/spinner.tsx | ملف تجربة/عرض داخل sandbox بصري. | غير موجه للإنتاج. | يفيد النمذجة السريعة. | Low | artifacts/mockup-sandbox/src/components/ui/spinner.tsx |
| artifacts/mockup-sandbox/src/components/ui/switch.tsx | ملف تجربة/عرض داخل sandbox بصري. | غير موجه للإنتاج. | يفيد النمذجة السريعة. | Low | artifacts/mockup-sandbox/src/components/ui/switch.tsx |
| artifacts/mockup-sandbox/src/components/ui/table.tsx | ملف تجربة/عرض داخل sandbox بصري. | غير موجه للإنتاج. | يفيد النمذجة السريعة. | Low | artifacts/mockup-sandbox/src/components/ui/table.tsx |
| artifacts/mockup-sandbox/src/components/ui/tabs.tsx | ملف تجربة/عرض داخل sandbox بصري. | غير موجه للإنتاج. | يفيد النمذجة السريعة. | Low | artifacts/mockup-sandbox/src/components/ui/tabs.tsx |
| artifacts/mockup-sandbox/src/components/ui/textarea.tsx | ملف تجربة/عرض داخل sandbox بصري. | غير موجه للإنتاج. | يفيد النمذجة السريعة. | Low | artifacts/mockup-sandbox/src/components/ui/textarea.tsx |
| artifacts/mockup-sandbox/src/components/ui/toast.tsx | ملف تجربة/عرض داخل sandbox بصري. | غير موجه للإنتاج. | يفيد النمذجة السريعة. | Low | artifacts/mockup-sandbox/src/components/ui/toast.tsx |
| artifacts/mockup-sandbox/src/components/ui/toaster.tsx | ملف تجربة/عرض داخل sandbox بصري. | غير موجه للإنتاج. | يفيد النمذجة السريعة. | Low | artifacts/mockup-sandbox/src/components/ui/toaster.tsx |
| artifacts/mockup-sandbox/src/components/ui/toggle-group.tsx | ملف تجربة/عرض داخل sandbox بصري. | غير موجه للإنتاج. | يفيد النمذجة السريعة. | Low | artifacts/mockup-sandbox/src/components/ui/toggle-group.tsx |
| artifacts/mockup-sandbox/src/components/ui/toggle.tsx | ملف تجربة/عرض داخل sandbox بصري. | غير موجه للإنتاج. | يفيد النمذجة السريعة. | Low | artifacts/mockup-sandbox/src/components/ui/toggle.tsx |
| artifacts/mockup-sandbox/src/components/ui/tooltip.tsx | ملف تجربة/عرض داخل sandbox بصري. | غير موجه للإنتاج. | يفيد النمذجة السريعة. | Low | artifacts/mockup-sandbox/src/components/ui/tooltip.tsx |
| artifacts/mockup-sandbox/src/hooks/use-mobile.tsx | ملف تجربة/عرض داخل sandbox بصري. | غير موجه للإنتاج. | يفيد النمذجة السريعة. | Low | artifacts/mockup-sandbox/src/hooks/use-mobile.tsx |
| artifacts/mockup-sandbox/src/hooks/use-toast.ts | ملف تجربة/عرض داخل sandbox بصري. | غير موجه للإنتاج. | يفيد النمذجة السريعة. | Low | artifacts/mockup-sandbox/src/hooks/use-toast.ts |
| artifacts/mockup-sandbox/src/index.css | ملف تهيئة/واجهة sandbox. | ليس جزءًا من نواة المنصة. | للاستكشاف البصري. | Low | artifacts/mockup-sandbox/src/index.css |
| artifacts/mockup-sandbox/src/lib/utils.ts | ملف تجربة/عرض داخل sandbox بصري. | غير موجه للإنتاج. | يفيد النمذجة السريعة. | Low | artifacts/mockup-sandbox/src/lib/utils.ts |
| artifacts/mockup-sandbox/src/main.tsx | ملف تجربة/عرض داخل sandbox بصري. | غير موجه للإنتاج. | يفيد النمذجة السريعة. | Low | artifacts/mockup-sandbox/src/main.tsx |
| artifacts/mockup-sandbox/tsconfig.json | ملف تهيئة/واجهة sandbox. | ليس جزءًا من نواة المنصة. | للاستكشاف البصري. | Low | artifacts/mockup-sandbox/tsconfig.json |
| artifacts/mockup-sandbox/vite.config.ts | ملف تجربة/عرض داخل sandbox بصري. | غير موجه للإنتاج. | يفيد النمذجة السريعة. | Low | artifacts/mockup-sandbox/vite.config.ts |

### attached_assets (52)

| الملف | الموجود | الناقص | الأثر | الأولوية | الدليل |
|---|---|---|---|---|---|
| attached_assets/EngineeringOS_Audit_Report_1783641389270.md | مرفق مرجعي أو نص تاريخي. | ليس جزءًا من التشغيل. | يؤرشف السياق السابق. | Low | attached_assets/EngineeringOS_Audit_Report_1783641389270.md |
| attached_assets/EngineeringOS_Audit_Report_Expanded_1783642792349.md | مرفق مرجعي أو نص تاريخي. | ليس جزءًا من التشغيل. | يؤرشف السياق السابق. | Low | attached_assets/EngineeringOS_Audit_Report_Expanded_1783642792349.md |
| attached_assets/EngineeringOS_Combined_Deep_Analysis_(1)_1783706911895.md | مرفق مرجعي أو نص تاريخي. | ليس جزءًا من التشغيل. | يؤرشف السياق السابق. | Low | attached_assets/EngineeringOS_Combined_Deep_Analysis_(1)_1783706911895.md |
| attached_assets/EngineeringOS_File_Inventory_Complete(1)_1783706911845.md | مرفق مرجعي أو نص تاريخي. | ليس جزءًا من التشغيل. | يؤرشف السياق السابق. | Low | attached_assets/EngineeringOS_File_Inventory_Complete(1)_1783706911845.md |
| attached_assets/EngineeringOS_Project_1783718452179.pdf | مرفق PDF تاريخي/مرجعي. | ليس ملف تنفيذ. | يحفظ سياقًا وثائقيًا. | Low | attached_assets/EngineeringOS_Project_1783718452179.pdf |
| attached_assets/Engineering_Os_Fact_Record_1783718570175.pdf | مرفق PDF تاريخي/مرجعي. | ليس ملف تنفيذ. | يحفظ سياقًا وثائقيًا. | Low | attached_assets/Engineering_Os_Fact_Record_1783718570175.pdf |
| attached_assets/Engineering_Os_Phased_Completion_Plan_(1)_1783718452123.pdf | مرفق PDF تاريخي/مرجعي. | ليس ملف تنفيذ. | يحفظ سياقًا وثائقيًا. | Low | attached_assets/Engineering_Os_Phased_Completion_Plan_(1)_1783718452123.pdf |
| attached_assets/Engineering_Os_Phased_Completion_Plan_1783718452216.pdf | مرفق PDF تاريخي/مرجعي. | ليس ملف تنفيذ. | يحفظ سياقًا وثائقيًا. | Low | attached_assets/Engineering_Os_Phased_Completion_Plan_1783718452216.pdf |
| attached_assets/Pasted--EngineeringOS-Autonomous-Project-Discovery-Onboarding-_1783565505918.txt | مرفق مرجعي أو نص تاريخي. | ليس جزءًا من التشغيل. | يؤرشف السياق السابق. | Low | attached_assets/Pasted--EngineeringOS-Autonomous-Project-Discovery-Onboarding-_1783565505918.txt |
| attached_assets/Pasted--EngineeringOS-Autonomous-Project-Discovery-Onboarding-_1783566150077.txt | مرفق مرجعي أو نص تاريخي. | ليس جزءًا من التشغيل. | يؤرشف السياق السابق. | Low | attached_assets/Pasted--EngineeringOS-Autonomous-Project-Discovery-Onboarding-_1783566150077.txt |
| attached_assets/Screenshot_٢٠٢٦٠٧٠٩-٠٦١٦٢٥_1783567039006.png | لقطة/صورة مرجعية. | ليست جزءًا من runtime. | تخدم التوثيق البصري. | Low | attached_assets/Screenshot_٢٠٢٦٠٧٠٩-٠٦١٦٢٥_1783567039006.png |
| attached_assets/Screenshot_٢٠٢٦٠٧٠٩-٠٦٢٠٣٨_1783610776566.png | لقطة/صورة مرجعية. | ليست جزءًا من runtime. | تخدم التوثيق البصري. | Low | attached_assets/Screenshot_٢٠٢٦٠٧٠٩-٠٦٢٠٣٨_1783610776566.png |
| attached_assets/agents_(1)_1783564013722.zip | أرشيف مرفقات/نسخ تاريخية. | ليس جزءًا من البناء المباشر. | يحفظ نسخًا مرجعية. | Low | attached_assets/agents_(1)_1783564013722.zip |
| attached_assets/artifacts_(7)_(1)_1783564013761.zip | أرشيف مرفقات/نسخ تاريخية. | ليس جزءًا من البناء المباشر. | يحفظ نسخًا مرجعية. | Low | attached_assets/artifacts_(7)_(1)_1783564013761.zip |
| attached_assets/git_(2)_1783564013691.zip | أرشيف مرفقات/نسخ تاريخية. | ليس جزءًا من البناء المباشر. | يحفظ نسخًا مرجعية. | Low | attached_assets/git_(2)_1783564013691.zip |
| attached_assets/gitattributes_1783564013915.txt | مرفق مرجعي أو نص تاريخي. | ليس جزءًا من التشغيل. | يؤرشف السياق السابق. | Low | attached_assets/gitattributes_1783564013915.txt |
| attached_assets/gitignore_(1)_1783564013965.txt | مرفق مرجعي أو نص تاريخي. | ليس جزءًا من التشغيل. | يؤرشف السياق السابق. | Low | attached_assets/gitignore_(1)_1783564013965.txt |
| attached_assets/lib_(7)_(1)_1783564013810.zip | أرشيف مرفقات/نسخ تاريخية. | ليس جزءًا من البناء المباشر. | يحفظ نسخًا مرجعية. | Low | attached_assets/lib_(7)_(1)_1783564013810.zip |
| attached_assets/node_modules_(2)_1783564014266.zip | أرشيف مرفقات/نسخ تاريخية. | ليس جزءًا من البناء المباشر. | يحفظ نسخًا مرجعية. | Low | attached_assets/node_modules_(2)_1783564014266.zip |
| attached_assets/npmrc_(2)_1783564014024.txt | مرفق مرجعي أو نص تاريخي. | ليس جزءًا من التشغيل. | يؤرشف السياق السابق. | Low | attached_assets/npmrc_(2)_1783564014024.txt |
| attached_assets/package_(1)_(7)_1783564014328.json | مرفق مرجعي أو نص تاريخي. | ليس جزءًا من التشغيل. | يؤرشف السياق السابق. | Low | attached_assets/package_(1)_(7)_1783564014328.json |
| attached_assets/pnpm-lock.yaml_(3)_1783564014392.txt | مرفق مرجعي أو نص تاريخي. | ليس جزءًا من التشغيل. | يؤرشف السياق السابق. | Low | attached_assets/pnpm-lock.yaml_(3)_1783564014392.txt |
| attached_assets/pnpm-workspace.yaml_(3)_1783564014449.txt | مرفق مرجعي أو نص تاريخي. | ليس جزءًا من التشغيل. | يؤرشف السياق السابق. | Low | attached_assets/pnpm-workspace.yaml_(3)_1783564014449.txt |
| attached_assets/replit_(13)_1783564014085.md | مرفق مرجعي أو نص تاريخي. | ليس جزءًا من التشغيل. | يؤرشف السياق السابق. | Low | attached_assets/replit_(13)_1783564014085.md |
| attached_assets/replit_(2)_1783564014509.txt | مرفق مرجعي أو نص تاريخي. | ليس جزءًا من التشغيل. | يؤرشف السياق السابق. | Low | attached_assets/replit_(2)_1783564014509.txt |
| attached_assets/replitignore_1783564014569.txt | مرفق مرجعي أو نص تاريخي. | ليس جزءًا من التشغيل. | يؤرشف السياق السابق. | Low | attached_assets/replitignore_1783564014569.txt |
| attached_assets/scripts_(8)_1783564013865.zip | أرشيف مرفقات/نسخ تاريخية. | ليس جزءًا من البناء المباشر. | يحفظ نسخًا مرجعية. | Low | attached_assets/scripts_(8)_1783564013865.zip |
| attached_assets/tsconfig.base_(2)_(1)_1783564014142.json | مرفق مرجعي أو نص تاريخي. | ليس جزءًا من التشغيل. | يؤرشف السياق السابق. | Low | attached_assets/tsconfig.base_(2)_(1)_1783564014142.json |
| attached_assets/tsconfig_(7)_1783564014202.json | مرفق مرجعي أو نص تاريخي. | ليس جزءًا من التشغيل. | يؤرشف السياق السابق. | Low | attached_assets/tsconfig_(7)_1783564014202.json |
| attached_assets/EngineeringOS_File_by_File_Fact_Record_1783725698283.md | سجل حقيقة ملفّي مفصّل (91708 بايت) — أُنشئ كأرشيف تحليلي. | ليس مرجعًا حيًا؛ يُعتمد على docs/fact-record.md الحالي بدلًا منه. | يؤرشف السياق السابق. | Low | attached_assets/EngineeringOS_File_by_File_Fact_Record_1783725698283.md |
| attached_assets/EngineeringOS_Implementation_Document_1783726156016.md | وثيقة تنفيذ تاريخية (24261 بايت) تصف القرارات المعمارية الأولى. | ليس جزءًا من التشغيل. | يؤرشف السياق السابق. | Low | attached_assets/EngineeringOS_Implementation_Document_1783726156016.md |
| attached_assets/خطة_العمل_التنفيذية_لمشروع_EngineeringOS_1783729892699.docx | خطة العمل التنفيذية الكاملة (9 مسارات، 5 مراحل) بصيغة Word — المصدر الأصلي لخطة المشروع الحالية. | خطة حية تُوجّه Tasks #3-#9؛ المرجع القابل للتعديل هو docs/completion-plan.md. | يوثّق الرؤية التنفيذية الشاملة. | Medium | attached_assets/خطة_العمل_التنفيذية_لمشروع_EngineeringOS_1783729892699.docx |
| attached_assets/EngineeringOS_project_analysis_report(1)_1783729892769.md | تقرير تحليل معماري (2026-07-11) يحدد الفجوات ويقترح ترتيب التنفيذ. | يُعتمد عليه كمرجع تشخيصي؛ المخرجات العملية نُقلت إلى Tasks #3-#9. | يؤرشف السياق التحليلي. | Low | attached_assets/EngineeringOS_project_analysis_report(1)_1783729892769.md |
| attached_assets/EngineeringOS_file_inventory_(1)_1783729892809.csv | جرد كامل للملفات (355 ملفًا) بتنسيق CSV — path, size, package, role, is_test, is_generated, is_empty. | مرجع وقتي؛ المرجع الحي هو هذا الملف. | يسهّل التحقق الآلي من اكتمال التوثيق. | Low | attached_assets/EngineeringOS_file_inventory_(1)_1783729892809.csv |
| attached_assets/Pasted--Plan-3-Sync-fact-record-architecture-docs-3-Sync-Fact-_1783733496072.txt | نص الخطط #3–#9 (الموجة الثانية من 9 مسارات) بصيغة لصق نصي. | مصدر حيّ لتفاصيل Tasks #3-#9؛ الملخص المعتمد هو docs/completion-plan.md. | يوثّق تفاصيل الخطوات والملفات ذات الصلة لكل مسار. | Low | attached_assets/Pasted--Plan-3-Sync-fact-record-architecture-docs-3-Sync-Fact-_1783733496072.txt |
| attached_assets/Pasted-Plan-6-Deepen-graph-scanner-discovery-6-Deepen-Graph-Sc_1783734658300.txt | نسخة نصية منفردة من تفاصيل Task #6 (لصق لاحق لنفس محتوى الخطة الموجود ضمن ملف الخطط #3-#9). | تكرار جزئي؛ لا يضيف معلومة جديدة عن الملف الشامل أعلاه. | يؤرشف نسخة إضافية من سياق Task #6. | Low | attached_assets/Pasted-Plan-6-Deepen-graph-scanner-discovery-6-Deepen-Graph-Sc_1783734658300.txt |
| attached_assets/Pasted-7-Upgrade-Dashboard-to-Operational-UI-What-Why-Current-_1783734748019.txt | نسخة نصية منفردة من تفاصيل Task #7 (Upgrade Dashboard to Operational UI) — لصق لاحق لنفس محتوى الخطة الموجود ضمن ملف الخطط #3-#9. | تكرار جزئي؛ لا يضيف معلومة جديدة عن الملف الشامل أعلاه. | يؤرشف نسخة إضافية من سياق Task #7. | Low | attached_assets/Pasted-7-Upgrade-Dashboard-to-Operational-UI-What-Why-Current-_1783734748019.txt |
| attached_assets/Pasted--Plan-3-Sync-fact-record-architecture-docs-3-Sync-Fact-_1783790285219.txt | نسخة نصية أحدث (لاحقة زمنيًا) من ملف الخطط #3–#9 نفسه — لصق مكرر لاحق للنسخة `_1783733496072.txt` أعلاه. | تكرار كامل؛ لا يضيف محتوى جديدًا عن النسخة الأقدم. | يؤرشف نسخة إضافية زمنية من سياق الخطط #3-#9. | Low | attached_assets/Pasted--Plan-3-Sync-fact-record-architecture-docs-3-Sync-Fact-_1783790285219.txt |
| attached_assets/EngineeringOS_series20_status_register_1783966531239.md | سجل حالة طبقي بالأدلة (السلسلة 20): يُثبت أن المنصة أصبحت control plane متعدد الطبقات من العقد إلى DB إلى scanner إلى AI إلى dashboard. | وثيقة تحليلية؛ الحقيقة الحية في docs/fact-record.md. | يؤرشف حالة المنصة عند نقطة التحقق 20. | Low | attached_assets/EngineeringOS_series20_status_register_1783966531239.md |
| attached_assets/EngineeringOS_series21_deep_status_1783966531177.md | طبقة الثقة الذاتية والتحكم التشغيلي (السلسلة 21): تفصيل الأدلة الحاكمة على نضج كل طبقة: reconciliation، atomic scan، AI layer، graph inference. | وثيقة تحليلية. | يؤرشف حالة المنصة عند نقطة التحقق 21. | Low | attached_assets/EngineeringOS_series21_deep_status_1783966531177.md |
| attached_assets/EngineeringOS_series22_second_wave_analysis_1783966531113.md | تحليل الموجة الثانية (السلسلة 22): مراجعة تفصيلية للمسارات والطبقات بعد Tasks #3-#9. | وثيقة تحليلية. | يؤرشف السياق التحليلي للموجة الثانية. | Low | attached_assets/EngineeringOS_series22_second_wave_analysis_1783966531113.md |
| attached_assets/EngineeringOS_series23_self_verifying_architecture_1783966531049.md | البنية الذاتية التحقق (السلسلة 23): يثبت أن codegen drift-check ومسارات المصادقة وحوكمة الـ schema تشكل نظام تحقق ذاتي. | وثيقة تحليلية. | يؤرشف تحليل آليات التحقق الذاتي. | Low | attached_assets/EngineeringOS_series23_self_verifying_architecture_1783966531049.md |
| attached_assets/EngineeringOS_series24_deep_evidence_1783966530990.md | أدلة عميقة (السلسلة 24): تتبّع كل طبقة من الأدلة الملفية إلى الأثر التشغيلي. | وثيقة تحليلية. | يؤرشف السياق التحليلي العميق. | Low | attached_assets/EngineeringOS_series24_deep_evidence_1783966530990.md |
| attached_assets/EngineeringOS_series25_truth_register_1783966530939.md | سجل الحقيقة الطبقي (السلسلة 25): لقطة كمية شاملة (465 ملف، 58 عملية، 16 جدول، 15 صفحة واجهة) وتحقق فعلي من كل طبقة. | وثيقة تحليلية. | يؤرشف لقطة الحالة الكمية. | Low | attached_assets/EngineeringOS_series25_truth_register_1783966530939.md |
| attached_assets/EngineeringOS_series26_boundary_analysis_1783966530884.md | تحليل الحدود (السلسلة 26): يُحدد ما انتهى من بناء النواة وما يحتاج إغلاقًا حوكميًا (RBAC، اختبارات، correlationId في العقد). | وثيقة تحليلية. | يؤرشف تحليل حدود النضج التشغيلي. | Low | attached_assets/EngineeringOS_series26_boundary_analysis_1783966530884.md |
| attached_assets/EngineeringOS_series27_failure_semantics_1783966530824.md | دلالات الفشل (السلسلة 27): يُثبت كيف يتصرف النظام تحت الضغط: JobQueue bounds، startup reconciliation، atomic scan، task/workflow state machines. | وثيقة تحليلية. | يؤرشف تحليل سلوك النظام عند الفشل. | Low | attached_assets/EngineeringOS_series27_failure_semantics_1783966530824.md |
| attached_assets/EngineeringOS_series28_traceability_mesh_1783966530766.md | شبكة التتبّع والحوكمة (السلسلة 28): يُثبت أن correlationId يربط audit/events/metrics لكل scan، وأن tasks وworkflows أصبحت state machines حقيقية. | وثيقة تحليلية. | يؤرشف تحليل منظومة التتبّع. | Low | attached_assets/EngineeringOS_series28_traceability_mesh_1783966530766.md |
| attached_assets/EngineeringOS_series29_trust_boundary_register_1783966530702.md | سجل حدود الثقة (السلسلة 29): يُثبت أن المصادقة موجودة (Clerk + requireAuth) لكن التفويض flat (لا RBAC/ACL/project membership)؛ هذا قرار مرحلي موثق لا غفلة. | وثيقة تحليلية. | يؤرشف تحليل حدود الثقة والصلاحيات. | Low | attached_assets/EngineeringOS_series29_trust_boundary_register_1783966530702.md |
| attached_assets/EngineeringOS_series30_release_handoff_audit_1783966530642.md | تدقيق جاهزية التسليم (السلسلة 30): يُحدد الفجوات الثلاث المتبقية قبل اعتبار المنصة مغلقة: RBAC، تغطية اختبارية للـ ai/events/rules/dashboard، إغلاق التوثيق. | وثيقة تحليلية؛ الفجوات مُوثَّقة في docs/completion-plan.md. | يؤرشف تقييم الجاهزية للتسليم. | Low | attached_assets/EngineeringOS_series30_release_handoff_audit_1783966530642.md |
| attached_assets/EngineeringOS_series31_release_handoff_audit_1783966530586.md | تدقيق التسليم التشغيلي (السلسلة 31): يُثبت مؤشرات النضج لكل طبقة (عقد، DB، scan، AI، audit) ويُحدد حدود الثقة والديمومة الصريحة. | وثيقة تحليلية. | يؤرشف مؤشرات نضج المنصة التشغيلية. | Low | attached_assets/EngineeringOS_series31_release_handoff_audit_1783966530586.md |
| attached_assets/EngineeringOS_series32_phase_conformance_audit_1783966530537.md | تدقيق الالتزام بالخطة المرحلية (السلسلة 32): يقيس درجة التوافق بين docs/completion-plan.md والكود الفعلي؛ يُثبت اكتمال المراحل 0–6 وجزئية 7–9. | وثيقة تحليلية. | يؤرشف قياس التوافق بين الخطة والتنفيذ. | Low | attached_assets/EngineeringOS_series32_phase_conformance_audit_1783966530537.md |
| attached_assets/EngineeringOS_series33_provenance_authority_graph_1783966530470.md | خريطة سلطة التتبّع (السلسلة 33): يُصنّف 459 ملفًا حسب مستوى السلطة (A/B/C/D)؛ يُثبت أن docs + openapi.yaml هي A-level وأن المولّدات C-level تابعة. | وثيقة تحليلية. | يؤرشف هرم سلطة الحقيقة في المشروع. | Low | attached_assets/EngineeringOS_series33_provenance_authority_graph_1783966530470.md |

---

## خريطة الطبقات المعمارية

تنقسم المنصة إلى ست طبقات متراكبة. كل طبقة تعتمد على التي تحتها ولا تتجاوزها.

### الطبقة 1 — طبقة العقد (Contract Layer)
**الحزم:** `lib/api-spec`, `lib/api-zod`, `lib/api-client-react`
**المسؤولية:** تعريف "ماذا يفعل النظام" بصيغة OpenAPI، وتوليد validators (Zod) وهooks (React Query) منه آليًا.
**القاعدة الذهبية:** `lib/api-spec/openapi.yaml` هو مصدر الحقيقة الوحيد. أي endpoint موجود على الخادم يجب أن يكون في العقد أولًا؛ أي تغيير في العقد يستدعي تشغيل `pnpm run codegen` فورًا.
**الحالة:** مكتملة ومتصلة بالتوليد. جميع المسارات التنفيذية مُنعكسة في العقد (أُغلقت الفجوات في 2026-07-10).

### الطبقة 2 — طبقة البيانات (Data Layer)
**الحزم:** `lib/db`
**المسؤولية:** تعريف schema قاعدة البيانات (Drizzle ORM + PostgreSQL)، تهيئة الاتصال، وتصدير instance واحد للاستخدام في كل الحزم.
**الجداول الأساسية:** projects, tasks, task_logs, workflows, workflow_executions, rules, events, metrics, graph_entities, graph_relationships, scan_jobs, discovery_sessions, plugins, audit_logs, ai_chat_sessions, ai_chat_messages. (16 جدولًا إجمالًا)
**الحالة:** مستقرة. FKs الأساسية مُضافة. enums للـ audit/discovery تُشتق من DB مباشرةً. projects.rootPath وplugins.name UNIQUE. القيود شبه البنيوية (workflow phases، graph relation types) متعمَّدة كـ free text لدعم التوسع.

### الطبقة 3 — طبقة التحليل (Analysis / Scanner Layer)
**الحزم:** `lib/scanner`
**المسؤولية:** المشي على ملفات المشروع، مطابقة القواعد، استخراج الرسم البياني (AST للـ TS/JS وPython)، وحساب المقاييس. مستقل تمامًا — يمكن استخدامه كـ CLI أو background job دون الخادم.
**الحالة:** جيدة. يدعم CommonJS, export=, class methods, وPython AST فعلي (subprocess). (مرشّح لمزيد من العمق).

### الطبقة 3ب — طبقة المعرفة (Knowledge Layer)
**الحزم:** `lib/knowledge-engine`
**المسؤولية:** استعلامات BFS على الـ graph (impact, path, neighbourhood)، واستنتاجات مُشتقة (centrality, clustering). تعتمد على lib/db مباشرة.
**الحالة:** مكتملة. مُدمجة في api-server عبر مسارات /api/graph/*.

### الطبقة 3ج — طبقة الذكاء الاصطناعي (AI Intelligence Layer)
**الحزم:** `lib/ai-orchestrator`
**المسؤولية:** 5 وكلاء متخصصون (chat, task, scan-analyst, code-reviewer, workflow-orchestrator) يعملون بـ Groq (LLaMA 3.3-70b / 3.1-8b). يبني سياق المشروع من DB ويستعلم الـ LLM. مستقل — يمكن استخدامه من api-server أو أي حزمة أخرى.
**الحالة:** مكتملة. مُدمجة في api-server عبر /api/ai/*. لا streaming حالياً.

### الطبقة 4 — طبقة التنفيذ (Execution Layer)
**الحزم:** `artifacts/api-server`
**المسؤولية:** Express API server يُنسّق بين البيانات والتحليل والذكاء الاصطناعي والأعمال. يُشغّل scan jobs في الخلفية، ويطبق قرارات الـ workflow state machine، ويُوجِّه طلبات AI للوكلاء المناسبين، ويسجّل audit logs.
**الحالة:** مستقرة. Transaction boundaries صحيحة. Workflow state machine موجود. AI routing مكتمل.

### الطبقة 5 — طبقة العرض (Presentation Layer)
**الحزم:** `artifacts/dashboard`
**المسؤولية:** React SPA تعرض حالة النظام وتمكّن المستخدم من التفاعل مع الكيانات. تستهلك `lib/api-client-react` حصرًا.
**الحالة:** جزئية. صفحات موجودة لكل المجالات. Graph explorer يعمل. Workflow phase controls موجودة. Events filtering يعمل. يحتاج تعميقًا (Task #7).

### الطبقة 6 — طبقة المختبر (Sandbox Layer)
**الحزم:** `artifacts/mockup-sandbox`
**المسؤولية:** بيئة عرض مكوّنات منفصلة للتجريب البصري. ليست جزءًا من مسار المنتج الإنتاجي.
**الحالة:** مستقرة كأداة داخلية. الازدواجية مع dashboard في UI primitives مقصودة (sandbox مستقل).

---

## خريطة اعتماديات الحزم

```
artifacts/dashboard
  └── lib/api-client-react   (React Query hooks المولّدة)

artifacts/api-server
  ├── lib/db                 (DB instance + schema)
  ├── lib/scanner            (Analysis engines)
  ├── lib/knowledge-engine   (BFS graph queries + inference)
  ├── lib/ai-orchestrator    (AI agents + Groq client)
  └── lib/api-zod            (Zod schemas المولّدة من العقد)

lib/ai-orchestrator
  └── lib/db                 (يستعلم DB مباشرة لبناء ProjectContext)

lib/knowledge-engine
  └── lib/db                 (يستعلم graph_entities/graph_relationships)

lib/api-client-react
  └── lib/api-spec           (openapi.yaml → codegen)

lib/api-zod
  └── lib/api-spec           (openapi.yaml → codegen)

lib/scanner
  └── (لا اعتماديات داخلية — مستقل تمامًا)

lib/db
  └── (لا اعتماديات داخلية — يُصدَّر لـ api-server وlib/*)

lib/api-spec
  └── (مصدر الحقيقة — لا يعتمد على أي حزمة أخرى)

artifacts/mockup-sandbox
  └── (مستقل — لا يستهلك lib/* مباشرة)

scripts
  └── (أدوات مساعدة — لا اعتماديات داخلية)
```

**قاعدة الاتجاه:** الاعتماديات تتدفق من الأعلى (العرض) نحو الأسفل (العقد/البيانات). لا يجوز لـ `lib/db` أو `lib/scanner` أن يعتمدا على `artifacts/*`. لا يجوز لـ `lib/api-spec` أن يعتمد على أي حزمة أخرى. `lib/ai-orchestrator` و`lib/knowledge-engine` يعتمدان على `lib/db` فقط — لا على `artifacts/*`.

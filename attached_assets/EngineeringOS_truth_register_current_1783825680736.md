# EngineeringOS — سجل حقيقة تشغيلي مُحدّث

_مبني على الفحص الأعمق الحالي للحزمة. الملفات المولدة والأرشيفية جُمعت في صفوف directory-level عندما كان تكرارها حرفيًا لا يضيف قيمة تشغيلية، بينما الملفات السلوكية/المنطقية أُدرجت file-by-file._

## خلاصة سريعة
- إجمالي الملفات داخل الحزمة: **412**
- الملفات المصدرية/التشغيلية في السجل التالي: **140** صفًا
- السجل الكامل الملفي التفصيلي المرجعي موجود في `docs/fact-record.md`، وهذا المستند هو نسخة حالة تشغيلية مُحدّثة بصيغة: منجز / جزئي / مفقود / الدليل / الأثر / الخطوة التالية.

## معيار الحالة
- **منجز**: الملف موجود ويقوم بدوره كما يظهر من الفحص.
- **جزئي**: الملف موجود لكن توجد فجوة حوكمة/تكامل/تغطية واضحة.
- **مفقود**: الملف/السطح موجود شكليًا أو فارغ عمليًا ولا يؤدي الوظيفة المقصودة.

## الجذر

| الملف | الحالة | الدليل | الأثر | الخطوة التالية |
|---|---|---|---|---|
| .gitattributes | منجز | موجود ويضبط LFS لبعض الأصول الكبيرة. | يحافظ على إدارة الملفات الكبيرة داخل المستودع. | مراجعته فقط إذا أُضيفت أصول ثنائية جديدة. |
| .gitignore | منجز | موجود ويغطي مخرجات/أدوات التطوير. | يمنع تسرب الملفات المولدة أو المؤقتة. | تحديثه مع أي أداة أو مخرجات جديدة. |
| .npmrc | منجز | موجود ويضبط سلوك pnpm/npm على مستوى workspace. | يؤثر مباشرة على التثبيت وسلسلة الاعتمادات. | عدم تغييره إلا لسبب واضح في إدارة الحزم. |
| .replit | منجز | موجود ويعرّف تشغيل Replit وpostMerge. | يشغّل بيئة التطوير والنشر داخل Replit. | مزامنته مع أي تغيير في مسارات التشغيل. |
| .replitignore | منجز | موجود لتقليل ما يدخل في deploy image. | يخفّض حجم النشر ويمنع الأصول غير المرغوبة. | إضافة أي ملفات جديدة قد لا يلزم نشرها. |
| package.json | منجز | يحتوي scripts الحاسمة: codegen/typecheck/build/test. | يحكم دورة البناء والتحقق على مستوى المستودع. | تحديثه فقط عند إضافة حزم أو أوامر جديدة. |
| pnpm-lock.yaml | منجز | موجود كقفل لاعتمادات workspace. | يثبّت إصدارات الاعتماديات ويقلّل الانحراف. | تجديده عند تغيّر الاعتمادات فقط. |
| pnpm-workspace.yaml | جزئي | موجود ويحدد workspace، لكن يحتاج تنظيف أي مسارات قديمة غير مستخدمة. | أي drift هنا يؤثر على نطاق الحزم والتثبيت. | مراجعة المسارات غير الموجودة وإزالتها إن لزم. |
| replit.md | منجز | يوثّق التشغيل والبنية ومكان الملفات الأساسية. | يسهّل فهم المشروع سريعًا داخل Replit. | مواءمته مع كل تغيير في التشغيل أو البنية. |
| tsconfig.base.json | منجز | إعداد TypeScript موحّد للمستودع. | يطبع قواعد النوعية على جميع الحزم. | تحديثه بحذر لأن أثره شامل. |
| tsconfig.json | منجز | مراجع TypeScript الجذرية موجودة. | يضمن typecheck موحّد للحزم الأساسية. | إضافة أي حزمة جديدة للمراجع عند الحاجة. |

## docs

| الملف | الحالة | الدليل | الأثر | الخطوة التالية |
|---|---|---|---|---|
| docs/completion-plan.md | منجز | خطة مرحلية رسمية ترتب العمل من الداخل إلى الخارج. | تمنع البدء من الواجهة قبل تثبيت البيانات والتنفيذ. | مزامنته مع أي أسبقيات جديدة. |
| docs/fact-record.md | منجز | سجل الحقيقة الملفي موجود ومحدد آخر تحقق بتاريخ 2026-07-12. | هو المرجع الأدق لما هو موجود وما هو ناقص. | تحديثه مع كل تغيير فعلي في الكود. |

## .agents/memory

| الملف | الحالة | الدليل | الأثر | الخطوة التالية |
|---|---|---|---|---|
| .agents/memory/MEMORY.md | منجز | مذكرة ذاكرة تشغيلية موثقة في .agents/memory. | تحفظ قرارات التنفيذ وقواعده بين الجلسات. | مزامنتها مع الكود إذا تغيّر السلوك الموثق. |
| .agents/memory/audit-fixes.md | منجز | مذكرة ذاكرة تشغيلية موثقة في .agents/memory. | تحفظ قرارات التنفيذ وقواعده بين الجلسات. | مزامنتها مع الكود إذا تغيّر السلوك الموثق. |
| .agents/memory/clerk-auth-testing.md | منجز | مذكرة ذاكرة تشغيلية موثقة في .agents/memory. | تحفظ قرارات التنفيذ وقواعده بين الجلسات. | مزامنتها مع الكود إذا تغيّر السلوك الموثق. |
| .agents/memory/discovery-feature.md | منجز | مذكرة ذاكرة تشغيلية موثقة في .agents/memory. | تحفظ قرارات التنفيذ وقواعده بين الجلسات. | مزامنتها مع الكود إذا تغيّر السلوك الموثق. |
| .agents/memory/drizzle-error-wrapping.md | منجز | مذكرة ذاكرة تشغيلية موثقة في .agents/memory. | تحفظ قرارات التنفيذ وقواعده بين الجلسات. | مزامنتها مع الكود إذا تغيّر السلوك الموثق. |
| .agents/memory/engineeringos-completion-plan.md | منجز | مذكرة ذاكرة تشغيلية موثقة في .agents/memory. | تحفظ قرارات التنفيذ وقواعده بين الجلسات. | مزامنتها مع الكود إذا تغيّر السلوك الموثق. |
| .agents/memory/fk-atomic-claim-ordering.md | منجز | مذكرة ذاكرة تشغيلية موثقة في .agents/memory. | تحفظ قرارات التنفيذ وقواعده بين الجلسات. | مزامنتها مع الكود إذا تغيّر السلوك الموثق. |
| .agents/memory/imported-project-workflow-failures.md | منجز | مذكرة ذاكرة تشغيلية موثقة في .agents/memory. | تحفظ قرارات التنفيذ وقواعده بين الجلسات. | مزامنتها مع الكود إذا تغيّر السلوك الموثق. |
| .agents/memory/knowledge-engine.md | منجز | مذكرة ذاكرة تشغيلية موثقة في .agents/memory. | تحفظ قرارات التنفيذ وقواعده بين الجلسات. | مزامنتها مع الكود إذا تغيّر السلوك الموثق. |
| .agents/memory/orval-openapi-codegen.md | منجز | مذكرة ذاكرة تشغيلية موثقة في .agents/memory. | تحفظ قرارات التنفيذ وقواعده بين الجلسات. | مزامنتها مع الكود إذا تغيّر السلوك الموثق. |
| .agents/memory/scanner-ast-extraction.md | منجز | مذكرة ذاكرة تشغيلية موثقة في .agents/memory. | تحفظ قرارات التنفيذ وقواعده بين الجلسات. | مزامنتها مع الكود إذا تغيّر السلوك الموثق. |
| .agents/memory/testing-drift-checks.md | منجز | مذكرة ذاكرة تشغيلية موثقة في .agents/memory. | تحفظ قرارات التنفيذ وقواعده بين الجلسات. | مزامنتها مع الكود إذا تغيّر السلوك الموثق. |

## lib/api-spec

| الملف | الحالة | الدليل | الأثر | الخطوة التالية |
|---|---|---|---|---|
| lib/api-spec/openapi.yaml | منجز | العقد الرسمية للـ API ومصدر التوليد. | أي drift هنا ينعكس على الخادم والعميل. | تحديثه أولاً عند أي endpoint أو schema جديد. |
| lib/api-spec/orval.config.ts | منجز | تهيئة Orval لتوليد schemas/hooks من OpenAPI. | يضمن مسار التوليد الآلي. | مراجعته عند تغيير بنية التوليد. |
| lib/api-spec/package.json | منجز | حزمة التوليد موجودة. | تجمع أدوات codegen في مكان واحد. | لا يحتاج تغييرًا إلا مع توسّع التوليد. |

## lib/api-client-react

| الملف | الحالة | الدليل | الأثر | الخطوة التالية |
|---|---|---|---|---|
| lib/api-client-react/package.json | منجز | حزمة العميل موجودة. | تجمع اعتماديات عميل React Query. | تحديثها عند أي تغيير في أدوات التوليد. |
| lib/api-client-react/src/custom-fetch.ts | منجز | طبقة fetch مخصصة موجودة. | توحد سلوك الشبكة للعميل. | مراجعتها فقط إذا تغيّر auth أو النقل. |
| lib/api-client-react/src/generated/api.schemas.ts | منجز | schemas مولدة من OpenAPI. | تحقق type-safe للعميل. | إعادة توليدها عند أي contract drift. |
| lib/api-client-react/src/generated/api.ts | منجز | hooks/عميل مولد موجود. | واجهة الاستهلاك القياسية للـ API. | إعادة التوليد بعد أي تعديل في openapi.yaml. |
| lib/api-client-react/src/index.ts | منجز | نقطة تصدير موحدة للعميل. | يخفف فوضى الاستيراد. | إبقاؤه بسيطًا ومطابقًا للتوليد. |
| lib/api-client-react/tsconfig.json | منجز | إعداد TypeScript للحزمة موجود. | يضبط التحقق النوعي للحزمة. | تحديثه فقط إذا تغيّر أسلوب build. |

## lib/api-zod

| الملف | الحالة | الدليل | الأثر | الخطوة التالية |
|---|---|---|---|---|
| lib/api-zod/src/generated/* (90 ملفًا مولدًا) | منجز | موجودة ومولدة من OpenAPI عبر codegen. | تغذي التحقق النوعي في الخادم والعميل. | إعادة توليدها بعد أي تغيير في العقود والتأكد من عدم وجود drift. |
| lib/api-zod/package.json | منجز | حزمة Zod المولدة موجودة. | تجميع وتنظيم schemas في مكان واحد. | تحديثها مع أي تغيير في أدوات التوليد. |

## lib/db

| الملف | الحالة | الدليل | الأثر | الخطوة التالية |
|---|---|---|---|---|
| lib/db/drizzle.config.ts | منجز | إعداد Drizzle موجود. | يحدد سلوك الوصول والمزامنة للـ DB. | تحديثه فقط مع تغيير بيئة DB. |
| lib/db/package.json | منجز | حزمة DB موجودة. | تجمع اعتماديات و scripts قاعدة البيانات. | تعديلها عند تغيّر خطة migration. |
| lib/db/src/index.ts | منجز | نقطة تصدير DB موجودة. | توحد الاستيراد من طبقة البيانات. | إبقاؤها مرآة للـ schema. |
| lib/db/src/schema/index.ts | منجز | يجمع السكيمات المصدرة. | ينظم الطبقة البياناتية الموحدة. | إضافة أي سكيمة جديدة هنا. |
| lib/db/src/schema/projects.ts | منجز | كيان المشاريع موجود. | يربط rootPath والحالة والدرجات. | توسيع القيود عند الحاجة لصلاحيات أدق. |
| lib/db/src/schema/rules.ts | منجز | كيان القواعد موجود. | يسجل pattern/severity/hits. | إضافة حقول تحقق إذا توسعت القواعد. |
| lib/db/src/schema/tasks.ts | منجز | كيان المهام موجود. | يدير الحالة والتنفيذ والـ retry. | إضافة قيود أقوى إذا زادت المزامنة. |
| lib/db/src/schema/workflows.ts | منجز | تعريفات workflow موجودة. | أساس orchestration الحقيقي. | ربط phase/state بقيود أوضح إن لزم. |
| lib/db/src/schema/events.ts | منجز | أحداث المنصة موجودة. | يعطي traceability للتنفيذ. | توسيع أنواع الأحداث عند الحاجة. |
| lib/db/src/schema/metrics.ts | منجز | المقاييس موجودة. | يدعم قياس الصحة والجودة. | مراجعة دلالات المقاييس مع كل تجربة جديدة. |
| lib/db/src/schema/graph.ts | منجز | عقد graph موجودة. | تمكّن الknowledge layer. | توسيع provenance والـ confidence إن لزم. |
| lib/db/src/schema/scan_jobs.ts | منجز | جدول scan jobs موجود. | يدعم التنفيذ غير المتزامن وإعادة الاستكمال. | توسيع حالات الفشل/التعافي عند الحاجة. |
| lib/db/src/schema/discovery.ts | منجز | جلسات discovery موجودة. | أساس autonomous onboarding. | تدقيق حالات الجلسة عند أي تعديل في flow. |
| lib/db/src/schema/plugins.ts | منجز | كيان plugins موجود. | يربط analyzers/extensions. | توسيع نموذج العزل إذا انتقل runtime إلى host خارجي. |
| lib/db/src/schema/audit_logs.ts | منجز | سجل audit موجود. | يوثّق stateBefore/stateAfter والأثر. | توسيع أسطر التدقيق إذا زادت الحاجة للحوكمة. |
| lib/db/src/schema/task_logs.ts | منجز | سجل logs للمهام موجود. | يمنح تتبعًا زمنيًا للمهام. | إبقاء الـ log format موحدًا. |

## lib/scanner

| الملف | الحالة | الدليل | الأثر | الخطوة التالية |
|---|---|---|---|---|
| lib/scanner/package.json | منجز | حزمة scanner موجودة. | تجمع أدوات الفحص والتحليل. | لا تغيير إلا مع توسع اللغات أو المخرجات. |
| lib/scanner/src/file-walker.ts | منجز | يدعم walk لمجموعة لغات/ملفات متعددة. | أساس جمع الملفات وتحليلها. | توسيع قواعد الاستثناء إن ظهرت حالات جديدة. |
| lib/scanner/src/graph-extractor.ts | منجز | AST extraction للـ TS/JS وPython fallback موجود. | يرفع جودة الـ graph فوق regex فقط. | إضافة موصلات لغات إضافية عند الحاجة. |
| lib/scanner/src/rule-matcher.ts | منجز | منطق مطابقة القواعد موجود مع حواجز أمان. | يمنع regex مكلف أو غير منضبط. | إبقاء الحدود الأمنية صارمة. |
| lib/scanner/src/metrics-calc.ts | منجز | حساب metrics موجود. | يحوّل الفحص إلى مؤشرات قابلة للعرض. | مراجعة دلالة المقاييس مع التوسع. |
| lib/scanner/src/python-ast-script.py | منجز | سكربت AST لبايثون موجود. | يدعم تحليل Python خارج TypeScript. | إبقاؤه بسيطًا وموثوقًا. |
| lib/scanner/src/python-ast-script.ts | منجز | جسر تشغيل للسكربت موجود. | يوحّد استدعاء Python AST. | مراجعة التعامل مع الأخطاء التنفيذية. |
| lib/scanner/src/python-extractor.ts | منجز | مستخرج Python موجود. | يفيد graph extraction للبايثون. | توسيع قدراته عند الحاجة. |
| lib/scanner/src/index.ts | منجز | نقطة تصدير للـ scanner موجودة. | يسهّل الاستهلاك من server/other libs. | حفظها كواجهة مستقرة. |
| lib/scanner/src/__tests__/file-walker.test.ts | منجز | اختبارات file-walker موجودة. | تحمي سلوك walk والأنواع المدعومة. | إضافة حالات edge إضافية. |
| lib/scanner/src/__tests__/graph-extractor.test.ts | منجز | اختبارات graph extractor موجودة. | تحمي AST/regex extraction. | توسيع التغطية للغات/أنماط جديدة. |
| lib/scanner/src/__tests__/metrics-calc.test.ts | منجز | اختبارات metrics موجودة. | تحمي حساب المقاييس. | إضافة حالات لاختلافات الحزم الكبيرة. |
| lib/scanner/src/__tests__/rule-matcher.test.ts | منجز | اختبارات rule matcher موجودة. | تغطي التوافق والأمان. | إضافة حالات مطابقة أعقد. |

## lib/knowledge-engine

| الملف | الحالة | الدليل | الأثر | الخطوة التالية |
|---|---|---|---|---|
| lib/knowledge-engine/package.json | منجز | حزمة knowledge-engine موجودة. | تجمع طبقة الاستدلال والـ graph queries. | تحديثها مع توسع واجهات الاستعلام. |
| lib/knowledge-engine/src/index.ts | منجز | نقطة تصدير موجودة. | توحّد الاستهلاك من dashboard/server. | حفظها كـ public API ثابت. |
| lib/knowledge-engine/src/inference.ts | منجز | منطق inference موجود. | يُمكّن impact/path/summary. | توسيع الأنماط التحليلية عند الحاجة. |
| lib/knowledge-engine/src/queries.ts | منجز | استعلامات graph الأساسية موجودة. | تمكّن التحليل المعرفي فوق البيانات. | إضافة queries جديدة بحذر. |
| lib/knowledge-engine/src/types.ts | منجز | أنواع البيانات موجودة. | يضبط عقود طبقة المعرفة. | تحديثه مع أي schema جديد. |

## scripts

| الملف | الحالة | الدليل | الأثر | الخطوة التالية |
|---|---|---|---|---|
| scripts/check-codegen-drift.ts | منجز | حارس drift للتوليد موجود. | يمنع اختلاف OpenAPI عن generated code. | إبقاؤه في build/test gates. |
| scripts/post-merge.sh | منجز | post-merge hook موجود. | يساعد على مزامنة ما بعد الدمج. | تحديثه إذا تغيّرت خطوات التهيئة. |
| scripts/src/hello.ts | منجز | ملف helper/مثال موجود. | لا أثر تشغيلي كبير. | يبقى فقط إذا كان له استخدام فعلي. |
| scripts/package.json | منجز | حزمة scripts موجودة. | تجمع أدوات التشغيل المساعدة. | تحديثها مع أي سكربت جديد. |
| scripts/tsconfig.json | منجز | إعداد TypeScript موجود. | يضبط build لهذه الحزمة. | مراجعة بسيطة عند تغيير الأسلوب. |

## artifacts/api-server

| الملف | الحالة | الدليل | الأثر | الخطوة التالية |
|---|---|---|---|---|
| artifacts/api-server/package.json | منجز | حزمة الخادم موجودة. | تجمع اعتماديات الخادم وbuild. | تحديثها مع أي تغيير في backend stack. |
| artifacts/api-server/build.mjs | منجز | سكريبت بناء موجود. | يدعم بناء/esbuild للخادم. | تعديله فقط إذا تغيّر target أو output. |
| artifacts/api-server/src/app.ts | منجز | يحتوي helmet/rateLimit/cors/pino + clerk middleware. | يضبط الأمن والlogging والـ middleware الأساسية. | تضييق CORS/RBAC إذا خرج الاستخدام عن البيئة الداخلية. |
| artifacts/api-server/src/config.ts | منجز | إعدادات التشغيل موجودة. | تفصل config عن المنطق. | إضافة/تثبيت env vars الجديدة فقط. |
| artifacts/api-server/src/index.ts | منجز | entrypoint للخادم موجود. | يشغّل التطبيق الفعلي. | إبقاءه thin ومرآة للتشغيل. |
| artifacts/api-server/src/lib/audit.ts | منجز | طبقة audit موجودة. | توثّق state changes والأثر. | توسيع حقول audit عند الحاجة. |
| artifacts/api-server/src/lib/job-queue.ts | منجز | queue in-memory مع concurrency محدود موجود. | يدير jobs دون حجب الخادم. | الانتقال إلى worker/durable queue عند تضخم الحمل. |
| artifacts/api-server/src/lib/job-reconciliation.ts | منجز | reconciliation عند الإقلاع موجود. | يعالج الحالات العالقة بعد restart. | توسيع repair paths إذا ظهرت حالات جديدة. |
| artifacts/api-server/src/lib/logger.ts | منجز | logger مركزي موجود. | يوحد logging في الخادم. | الإبقاء على format متسق. |
| artifacts/api-server/src/lib/plugin-runtime.ts | منجز | plugin runtime داخلي موجود (6 analyzers in-process). | يضيف extensibility مباشرة على scan pipeline. | عزل/توسيع runtime إذا انتقلت المنصة لمضيف خارجي. |
| artifacts/api-server/src/lib/plugin-runtime.test.ts | منجز | اختبارات plugin runtime موجودة. | تحمي سلوك analyzers المدمجة. | إضافة حالات edge وتحليل أعمق. |
| artifacts/api-server/src/lib/scan-runner.ts | منجز | محرك scan والتنفيذ موجود. | هو قلب تحويل المشروع إلى بيانات/مهام/graph. | تقوية حالات الخطأ والتعافي والتوازي. |
| artifacts/api-server/src/middlewares/clerkProxyMiddleware.ts | منجز | middleware لتمرير/auth proxy موجود. | يربط Clerk بمسار الخادم. | مراجعته عند تغيير auth flow. |
| artifacts/api-server/src/middlewares/requireAuth.ts | جزئي | يوجد auth لكن الصلاحيات ما زالت coarse-grained ولا يوجد RBAC/project-scoped policies. | يوفر وصولًا عامًا للمصدَّقين لكن دون حوكمة دقيقة. | إضافة RBAC أو سياسات على مستوى المشروع/الدور. |
| artifacts/api-server/src/routes/health.ts | منجز | مسار health موجود. | يدعم فحوص التشغيل. | إبقاؤه بسيطًا ومباشرًا. |
| artifacts/api-server/src/routes/index.ts | منجز | مجمّع routes موجود. | يحافظ على ترتيب المسارات. | إضافة أي route جديد هنا. |
| artifacts/api-server/src/routes/dashboard.ts | منجز | مسار dashboard موجود. | يوفر overview للواجهة. | توسيع المقاييس إن لزم. |
| artifacts/api-server/src/routes/events.ts | منجز | مسار events موجود. | يخدم traceability الزمني. | إضافة tests إذا اتسعت أشكال الفلاتر. |
| artifacts/api-server/src/routes/graph.ts | منجز | مسار graph موجود. | يعرض knowledge-layer queries. | تقوية coverage للاستعلامات المعقدة. |
| artifacts/api-server/src/routes/graph.test.ts | منجز | اختبارات graph route موجودة. | تحمي البيانات/الاستعلامات المعروضة. | إضافة حالات path/impact/summary. |
| artifacts/api-server/src/routes/metrics.ts | منجز | مسار metrics موجود. | يوفر مؤشرات الصحة والجودة. | إضافة tests للـ edge cases. |
| artifacts/api-server/src/routes/metrics.test.ts | منجز | اختبارات metrics route موجودة. | تحمي حساب/عرض المقاييس. | توسيعها مع أي metric جديد. |
| artifacts/api-server/src/routes/plugins.ts | منجز | مسار plugins موجود. | يدير registries/analyzers. | تقوية العزل والأذونات إذا توسع النظام. |
| artifacts/api-server/src/routes/plugins.test.ts | منجز | اختبارات plugins route موجودة. | تحمي CRUD/analysis surfaces. | إضافة حالات فشل/تعافي. |
| artifacts/api-server/src/routes/projects.ts | منجز | مسار projects موجود مع scan orchestration. | Entry point حقيقي للمشروع إلى المنصة. | إضافة صلاحيات أدق على مستوى المشروع. |
| artifacts/api-server/src/routes/projects.test.ts | منجز | اختبارات projects route موجودة. | تحمي create/scan/status flows. | توسيعها لحالات race/rollback. |
| artifacts/api-server/src/routes/rules.ts | منجز | مسار rules موجود. | يحكم قواعد الجودة/التحقق. | تقوية اختبارات القراءة/الفلترة. |
| artifacts/api-server/src/routes/tasks.ts | منجز | مسار tasks موجود (execute/retry/rollback/logs). | يحوّل المهام إلى state machine تشغيلية. | زيادة اختبارات الحالات الانتقالية. |
| artifacts/api-server/src/routes/tasks.test.ts | منجز | اختبارات tasks route موجودة. | تحمي lifecycle للمهام. | إضافة حالات تنازع/retry. |
| artifacts/api-server/src/routes/workflows.ts | منجز | مسار workflows موجود (start/stop/advance/fail/retry). | يغذي orchestration engine الحقيقي. | زيادة coverage على الفشل وإعادة المحاولة. |
| artifacts/api-server/src/routes/workflows.test.ts | منجز | اختبارات workflows route موجودة. | تحمي state transitions. | إضافة حالات race والـ rollback. |
| artifacts/api-server/src/routes/discovery.ts | منجز | onboarding engine موجود مع sessions/import/quality/steps. | يمثل entry point لفهم المشروع قبل استيراده. | تقوية التوافق مع أي مصدر discovery جديد. |
| artifacts/api-server/src/routes/discovery.test.ts | منجز | اختبارات discovery route موجودة. | تحمي flow الاكتشاف والاستيراد. | إضافة حالات rootPath/atomic claim/failure. |

## artifacts/dashboard

| الملف | الحالة | الدليل | الأثر | الخطوة التالية |
|---|---|---|---|---|
| artifacts/dashboard/package.json | منجز | حزمة الواجهة موجودة. | تجميع اعتماديات الـ dashboard. | تحديثها مع أي stack change. |
| artifacts/dashboard/index.html | منجز | نقطة الدخول للواجهة موجودة. | تخدم تحميل التطبيق. | تحديثها فقط إذا تغيّر shell. |
| artifacts/dashboard/src/App.tsx | منجز | App root موجود. | يوحد routing/shell. | إبقاؤه thin. |
| artifacts/dashboard/src/main.tsx | منجز | entrypoint للواجهة موجود. | يشغّل التطبيق فعليًا. | حفظه بسيطًا. |
| artifacts/dashboard/src/lib/clerk.ts | منجز | تكامل Clerk موجود. | يربط auth بتجربة الواجهة. | مراجعته مع أي تغيير في auth flow. |
| artifacts/dashboard/src/lib/utils.ts | منجز | utilities مشتركة موجودة. | توحيد مساعدة الواجهة. | إبقاءه صغيرًا وثابتًا. |
| artifacts/dashboard/src/hooks/use-mobile.tsx | منجز | hook للجوال موجود. | يحسن UX المتجاوب. | تحديثه فقط إذا تغيّرت breakpoints. |
| artifacts/dashboard/src/hooks/use-toast.ts | منجز | hook للتنبيهات موجود. | يدعم feedback في الواجهة. | إبقاؤه متوافقًا مع نظام الإشعارات. |
| artifacts/dashboard/src/components/layout/Shell.tsx | منجز | shell رئيسي موجود. | يوحد التنقل والهيكل. | توصيل أي أدوات بحث/تنقل مستقبلية فيه. |
| artifacts/dashboard/src/components/layout/Sidebar.tsx | منجز | sidebar موجود. | يسهّل التنقل بين الصفحات. | إضافة عناصر جديدة عند توسع المنصة. |
| artifacts/dashboard/src/components/ui/* (55 ملفًا) | منجز | مكتبة UI primitives موجودة ومكتملة. | تعطي الواجهة عناصر جاهزة ومتسقة. | إبقاؤها كطبقة عرض فقط وعدم إدخال منطق أعمال. |
| artifacts/dashboard/src/pages/Dashboard.tsx | منجز | لوحة نظرة عامة موجودة. | تعكس الحالة التشغيلية الأعلى. | توسيعها بمرور الوقت فقط. |
| artifacts/dashboard/src/pages/DiscoverProjectWizard.tsx | منجز | wizard الاكتشاف موجود. | يجسّد onboarding الذكي للمشروع. | تقويته بتغذية راجعة أوضح عند الفشل. |
| artifacts/dashboard/src/pages/Events.tsx | منجز | صفحة events موجودة. | تدعم تتبع الأحداث. | توسيع الفلاتر إذا زاد السجل. |
| artifacts/dashboard/src/pages/Graph.tsx | منجز | صفحة graph موجودة وبها impact/edges/force layout. | تجسد طبقة المعرفة بصريًا. | تقوية الاستعلامات وتحسين الأداء عند تضخم graph. |
| artifacts/dashboard/src/pages/Landing.tsx | منجز | صفحة landing موجودة. | تمثل المدخل العام للمنصة. | تحديث الرسائل حسب نضج المنتج. |
| artifacts/dashboard/src/pages/Metrics.tsx | منجز | صفحة metrics موجودة. | تعرض مؤشرات الصحة والجودة. | ربطها بأي metric إضافي. |
| artifacts/dashboard/src/pages/ProjectDetail.tsx | منجز | تفاصيل المشروع موجودة. | تجمع summary/tasks/graph metrics. | توسيعها في حال إضافة KPIs جديدة. |
| artifacts/dashboard/src/pages/Projects.tsx | منجز | صفحة المشاريع موجودة وفيها Discover Project. | نقطة دخول تشغيلية أساسية. | توسيع search/filters/empty states. |
| artifacts/dashboard/src/pages/Rules.tsx | منجز | صفحة rules موجودة. | تعرض قواعد الجودة والتحقق. | توسيع التفاصيل أو الاقتراحات الآلية. |
| artifacts/dashboard/src/pages/SignIn.tsx | منجز | صفحة تسجيل الدخول موجودة. | تدعم auth UX. | مراجعتها فقط مع تغيّر مسار auth. |
| artifacts/dashboard/src/pages/SignUp.tsx | منجز | صفحة إنشاء الحساب موجودة. | تدعم onboarding. | مزامنتها مع auth provider. |
| artifacts/dashboard/src/pages/Tasks.tsx | منجز | صفحة tasks موجودة مع execute/retry/rollback/logs. | تجسد stateful task operations. | تقوية الإشارات البصرية للحالات الانتقالية. |
| artifacts/dashboard/src/pages/Workflows.tsx | منجز | صفحة workflows موجودة مع start/stop/advance/fail/retry. | تعرض orchestration engine عمليًا. | تحسين تجربة إدارة الـ phases. |
| artifacts/dashboard/src/pages/not-found.tsx | منجز | صفحة 404 موجودة. | تحسن سلوك التنقل عند المسارات المفقودة. | لا تغيير كبير. |

## artifacts/mockup-sandbox

| الملف | الحالة | الدليل | الأثر | الخطوة التالية |
|---|---|---|---|---|
| artifacts/mockup-sandbox/package.json | منجز | حزمة sandbox موجودة. | تمثل مساحة معاينة/تجريب منفصلة. | تحديثها إذا فُعّل registry التجريبي. |
| artifacts/mockup-sandbox/index.html | منجز | نقطة دخول الsandbox موجودة. | تشغّل المعاينة المستقلة. | إبقاؤها simple. |
| artifacts/mockup-sandbox/src/App.tsx | منجز | App موجود. | يشغّل sandbox. | إضافة فقط ما يخدم المعاينة. |
| artifacts/mockup-sandbox/mockupPreviewPlugin.ts | منجز | plugin للمعاينة موجود. | يربط sandbox بمحتوى preview. | توسيعه إذا تم ربط modules جديدة. |
| artifacts/mockup-sandbox/src/.generated/mockup-components.ts | مفقود | الملف موجود لكنه فارغ: modules = {}. | يعني أن registry التجريبي غير مفعّل فعليًا. | تعبئة الموديولات المولدة أو حذف السطح إن لم يعد مطلوبًا. |
| artifacts/mockup-sandbox/src/components/ui/* (55 ملفًا) | منجز | مكتبة UI primitives متكررة وموجودة. | تخدم sandbox كواجهة مستقلة. | إبقاؤها متزامنة مع dashboard أو تحويلها لمصدر مشترك. |

## attached_assets

| الملف | الحالة | الدليل | الأثر | الخطوة التالية |
|---|---|---|---|---|
| attached_assets/* (48 ملفًا من تقارير/PDF/سكرينشوت/zip ونسخ وسيطة) | منجز | الأرشيف يضم تقارير التحليل والخطط واللقطات والأرشيفات المضغوطة. | يحفظ أثر التحقيق والتخطيط ويمكن الرجوع إليه كمستندات دعم. | تنظيف التكرارات فقط إن لزم، مع الإبقاء على الأصول المرجعية. |

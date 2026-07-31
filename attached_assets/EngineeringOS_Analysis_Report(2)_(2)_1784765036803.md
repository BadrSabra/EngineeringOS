# EngineeringOS — تحليل هندسي شامل وخطة استكمال

## 1) الملخص التنفيذي

المستودع يمثل منصة هندسية متعددة الطبقات وليست تطبيقًا واحدًا: طبقة عقد contract-first، طبقة بيانات Drizzle/PostgreSQL، محرك scanner، knowledge engine، طبقة AI orchestration، API server تشغيلية، Dashboard React، ومجموعة وثائق/سجلات حوكمة تاريخية.

| المؤشر | القيمة |
| --- | --- |
| إجمالي الملفات | 825 |
| lib/ | 261 |
| artifacts/ | 237 |
| attached_assets/ | 251 |
| .agents/ | 40 |
| docs/ | 15 |
| scripts/ | 8 |
| ملفات الاختبار | 34 |
| تعريفات المسارات في API Server | 83 |
| مسارات OpenAPI | 65 |
| Schemas في OpenAPI | 96 |
| جداول Drizzle | 19 |
| صفحات Dashboard | 15 |
| مكوّنات UI في Dashboard | 55 |

أهم حقيقة تشغيلية: هناك فرق واضح بين **الوثائق التاريخية** و**المرجع الحالي**. الملف `docs/architecture.md` يعرّف نفسه كـ current truth baseline، بينما `docs/completion-plan.md` و`docs/fact-record.md` يعرّفان نفسيهما كسجلات تاريخية. الأرقام في بعض الوثائق القديمة لا تطابق الكود الحالي، لذلك لا ينبغي استخدامها كمرجع حال.


## 2) فهرس الملفات التي تمت قراءتها

| الدليل | عدد الملفات | مقروء بالكامل | غير مقروء بالكامل/ميتا فقط |
| --- | --- | --- | --- |
| .agents/ | 40 | 40 | 0 |
| artifacts/ | 237 | 237 | 0 |
| attached_assets/ | 251 | 215 | 36 |
| docs/ | 15 | 15 | 0 |
| lib/ | 261 | 261 | 0 |
| scripts/ | 8 | 8 | 0 |

ملاحظة: تم استخراج نص 779 ملفًا بنجاح. ملفات PNG وملفات الأرشيف ZIP لم تُقرأ semantically بالكامل، لكنها فُهرست بالاسم والميتا والـ manifest. ملفات PDF/DOCX/XLSX تم استخراج نصها واحتسابها ضمن المقروء بالكامل.


## 3) تحليل المشروع

الهدف الحقيقي للنظام هو تحويل المستودع البرمجي إلى **engineering intelligence platform**: يستخرج الحقيقة البنيوية من الكود والملفات، يبني graph ومعرفة قابلة للاستعلام، يوفّر AI assistance مبنيًا على السياق، ويُسقط ذلك على dashboard تشغيلية مع traceability كاملة.

المستخدمون المستهدفون الظاهرون من الملفات هم: مهندسو البرمجيات داخل فريق المنتج، مشغلو النظام/المسؤولون، ومستخدمون يتفاعلون مع مشاريعهم عبر dashboard، discovery wizard، tasks, workflows, graph, metrics, ai chat.

القيمة الأساسية التي يقدّمها النظام هي: فحص مشروع، استخراج graph، تشغيل قواعد، توليد مهام، تتبع أحداث وأثر تغييرات، ثم استخدام AI orchestration مع سياق حقيقي من المشروع.


## 4) تحليل المعمارية

### الطبقات والعلاقات


┌───────────────────────────────┐
│  artifacts/dashboard          │
│  React + Vite + Clerk + RQ    │
└───────────────┬───────────────┘
                │ HTTP /api
┌───────────────▼───────────────┐
│  artifacts/api-server         │
│  Express + auth + routes      │
│  jobs + audits + events       │
└───────┬──────────┬────────────┘
        │          │
        ▼          ▼
┌──────────────┐  ┌──────────────────────────┐
│ lib/db       │  │ lib/ai-orchestrator      │
│ Drizzle/PG   │  │ Groq/DeepSeek + prompts  │
└──────┬───────┘  └─────────────┬────────────┘
       │                        │
       ▼                        ▼
┌──────────────┐      ┌───────────────────────┐
│ lib/scanner  │      │ lib/knowledge-engine  │
│ AST/FS/rules │      │ graph queries/infer   │
└──────────────┘      └───────────────────────┘


| الطبقة | النطاق | المسؤولية | الحالة | أدلة مختصرة |
| --- | --- | --- | --- | --- |
| Contract layer | lib/api-spec, lib/api-zod, lib/api-client-react | OpenAPI → Orval → Zod → React Query client | مكتمل | عقد API واسع ومولّد، مع drift checks في CI |
| Data layer | lib/db | Drizzle schema + pg pool + schema exports | مكتمل جزئيًا | الجداول موجودة بوضوح، لكن لا توجد migration files واضحة داخل المستودع |
| Scanner | lib/scanner | AST/file walk/rules/graph/metrics + Python extractor | مكتمل | يوجد AST extraction حقيقي للـ TS/Python واختبارات |
| Knowledge engine | lib/knowledge-engine | Graph queries + inference + provenance-aware helpers | مكتمل | استعلامات ومعالجات معرفة pure ومقسّمة |
| AI orchestration | lib/ai-orchestrator | Agents, prompts, tools, schemas, Groq/DeepSeek clients | مكتمل جزئيًا | طبقة ناضجة مع اختبارات، لكنها معقّدة وفيها backoff/fallback paths متعددة |
| API server | artifacts/api-server | Express 5, auth, routes, jobs, audits, events | مكتمل | النقطة التشغيلية الرئيسية وفيها حراسة صلاحيات وbackground jobs |
| Dashboard | artifacts/dashboard | React 19 + Vite + Clerk + React Query | مكتمل جزئيًا | 15 صفحة و55 primitive UI، لكن لا توجد اختبارات dashboard |
| Mockup sandbox | artifacts/mockup-sandbox | Preview shell for mockups/components | تصميم فقط | يبدو بيئة عرض/تجريب وليست مسار إنتاج |
| Scripts/validation | scripts | truth-flow validation + codegen drift + bootstrap | مكتمل جزئيًا | بوابات حوكمة مهمة، لكن عددها محدود |
| Docs/governance | docs + .agents/memory + attached_assets | Truth baseline, backlog, analysis, historical records | مكتمل جزئيًا | هناك تمييز واضح بين current baseline و historical logs |

التواصل بين الطبقات يتم أساسًا عبر HTTP بين dashboard وAPI server، وعبر Drizzle/PostgreSQL بين الخادم والبيانات، وعبر imports داخلية بين API server وlib packages، وعبر generated contract surfaces بين OpenAPI/Zod/React Query، وعبر background job queue/reconciliation للتشغيل غير المتزامن.


## 5) تحليل الطبقات

| الطبقة | النطاق | المسؤولية | الحالة | أدلة مختصرة |
| --- | --- | --- | --- | --- |
| Contract layer | lib/api-spec, lib/api-zod, lib/api-client-react | OpenAPI → Orval → Zod → React Query client | مكتمل | عقد API واسع ومولّد، مع drift checks في CI |
| Data layer | lib/db | Drizzle schema + pg pool + schema exports | مكتمل جزئيًا | الجداول موجودة بوضوح، لكن لا توجد migration files واضحة داخل المستودع |
| Scanner | lib/scanner | AST/file walk/rules/graph/metrics + Python extractor | مكتمل | يوجد AST extraction حقيقي للـ TS/Python واختبارات |
| Knowledge engine | lib/knowledge-engine | Graph queries + inference + provenance-aware helpers | مكتمل | استعلامات ومعالجات معرفة pure ومقسّمة |
| AI orchestration | lib/ai-orchestrator | Agents, prompts, tools, schemas, Groq/DeepSeek clients | مكتمل جزئيًا | طبقة ناضجة مع اختبارات، لكنها معقّدة وفيها backoff/fallback paths متعددة |
| API server | artifacts/api-server | Express 5, auth, routes, jobs, audits, events | مكتمل | النقطة التشغيلية الرئيسية وفيها حراسة صلاحيات وbackground jobs |
| Dashboard | artifacts/dashboard | React 19 + Vite + Clerk + React Query | مكتمل جزئيًا | 15 صفحة و55 primitive UI، لكن لا توجد اختبارات dashboard |
| Mockup sandbox | artifacts/mockup-sandbox | Preview shell for mockups/components | تصميم فقط | يبدو بيئة عرض/تجريب وليست مسار إنتاج |
| Scripts/validation | scripts | truth-flow validation + codegen drift + bootstrap | مكتمل جزئيًا | بوابات حوكمة مهمة، لكن عددها محدود |
| Docs/governance | docs + .agents/memory + attached_assets | Truth baseline, backlog, analysis, historical records | مكتمل جزئيًا | هناك تمييز واضح بين current baseline و historical logs |

تفصيل موجز لكل طبقة:

- **Contract layer**: `lib/api-spec/openapi.yaml` هو المصدر الذي تُولَّد منه `lib/api-zod` و`lib/api-client-react`.

- **Data layer**: `lib/db` يوفّر `pool` و`db` ويصدّر schema tables مثل projects/tasks/workflows/events/graph/metrics/audit/etc.

- **Scanner**: `lib/scanner` ينفذ file-walk، rule matching، graph extraction، metrics، وPython AST subprocess extraction.

- **Knowledge engine**: `lib/knowledge-engine` يوفّر graph queries, shortest path, neighborhood, centrality, cluster detection, provenance-aware views.

- **AI orchestration**: `lib/ai-orchestrator` ينسّق chat/analyze/review/task/workflow عبر prompts + schemas + tools + Groq/DeepSeek clients.

- **API server**: `artifacts/api-server` يجمع auth, routes, audit, events, jobs, discovery, uploads, git integration, metrics, graph, plugins.

- **Dashboard**: `artifacts/dashboard` يوفّر صفحات التشغيل والإدارة. وجود `ClerkProvider` وReact Query وwouter واضح في `App.tsx`.

- **Mockup sandbox**: `artifacts/mockup-sandbox` مخصّص للمعاينة والتجريب البصري، وليس كمسار إنتاج أساسي.

- **Scripts**: حواجز drift وtruth validation وbootstrap verification.

- **Docs / historical corpus**: سجلات حقيقة/تحليل/Backlog/Execution Matrix، كثير منها تاريخي ويحتاج قراءة نقدية.


## 6) تحليل المكونات

| المكوّن | الطبقة | الحالة | تقدير الاكتمال | أدلة |
| --- | --- | --- | --- | --- |
| Monorepo governance/bootstrap | Root | مكتمل | 95% | package.json, pnpm-workspace.yaml, tsconfig.base.json, .replit, .npmrc, CI |
| API contract pipeline | Contract | مكتمل | 95% | openapi.yaml, orval.config.ts, lib/api-zod/generated, lib/api-client-react/generated |
| Database schema | Data | مكتمل جزئيًا | 80% | lib/db/src/schema/*.ts, drizzle.config.ts, db export |
| Scanner engine | Analysis | مكتمل | 90% | lib/scanner/src/* + tests |
| Knowledge engine | Analysis | مكتمل | 90% | lib/knowledge-engine/src/* |
| AI orchestrator | AI | مكتمل جزئيًا | 80% | agents, prompts, tools, clients, schemas, tests |
| API server runtime | Runtime | مكتمل | 90% | app.ts, index.ts, routes/*, middlewares/*, services/* |
| Discovery pipeline | Runtime | مكتمل جزئيًا | 80% | routes/discovery.ts, discovery-adapters.ts, discovery-runner.ts |
| Tasks/workflows/rules/events | Runtime | مكتمل جزئيًا | 85% | routes/tasks.ts, workflows.ts, rules.ts, events.ts + services |
| Dashboard application | UI | مكتمل جزئيًا | 75% | src/pages/*, components/*, Clerk, React Query |
| Mockup sandbox | UI | تصميم فقط | 30% | mockup-sandbox/* |
| CI/CD & validation | Ops | مكتمل جزئيًا | 70% | .github/workflows/ci.yml, scripts/*.ts, verify-setup.sh |

## 7) تحليل الكود

### نقاط الدخول الرئيسية

- `artifacts/api-server/src/index.ts` هو entry point للخادم.

- `artifacts/api-server/src/app.ts` يركّب middleware والـ routers.

- `artifacts/dashboard/src/main.tsx` و`artifacts/dashboard/src/App.tsx` هما entry points للواجهة.

- `artifacts/mockup-sandbox/src/main.tsx` و`src/App.tsx` لنموذج المعاينة.

- `scripts/validate-truth-flow.ts` و`scripts/check-codegen-drift.ts` بوابات تحقق تشغيلية.

- `lib/scanner/src/index.ts`, `lib/knowledge-engine/src/index.ts`, `lib/ai-orchestrator/src/index.ts`, `lib/db/src/index.ts` هي barrels للحزم المشتركة.


### مسارات التنفيذ والخدمات

- API server يعرّف routes ل`projects`, `tasks`, `rules`, `workflows`, `events`, `metrics`, `graph`, `discovery`, `plugins`, `ai`, `git`, `upload`, `health`.

- توجد خدمات domain منفصلة في `artifacts/api-server/src/services/task-service.ts` و`workflow-service.ts`.

- background execution يشمل `job-queue.ts`, `scan-runner.ts`, `discovery-runner.ts`, `job-reconciliation.ts`, `startup-migrations.ts`.

- auth مبني على Clerk مع `requireAuth` و`requireProjectAccess` ونسخة دفاعية إضافية داخل بعض الـ routers.

- logging مبني على `pino` و`pino-http` مع redaction للـ cookies/authorization.

- error handling يربط Zod validation errors بـ 400 ويحوّل باقي الأخطاء إلى 500، مع عدم تسريب التفاصيل في الإنتاج.


### الأحداث والتدقيق

- يوجد `eventsTable` و`recordAudit` في مسارات write المهمة مثل projects/tasks/rules/workflows/discovery/git/ai.

- `healthz` يفضح job queue stats و`operationalCounters`.

- `graph` و`metrics` و`events` تعكس traceability عبر المشروع.


### الاختبارات وCI/CD وأدوات البناء

- إجمالي ملفات الاختبار في المستودع: **34**.

- في API server وحده: **21** ملف اختبار.

- CI في `.github/workflows/ci.yml` يشغّل `codegen:check`, `typecheck`, `test` ويضيف fast-path drift guard للـ OpenAPI/generated surfaces.

- البناء يعتمد على pnpm monorepo، `esbuild` لخادم API، `vite` للواجهة، و`orval` لتوليد contract surfaces.


## 8) تحليل الوثائق

| الوثيقة | ماذا تشرح | تعكس الواقع الحالي؟ | ملاحظات/تناقضات | الحكم |
| --- | --- | --- | --- | --- |
| docs/architecture.md | مرجع المعمارية الحالي | نعم؛ يعرّف نفسه كـ current truth baseline | لا يظهر تعارض مباشر داخليًا | مرجع أساسي للتصنيف |
| docs/completion-plan.md | خطة استكمال مرحلية تاريخية | لا؛ يعرّف نفسه كسجل تاريخي | قديم بالتصريح | لا يُستخدم كمرجع حقيقة حالية |
| docs/fact-record.md | سجل حقيقة ملفًا ملفًا (historical phase log) | لا؛ يعرّف نفسه كسجل تاريخي | قد يتعارض مع counts الحالية | أقدم من الحالة الحالية |
| docs/PR_BACKLOG.md | قائمة PRs المغلقة/المفتوحة | جزئيًا؛ بعض البنود تشير إلى إغلاق PRs سابقة | تاريخي جزئيًا | يعكس أعمالًا مُغلقة سابقًا |
| docs/RUNTIME_EXECUTION_MATRIX.md | مصفوفة ربط UI/API/DB/events/tests | على الأغلب تاريخية/مرحلية | قديمة مقارنةً بالـ counts الحالية | مفيدة كأثر تشغيلي |
| docs/ENGINEERINGOS_MASTER_EXECUTION_CONSTITUTION.md | مرجع حوكمة/Truth Verification | نعم لكن بصيغة دستورية/معيارية | قد يخلط بين الحاضر والهدف | مفيد كمرجع governance |

أدلة على الوثائق التاريخية: `docs/EXECUTION_ALIGNMENT_REPORT.md` يذكر أرقامًا قديمة (595 ملفًا، 49 path في OpenAPI، 62 route declaration، 17 table)، بينما الفحص الحالي من المستودع يعطي أرقامًا أعلى/مختلفة: 825 ملفًا، 65 مسارًا في OpenAPI، 83 route declaration، 19 جدولًا. هذا تعارض واضح يؤكد أن الوثيقة تاريخية وليست baseline حالية.


## 9) تحليل الجودة

| البند | التقييم | السبب |
| --- | --- | --- |
| المعمارية | جيدة جدًا | فصل واضح بين العقد، البيانات، التحليل، التنفيذ، والواجهة |
| التنظيم | جيد | هيكل monorepo واضح، لكن corpus التوثيق كبير جدًا ويحتاج حوكمة أدق |
| التوثيق | جيد مع تعارضات تاريخية | يوجد baseline حديث، لكن توجد تقارير قديمة عديدة لا تتطابق أعدادها مع الكود الحالي |
| جودة الكود | جيدة | كثرة التعليقات التوضيحية، اختبارات موجودة في الحزم الحرجة |
| سهولة الصيانة | متوسطة إلى جيدة | الطبقات واضحة، لكن حجم المولدات والوثائق التاريخية يزيد الضجيج |
| القابلية للتوسع | جيدة | وجود queue، reconciliation، rate limiting، provenance، graph inference |
| الأمان | جيدة | Clerk auth، per-project access، rate limiting، encrypted credentials، helmet، cache-control |
| الاختبارات | متوسطة | يوجد 34 test files، لكن dashboard لا يظهر له test suite في المستودع الحالي |
| جاهزية الإنتاج | جيدة إلى متوسطة | الخوادم والـ CI موجودة، لكن job queue process-local والـ docs التاريخية قد تربك التشغيل |

## 10) تحليل الفجوات

| العنصر | الموجود فعليًا | المتوقع | الخطورة | الأولوية |
| --- | --- | --- | --- | --- |
| سجلّ التوثيق مقابل الكود | توجد وثائق تاريخية كثيرة وبعضها بأرقام قديمة | توحيد baseline واحد أو تعليم أوضح للفصل بين current/historical | متوسط | P1 |
| Job durability | queue داخل العملية مع reconciliation | durable queue خارج العملية أو ضمانات أقوى | عالٍ | P0/P1 |
| Dashboard tests | لا توجد ملفات test ظاهرة في dashboard | اختبارات component/page على الأقل للواجهات الحرجة | متوسط | P2 |
| Mockup sandbox | بيئة preview/design فقط | تأكيد scope: توثيق أنها ليست runtime أو نقلها إلى docs | منخفض إلى متوسط | P3 |
| Migration story | schema موجودة لكن لا تظهر migrations versioned داخل الريبو | إضافة migration flow أو توثيق push workflow بوضوح | متوسط | P1 |
| AI fallback complexity | طبقة orchestration متعددة retries/fallbacks | توحيد سياسة الأخطاء والـ telemetry | متوسط | P1/P2 |
| Generated surface drift | generated files كثيرة وحساسة للتزامن | الإبقاء على drift gate صارم في CI | عالي | P1 |
| Historical corpus size | attached_assets و .agents/memory ضخمان | فهرسة/أرشفة/تصنيف أوضح لتقليل الضجيج | متوسط | P2 |

## 11) إطار متابعة المشروع

### بطاقة حالة لكل مكوّن
أنسب طريقة متابعة هي بطاقة لكل مكوّن تحتوي: الاسم، الطبقة، الحالة، نسبة الإنجاز، الأولوية، المسؤول، آخر تحديث، المخاطر، الاعتماديات، والملفات المرجعية. هذه البطاقة يجب أن تُشتق من الملفات الحالية لا من الوصف النظري.

### مصفوفة ربط الوثائق
الروابط العملية هي: المتطلبات ← `docs/` و`attached_assets/*`، التصميم ← `docs/architecture.md` و`lib/api-spec/openapi.yaml`، الكود ← `artifacts/*` و`lib/*`، الاختبارات ← `**/*.test.ts`، المهام ← `docs/PR_BACKLOG.md` و`attached_assets/PR_BACKLOG_*`، والملفات المرجعية ← inventory appendix + CSV المرافق.

### دورة متابعة التقدم
1) مراجعة الوثائق  2) مراجعة الكود  3) تحديث حالة المكوّنات  4) اكتشاف الفجوات  5) إنشاء المهام  6) التنفيذ  7) التحقق  8) تحديث التوثيق.

### قالب تحويل الفجوات إلى مهام
لكل فجوة: عنوان، وصف، سبب، ملفات، اعتماديات، معايير قبول، أولوية، تقدير جهد. هذا القالب جاهز للتحويل إلى Jira/GitHub Projects.


## 12) خطة الاستكمال

### قصير المدى

| حقل | الوصف |
| --- | --- |
| الهدف | تثبيت الحقيقة الحالية وتشغيل الحواجز الحرجة فقط |
| سبب الأولوية | يمنع الانحراف بين العقد والكود ويقلل مخاطر التشغيل |
| المخرجات | وثيقة baseline واحدة، CI drift ثابت، ملخص فجوات موحد |
| المهام | مراجعة current/historical docs، تثبيت counts، إبقاء codegen drift check، ملاحظة job durability |
| الاعتماديات | openapi.yaml، generated code، docs/architecture.md، CI |
| المخاطر | التباس بين السجل التاريخي والحقيقة الحالية |
| طريقة التحقق | مقارنة counts الحالية مع الوثائق، وتشغيل validate/truth:validate |
| المهارات المطلوبة | Architecture review, TypeScript, CI |
| الزمن التقديري | قصير المدى |

### متوسط المدى

| حقل | الوصف |
| --- | --- |
| الهدف | رفع متانة التنفيذ الخلفي والحوكمة التشغيلية |
| سبب الأولوية | الجودة هنا تؤثر مباشرة على الفقد/التكرار/الثقة في النتائج |
| المخرجات | تحسين durability للمهام، توحيد audit/event semantics، تحسين الاختبارات |
| المهام | تقوية queue/durability، إضافة dashboard tests، توحيد error telemetry، تحسين migration story |
| الاعتماديات | job-reconciliation.ts, scan-runner.ts, workflows/tasks routes, db schema |
| المخاطر | تأثيرات جانبية على runtime الحالي أو تضارب مع قواعد الصلاحيات |
| طريقة التحقق | اختبارات route + integration + replay/reconciliation checks |
| المهارات المطلوبة | Node/Express, Drizzle, testing, reliability engineering |
| الزمن التقديري | متوسط المدى |

### طويل المدى

| حقل | الوصف |
| --- | --- |
| الهدف | تحويل النظام إلى truth-aware engineering intelligence platform أكثر نضجًا |
| سبب الأولوية | القيمة القصوى تأتي من ربط scan/graph/AI/events/provenance بشكل أعمق |
| المخرجات | تحليلات معرفة أقوى، provenance أعمق، واجهة تعكس الحقيقة الداخلية بشكل مباشر |
| المهام | تعميق KG, richer provenance, better AI workflows, better observability, archive governance |
| الاعتماديات | knowledge-engine, scanner, ai-orchestrator, API/events layer |
| المخاطر | زيادة التعقيد أو تضخم surface area بدون تحسينات ملموسة |
| طريقة التحقق | قياس الاتساق بين scan→graph→AI→events→UI ووجود traceability end-to-end |
| المهارات المطلوبة | Systems design, data modeling, graph/inference, AI orchestration |
| الزمن التقديري | طويل المدى |

## 13) سجل المخاطر

| الخطر | الوصف | الأثر | التخفيف الحالي |
| --- | --- | --- | --- |
| Lost in-flight jobs on restart | Process-local queue can lose running work on crash | Medium/High | Advisory locks + reconciliation reduce, but do not eliminate |
| Documentation drift | Historical docs differ from current counts and may mislead | Medium | Label historical docs clearly and rely on architecture.md |
| Generated-code drift | OpenAPI changes can desync client/schema | High | Keep codegen drift checks in CI |
| Credential handling failures | AI provider keys are sensitive | High | Encrypted storage and redaction already present; keep audits |
| Dashboard blind spots | No explicit tests in dashboard tree | Medium | Add smoke/component tests for critical routes/pages |

## 14) قائمة الافتراضات غير المؤكدة

| الافتراض | الحكم |
| --- | --- |
| الملفات النصية/البرمجية في الأرشيف قُرئت بالكامل | نعم |
| ملفات PNG والـ zip فُحِصت semantically بالكامل | لا؛ تم فهرستها بالاسم/الميتا والـ manifest فقط |
| الوثائق في docs/ هي مصدر الحقيقة الحالية | ليس كلها؛ architecture.md فقط يقدّم نفسه كبلاينس حديث، والبقية بعضها historical |
| الاستنتاجات عن الحالة التشغيلية مبنية على ملفات المشروع فقط | نعم |

أهم افتراض غير مؤكد: أن كل الأصول البصرية والـ zip snapshots لا تحتاج تفكيكًا semantically داخل هذا التقرير. تم التعامل معها كأصول/لقطات تاريخية، لكن لم تُعاد قراءة محتوياتها المكررة بالكامل لأنها snapshots وليست surfaces تشغيلية جديدة.


## 15) ملحق يحتوي على جميع الملفات التي تم تحليلها

الملف الكامل لكل المسارات موجود أيضًا في CSV مرفق منفصل لسهولة التصفية والفرز. الجدول التالي يدرج كل الملفات المُحللة بحسب الدليل الأعلى، مع النوع، الغرض المتوقع، وحالة القراءة.


### .agents/

| المسار | النوع | الغرض المتوقع | مقروء بالكامل |
| --- | --- | --- | --- |
| .agents/agent_assets_metadata.toml | config/design asset | ملف مشروع | نعم |
| .agents/memory/MEMORY.md | documentation / data | مذكرة ذاكرة/سجل قرار تاريخي | نعم |
| .agents/memory/ai-orchestrator-gap-closure.md | documentation / data | مذكرة ذاكرة/سجل قرار تاريخي | نعم |
| .agents/memory/ai-orchestrator-hardening.md | documentation / data | مذكرة ذاكرة/سجل قرار تاريخي | نعم |
| .agents/memory/ai-orchestrator-layer.md | documentation / data | مذكرة ذاكرة/سجل قرار تاريخي | نعم |
| .agents/memory/ai-tool-calling.md | documentation / data | مذكرة ذاكرة/سجل قرار تاريخي | نعم |
| .agents/memory/audit-fixes.md | documentation / data | مذكرة ذاكرة/سجل قرار تاريخي | نعم |
| .agents/memory/clerk-401-race-cookie-vs-bearer.md | documentation / data | مذكرة ذاكرة/سجل قرار تاريخي | نعم |
| .agents/memory/clerk-auth-testing.md | documentation / data | مذكرة ذاكرة/سجل قرار تاريخي | نعم |
| .agents/memory/completion-plan-stale-backlog.md | documentation / data | مذكرة ذاكرة/سجل قرار تاريخي | نعم |
| .agents/memory/context-cache-invalidation-rule.md | documentation / data | مذكرة ذاكرة/سجل قرار تاريخي | نعم |
| .agents/memory/dashboard-scoping-pr01.md | documentation / data | مذكرة ذاكرة/سجل قرار تاريخي | نعم |
| .agents/memory/discovery-adapter-registry.md | documentation / data | مذكرة ذاكرة/سجل قرار تاريخي | نعم |
| .agents/memory/discovery-feature.md | documentation / data | مذكرة ذاكرة/سجل قرار تاريخي | نعم |
| .agents/memory/discovery-multi-source.md | documentation / data | مذكرة ذاكرة/سجل قرار تاريخي | نعم |
| .agents/memory/drizzle-error-wrapping.md | documentation / data | مذكرة ذاكرة/سجل قرار تاريخي | نعم |
| .agents/memory/engineeringos-completion-plan.md | documentation / data | مذكرة ذاكرة/سجل قرار تاريخي | نعم |
| .agents/memory/fk-atomic-claim-ordering.md | documentation / data | مذكرة ذاكرة/سجل قرار تاريخي | نعم |
| .agents/memory/forensic-audit-batch.md | documentation / data | مذكرة ذاكرة/سجل قرار تاريخي | نعم |
| .agents/memory/forensic-audit-pr01-06.md | documentation / data | مذكرة ذاكرة/سجل قرار تاريخي | نعم |
| .agents/memory/gap-analysis-fixes-batch1.md | documentation / data | مذكرة ذاكرة/سجل قرار تاريخي | نعم |
| .agents/memory/gap-analysis-fixes-batch2.md | documentation / data | مذكرة ذاكرة/سجل قرار تاريخي | نعم |
| .agents/memory/git-ai-orchestrator-fixes.md | documentation / data | مذكرة ذاكرة/سجل قرار تاريخي | نعم |
| .agents/memory/imported-project-clerk-secrets.md | documentation / data | مذكرة ذاكرة/سجل قرار تاريخي | نعم |
| .agents/memory/imported-project-workflow-failures.md | documentation / data | مذكرة ذاكرة/سجل قرار تاريخي | نعم |
| .agents/memory/knowledge-engine-bfs-depth.md | documentation / data | مذكرة ذاكرة/سجل قرار تاريخي | نعم |
| .agents/memory/knowledge-engine.md | documentation / data | مذكرة ذاكرة/سجل قرار تاريخي | نعم |
| .agents/memory/orval-openapi-codegen.md | documentation / data | مذكرة ذاكرة/سجل قرار تاريخي | نعم |
| .agents/memory/pr-c-ai-autotrigger.md | documentation / data | مذكرة ذاكرة/سجل قرار تاريخي | نعم |
| .agents/memory/pr-d-workflow-conditions.md | documentation / data | مذكرة ذاكرة/سجل قرار تاريخي | نعم |
| .agents/memory/pr-d1-job-queue-durability.md | documentation / data | مذكرة ذاكرة/سجل قرار تاريخي | نعم |
| .agents/memory/pr-h-i-completion.md | documentation / data | مذكرة ذاكرة/سجل قرار تاريخي | نعم |
| .agents/memory/pr01-job-durability.md | documentation / data | مذكرة ذاكرة/سجل قرار تاريخي | نعم |
| .agents/memory/pr02-provenance-layer.md | documentation / data | مذكرة ذاكرة/سجل قرار تاريخي | نعم |
| .agents/memory/pr04-discovery-hardening.md | documentation / data | مذكرة ذاكرة/سجل قرار تاريخي | نعم |
| .agents/memory/project-bootstrap.md | documentation / data | مذكرة ذاكرة/سجل قرار تاريخي | نعم |
| .agents/memory/project-ownership-scoping.md | documentation / data | مذكرة ذاكرة/سجل قرار تاريخي | نعم |
| .agents/memory/scanner-ast-extraction.md | documentation / data | مذكرة ذاكرة/سجل قرار تاريخي | نعم |
| .agents/memory/testing-drift-checks.md | documentation / data | مذكرة ذاكرة/سجل قرار تاريخي | نعم |
| .agents/memory/trace-analysis.md | documentation / data | مذكرة ذاكرة/سجل قرار تاريخي | نعم |

### artifacts/

| المسار | النوع | الغرض المتوقع | مقروء بالكامل |
| --- | --- | --- | --- |
| artifacts/api-server/.replit-artifact/artifact.toml | config/design asset | ملف خادم | نعم |
| artifacts/api-server/build.mjs | code | ملف خادم | نعم |
| artifacts/api-server/package.json | config/design asset | ملف خادم | نعم |
| artifacts/api-server/src/app.ts | code | نقطة دخول/تهيئة الخادم | نعم |
| artifacts/api-server/src/config.ts | code | نقطة دخول/تهيئة الخادم | نعم |
| artifacts/api-server/src/index.ts | code | نقطة دخول/تهيئة الخادم | نعم |
| artifacts/api-server/src/lib/.gitkeep | other | مساعدة خادمية / jobs / validation / logging | نعم |
| artifacts/api-server/src/lib/advisory-lock.ts | code | مساعدة خادمية / jobs / validation / logging | نعم |
| artifacts/api-server/src/lib/ai-route-helpers.ts | code | مساعدة خادمية / jobs / validation / logging | نعم |
| artifacts/api-server/src/lib/audit.ts | code | مساعدة خادمية / jobs / validation / logging | نعم |
| artifacts/api-server/src/lib/condition-evaluator.ts | code | مساعدة خادمية / jobs / validation / logging | نعم |
| artifacts/api-server/src/lib/credentials-crypto.ts | code | مساعدة خادمية / jobs / validation / logging | نعم |
| artifacts/api-server/src/lib/db-rate-limiter.ts | code | مساعدة خادمية / jobs / validation / logging | نعم |
| artifacts/api-server/src/lib/discovery-adapters.test.ts | code | مساعدة خادمية / jobs / validation / logging | نعم |
| artifacts/api-server/src/lib/discovery-adapters.ts | code | مساعدة خادمية / jobs / validation / logging | نعم |
| artifacts/api-server/src/lib/discovery-runner.ts | code | مساعدة خادمية / jobs / validation / logging | نعم |
| artifacts/api-server/src/lib/graph-provenance.ts | code | مساعدة خادمية / jobs / validation / logging | نعم |
| artifacts/api-server/src/lib/job-queue.test.ts | code | مساعدة خادمية / jobs / validation / logging | نعم |
| artifacts/api-server/src/lib/job-queue.ts | code | مساعدة خادمية / jobs / validation / logging | نعم |
| artifacts/api-server/src/lib/job-reconciliation.test.ts | code | مساعدة خادمية / jobs / validation / logging | نعم |
| artifacts/api-server/src/lib/job-reconciliation.ts | code | مساعدة خادمية / jobs / validation / logging | نعم |
| artifacts/api-server/src/lib/logger.ts | code | مساعدة خادمية / jobs / validation / logging | نعم |
| artifacts/api-server/src/lib/operational-counters.ts | code | مساعدة خادمية / jobs / validation / logging | نعم |
| artifacts/api-server/src/lib/path-validation.test.ts | code | مساعدة خادمية / jobs / validation / logging | نعم |
| artifacts/api-server/src/lib/path-validation.ts | code | مساعدة خادمية / jobs / validation / logging | نعم |
| artifacts/api-server/src/lib/plugin-runtime.test.ts | code | مساعدة خادمية / jobs / validation / logging | نعم |
| artifacts/api-server/src/lib/plugin-runtime.ts | code | مساعدة خادمية / jobs / validation / logging | نعم |
| artifacts/api-server/src/lib/project-error.test.ts | code | مساعدة خادمية / jobs / validation / logging | نعم |
| artifacts/api-server/src/lib/rootpath-validator.ts | code | مساعدة خادمية / jobs / validation / logging | نعم |
| artifacts/api-server/src/lib/scan-runner.ts | code | مساعدة خادمية / jobs / validation / logging | نعم |
| artifacts/api-server/src/lib/startup-migrations.ts | code | مساعدة خادمية / jobs / validation / logging | نعم |
| artifacts/api-server/src/lib/upload-store.test.ts | code | مساعدة خادمية / jobs / validation / logging | نعم |
| artifacts/api-server/src/lib/upload-store.ts | code | مساعدة خادمية / jobs / validation / logging | نعم |
| artifacts/api-server/src/middlewares/.gitkeep | other | Middleware للمصادقة/الصلاحيات | نعم |
| artifacts/api-server/src/middlewares/clerkProxyMiddleware.ts | code | Middleware للمصادقة/الصلاحيات | نعم |
| artifacts/api-server/src/middlewares/requireAuth.test.ts | code | Middleware للمصادقة/الصلاحيات | نعم |
| artifacts/api-server/src/middlewares/requireAuth.ts | code | Middleware للمصادقة/الصلاحيات | نعم |
| artifacts/api-server/src/middlewares/requireProjectAccess.ts | code | Middleware للمصادقة/الصلاحيات | نعم |
| artifacts/api-server/src/routes/ai-route-parity.test.ts | code | مسار API خادمي | نعم |
| artifacts/api-server/src/routes/ai.test.ts | code | مسار API خادمي | نعم |
| artifacts/api-server/src/routes/ai.ts | code | مسار API خادمي | نعم |
| artifacts/api-server/src/routes/ai/analysis.ts | code | مسار API خادمي | نعم |
| artifacts/api-server/src/routes/ai/chat.ts | code | مسار API خادمي | نعم |
| artifacts/api-server/src/routes/ai/index.ts | code | مسار API خادمي | نعم |
| artifacts/api-server/src/routes/ai/providers.ts | code | مسار API خادمي | نعم |
| artifacts/api-server/src/routes/ai/tasks.ts | code | مسار API خادمي | نعم |
| artifacts/api-server/src/routes/ai/workflows.ts | code | مسار API خادمي | نعم |
| artifacts/api-server/src/routes/dashboard.test.ts | code | مسار API خادمي | نعم |
| artifacts/api-server/src/routes/dashboard.ts | code | مسار API خادمي | نعم |
| artifacts/api-server/src/routes/discovery.test.ts | code | مسار API خادمي | نعم |
| artifacts/api-server/src/routes/discovery.ts | code | مسار API خادمي | نعم |
| artifacts/api-server/src/routes/events.test.ts | code | مسار API خادمي | نعم |
| artifacts/api-server/src/routes/events.ts | code | مسار API خادمي | نعم |
| artifacts/api-server/src/routes/git.ts | code | مسار API خادمي | نعم |
| artifacts/api-server/src/routes/graph.test.ts | code | مسار API خادمي | نعم |
| artifacts/api-server/src/routes/graph.ts | code | مسار API خادمي | نعم |
| artifacts/api-server/src/routes/health.test.ts | code | مسار API خادمي | نعم |
| artifacts/api-server/src/routes/health.ts | code | مسار API خادمي | نعم |
| artifacts/api-server/src/routes/index.ts | code | مسار API خادمي | نعم |
| artifacts/api-server/src/routes/metrics.test.ts | code | مسار API خادمي | نعم |
| artifacts/api-server/src/routes/metrics.ts | code | مسار API خادمي | نعم |
| artifacts/api-server/src/routes/plugins.test.ts | code | مسار API خادمي | نعم |
| artifacts/api-server/src/routes/plugins.ts | code | مسار API خادمي | نعم |
| artifacts/api-server/src/routes/projects.test.ts | code | مسار API خادمي | نعم |
| artifacts/api-server/src/routes/projects.ts | code | مسار API خادمي | نعم |
| artifacts/api-server/src/routes/rules.test.ts | code | مسار API خادمي | نعم |
| artifacts/api-server/src/routes/rules.ts | code | مسار API خادمي | نعم |
| artifacts/api-server/src/routes/tasks.test.ts | code | مسار API خادمي | نعم |
| artifacts/api-server/src/routes/tasks.ts | code | مسار API خادمي | نعم |
| artifacts/api-server/src/routes/upload.ts | code | مسار API خادمي | نعم |
| artifacts/api-server/src/routes/workflows.test.ts | code | مسار API خادمي | نعم |
| artifacts/api-server/src/routes/workflows.ts | code | مسار API خادمي | نعم |
| artifacts/api-server/src/scripts/seed-provenance.ts | code | ملف خادم | نعم |
| artifacts/api-server/src/services/task-service.ts | code | خدمة domain | نعم |
| artifacts/api-server/src/services/workflow-service.ts | code | خدمة domain | نعم |
| artifacts/api-server/src/types/express.d.ts | code | ملف خادم | نعم |
| artifacts/api-server/tsconfig.json | config/design asset | ملف خادم | نعم |
| artifacts/api-server/vitest.config.ts | code | ملف خادم | نعم |
| artifacts/dashboard/.replit-artifact/artifact.toml | config/design asset | واجهة | نعم |
| artifacts/dashboard/components.json | config/design asset | إعدادات الواجهة | نعم |
| artifacts/dashboard/index.html | config/design asset | إعدادات الواجهة | نعم |
| artifacts/dashboard/package.json | config/design asset | واجهة | نعم |
| artifacts/dashboard/public/favicon.svg | config/design asset | واجهة | نعم |
| artifacts/dashboard/public/logo.svg | config/design asset | واجهة | نعم |
| artifacts/dashboard/public/robots.txt | documentation / data | واجهة | نعم |
| artifacts/dashboard/src/App.tsx | code | واجهة | نعم |
| artifacts/dashboard/src/components/GitPanel.tsx | code | مكوّن واجهة | نعم |
| artifacts/dashboard/src/components/layout/Shell.tsx | code | مكوّن تخطيط | نعم |
| artifacts/dashboard/src/components/layout/Sidebar.tsx | code | مكوّن تخطيط | نعم |
| artifacts/dashboard/src/components/ui/accordion.tsx | code | مكوّن UI أساسي | نعم |
| artifacts/dashboard/src/components/ui/alert-dialog.tsx | code | مكوّن UI أساسي | نعم |
| artifacts/dashboard/src/components/ui/alert.tsx | code | مكوّن UI أساسي | نعم |
| artifacts/dashboard/src/components/ui/aspect-ratio.tsx | code | مكوّن UI أساسي | نعم |
| artifacts/dashboard/src/components/ui/avatar.tsx | code | مكوّن UI أساسي | نعم |
| artifacts/dashboard/src/components/ui/badge.tsx | code | مكوّن UI أساسي | نعم |
| artifacts/dashboard/src/components/ui/breadcrumb.tsx | code | مكوّن UI أساسي | نعم |
| artifacts/dashboard/src/components/ui/button-group.tsx | code | مكوّن UI أساسي | نعم |
| artifacts/dashboard/src/components/ui/button.tsx | code | مكوّن UI أساسي | نعم |
| artifacts/dashboard/src/components/ui/calendar.tsx | code | مكوّن UI أساسي | نعم |
| artifacts/dashboard/src/components/ui/card.tsx | code | مكوّن UI أساسي | نعم |
| artifacts/dashboard/src/components/ui/carousel.tsx | code | مكوّن UI أساسي | نعم |
| artifacts/dashboard/src/components/ui/chart.tsx | code | مكوّن UI أساسي | نعم |
| artifacts/dashboard/src/components/ui/checkbox.tsx | code | مكوّن UI أساسي | نعم |
| artifacts/dashboard/src/components/ui/collapsible.tsx | code | مكوّن UI أساسي | نعم |
| artifacts/dashboard/src/components/ui/command.tsx | code | مكوّن UI أساسي | نعم |
| artifacts/dashboard/src/components/ui/context-menu.tsx | code | مكوّن UI أساسي | نعم |
| artifacts/dashboard/src/components/ui/dialog.tsx | code | مكوّن UI أساسي | نعم |
| artifacts/dashboard/src/components/ui/drawer.tsx | code | مكوّن UI أساسي | نعم |
| artifacts/dashboard/src/components/ui/dropdown-menu.tsx | code | مكوّن UI أساسي | نعم |
| artifacts/dashboard/src/components/ui/empty.tsx | code | مكوّن UI أساسي | نعم |
| artifacts/dashboard/src/components/ui/field.tsx | code | مكوّن UI أساسي | نعم |
| artifacts/dashboard/src/components/ui/form.tsx | code | مكوّن UI أساسي | نعم |
| artifacts/dashboard/src/components/ui/hover-card.tsx | code | مكوّن UI أساسي | نعم |
| artifacts/dashboard/src/components/ui/input-group.tsx | code | مكوّن UI أساسي | نعم |
| artifacts/dashboard/src/components/ui/input-otp.tsx | code | مكوّن UI أساسي | نعم |
| artifacts/dashboard/src/components/ui/input.tsx | code | مكوّن UI أساسي | نعم |
| artifacts/dashboard/src/components/ui/item.tsx | code | مكوّن UI أساسي | نعم |
| artifacts/dashboard/src/components/ui/kbd.tsx | code | مكوّن UI أساسي | نعم |
| artifacts/dashboard/src/components/ui/label.tsx | code | مكوّن UI أساسي | نعم |
| artifacts/dashboard/src/components/ui/menubar.tsx | code | مكوّن UI أساسي | نعم |
| artifacts/dashboard/src/components/ui/navigation-menu.tsx | code | مكوّن UI أساسي | نعم |
| artifacts/dashboard/src/components/ui/pagination.tsx | code | مكوّن UI أساسي | نعم |
| artifacts/dashboard/src/components/ui/popover.tsx | code | مكوّن UI أساسي | نعم |
| artifacts/dashboard/src/components/ui/progress.tsx | code | مكوّن UI أساسي | نعم |
| artifacts/dashboard/src/components/ui/radio-group.tsx | code | مكوّن UI أساسي | نعم |
| artifacts/dashboard/src/components/ui/resizable.tsx | code | مكوّن UI أساسي | نعم |
| artifacts/dashboard/src/components/ui/scroll-area.tsx | code | مكوّن UI أساسي | نعم |
| artifacts/dashboard/src/components/ui/select.tsx | code | مكوّن UI أساسي | نعم |
| artifacts/dashboard/src/components/ui/separator.tsx | code | مكوّن UI أساسي | نعم |
| artifacts/dashboard/src/components/ui/sheet.tsx | code | مكوّن UI أساسي | نعم |
| artifacts/dashboard/src/components/ui/sidebar.tsx | code | مكوّن UI أساسي | نعم |
| artifacts/dashboard/src/components/ui/skeleton.tsx | code | مكوّن UI أساسي | نعم |
| artifacts/dashboard/src/components/ui/slider.tsx | code | مكوّن UI أساسي | نعم |
| artifacts/dashboard/src/components/ui/sonner.tsx | code | مكوّن UI أساسي | نعم |
| artifacts/dashboard/src/components/ui/spinner.tsx | code | مكوّن UI أساسي | نعم |
| artifacts/dashboard/src/components/ui/switch.tsx | code | مكوّن UI أساسي | نعم |
| artifacts/dashboard/src/components/ui/table.tsx | code | مكوّن UI أساسي | نعم |
| artifacts/dashboard/src/components/ui/tabs.tsx | code | مكوّن UI أساسي | نعم |
| artifacts/dashboard/src/components/ui/textarea.tsx | code | مكوّن UI أساسي | نعم |
| artifacts/dashboard/src/components/ui/toast.tsx | code | مكوّن UI أساسي | نعم |
| artifacts/dashboard/src/components/ui/toaster.tsx | code | مكوّن UI أساسي | نعم |
| artifacts/dashboard/src/components/ui/toggle-group.tsx | code | مكوّن UI أساسي | نعم |
| artifacts/dashboard/src/components/ui/toggle.tsx | code | مكوّن UI أساسي | نعم |
| artifacts/dashboard/src/components/ui/tooltip.tsx | code | مكوّن UI أساسي | نعم |
| artifacts/dashboard/src/hooks/use-mobile.tsx | code | واجهة | نعم |
| artifacts/dashboard/src/hooks/use-toast.ts | code | واجهة | نعم |
| artifacts/dashboard/src/index.css | config/design asset | واجهة | نعم |
| artifacts/dashboard/src/lib/api-fetch.ts | code | مساعدة للواجهة | نعم |
| artifacts/dashboard/src/lib/clerk.ts | code | مساعدة للواجهة | نعم |
| artifacts/dashboard/src/lib/utils.ts | code | مساعدة للواجهة | نعم |
| artifacts/dashboard/src/main.tsx | code | واجهة | نعم |
| artifacts/dashboard/src/pages/AiChat.tsx | code | صفحة واجهة | نعم |
| artifacts/dashboard/src/pages/Dashboard.tsx | code | صفحة واجهة | نعم |
| artifacts/dashboard/src/pages/DiscoverProjectWizard.tsx | code | صفحة واجهة | نعم |
| artifacts/dashboard/src/pages/Events.tsx | code | صفحة واجهة | نعم |
| artifacts/dashboard/src/pages/Graph.tsx | code | صفحة واجهة | نعم |
| artifacts/dashboard/src/pages/Landing.tsx | code | صفحة واجهة | نعم |
| artifacts/dashboard/src/pages/Metrics.tsx | code | صفحة واجهة | نعم |
| artifacts/dashboard/src/pages/ProjectDetail.tsx | code | صفحة واجهة | نعم |
| artifacts/dashboard/src/pages/Projects.tsx | code | صفحة واجهة | نعم |
| artifacts/dashboard/src/pages/Rules.tsx | code | صفحة واجهة | نعم |
| artifacts/dashboard/src/pages/SignIn.tsx | code | صفحة واجهة | نعم |
| artifacts/dashboard/src/pages/SignUp.tsx | code | صفحة واجهة | نعم |
| artifacts/dashboard/src/pages/Tasks.tsx | code | صفحة واجهة | نعم |
| artifacts/dashboard/src/pages/Workflows.tsx | code | صفحة واجهة | نعم |
| artifacts/dashboard/src/pages/not-found.tsx | code | صفحة واجهة | نعم |
| artifacts/dashboard/tsconfig.json | config/design asset | واجهة | نعم |
| artifacts/dashboard/vite.config.ts | code | إعدادات الواجهة | نعم |
| artifacts/mockup-sandbox/.replit-artifact/artifact.toml | config/design asset | إعدادات sandbox | نعم |
| artifacts/mockup-sandbox/components.json | config/design asset | إعدادات sandbox | نعم |
| artifacts/mockup-sandbox/index.html | config/design asset | إعدادات sandbox | نعم |
| artifacts/mockup-sandbox/mockupPreviewPlugin.ts | code | إعدادات sandbox | نعم |
| artifacts/mockup-sandbox/package.json | config/design asset | إعدادات sandbox | نعم |
| artifacts/mockup-sandbox/src/.generated/mockup-components.ts | code | Sandbox/preview design | نعم |
| artifacts/mockup-sandbox/src/App.tsx | code | Sandbox/preview design | نعم |
| artifacts/mockup-sandbox/src/components/ui/accordion.tsx | code | Sandbox/preview design | نعم |
| artifacts/mockup-sandbox/src/components/ui/alert-dialog.tsx | code | Sandbox/preview design | نعم |
| artifacts/mockup-sandbox/src/components/ui/alert.tsx | code | Sandbox/preview design | نعم |
| artifacts/mockup-sandbox/src/components/ui/aspect-ratio.tsx | code | Sandbox/preview design | نعم |
| artifacts/mockup-sandbox/src/components/ui/avatar.tsx | code | Sandbox/preview design | نعم |
| artifacts/mockup-sandbox/src/components/ui/badge.tsx | code | Sandbox/preview design | نعم |
| artifacts/mockup-sandbox/src/components/ui/breadcrumb.tsx | code | Sandbox/preview design | نعم |
| artifacts/mockup-sandbox/src/components/ui/button-group.tsx | code | Sandbox/preview design | نعم |
| artifacts/mockup-sandbox/src/components/ui/button.tsx | code | Sandbox/preview design | نعم |
| artifacts/mockup-sandbox/src/components/ui/calendar.tsx | code | Sandbox/preview design | نعم |
| artifacts/mockup-sandbox/src/components/ui/card.tsx | code | Sandbox/preview design | نعم |
| artifacts/mockup-sandbox/src/components/ui/carousel.tsx | code | Sandbox/preview design | نعم |
| artifacts/mockup-sandbox/src/components/ui/chart.tsx | code | Sandbox/preview design | نعم |
| artifacts/mockup-sandbox/src/components/ui/checkbox.tsx | code | Sandbox/preview design | نعم |
| artifacts/mockup-sandbox/src/components/ui/collapsible.tsx | code | Sandbox/preview design | نعم |
| artifacts/mockup-sandbox/src/components/ui/command.tsx | code | Sandbox/preview design | نعم |
| artifacts/mockup-sandbox/src/components/ui/context-menu.tsx | code | Sandbox/preview design | نعم |
| artifacts/mockup-sandbox/src/components/ui/dialog.tsx | code | Sandbox/preview design | نعم |
| artifacts/mockup-sandbox/src/components/ui/drawer.tsx | code | Sandbox/preview design | نعم |
| artifacts/mockup-sandbox/src/components/ui/dropdown-menu.tsx | code | Sandbox/preview design | نعم |
| artifacts/mockup-sandbox/src/components/ui/empty.tsx | code | Sandbox/preview design | نعم |
| artifacts/mockup-sandbox/src/components/ui/field.tsx | code | Sandbox/preview design | نعم |
| artifacts/mockup-sandbox/src/components/ui/form.tsx | code | Sandbox/preview design | نعم |
| artifacts/mockup-sandbox/src/components/ui/hover-card.tsx | code | Sandbox/preview design | نعم |
| artifacts/mockup-sandbox/src/components/ui/input-group.tsx | code | Sandbox/preview design | نعم |
| artifacts/mockup-sandbox/src/components/ui/input-otp.tsx | code | Sandbox/preview design | نعم |
| artifacts/mockup-sandbox/src/components/ui/input.tsx | code | Sandbox/preview design | نعم |
| artifacts/mockup-sandbox/src/components/ui/item.tsx | code | Sandbox/preview design | نعم |
| artifacts/mockup-sandbox/src/components/ui/kbd.tsx | code | Sandbox/preview design | نعم |
| artifacts/mockup-sandbox/src/components/ui/label.tsx | code | Sandbox/preview design | نعم |
| artifacts/mockup-sandbox/src/components/ui/menubar.tsx | code | Sandbox/preview design | نعم |
| artifacts/mockup-sandbox/src/components/ui/navigation-menu.tsx | code | Sandbox/preview design | نعم |
| artifacts/mockup-sandbox/src/components/ui/pagination.tsx | code | Sandbox/preview design | نعم |
| artifacts/mockup-sandbox/src/components/ui/popover.tsx | code | Sandbox/preview design | نعم |
| artifacts/mockup-sandbox/src/components/ui/progress.tsx | code | Sandbox/preview design | نعم |
| artifacts/mockup-sandbox/src/components/ui/radio-group.tsx | code | Sandbox/preview design | نعم |
| artifacts/mockup-sandbox/src/components/ui/resizable.tsx | code | Sandbox/preview design | نعم |
| artifacts/mockup-sandbox/src/components/ui/scroll-area.tsx | code | Sandbox/preview design | نعم |
| artifacts/mockup-sandbox/src/components/ui/select.tsx | code | Sandbox/preview design | نعم |
| artifacts/mockup-sandbox/src/components/ui/separator.tsx | code | Sandbox/preview design | نعم |
| artifacts/mockup-sandbox/src/components/ui/sheet.tsx | code | Sandbox/preview design | نعم |
| artifacts/mockup-sandbox/src/components/ui/sidebar.tsx | code | Sandbox/preview design | نعم |
| artifacts/mockup-sandbox/src/components/ui/skeleton.tsx | code | Sandbox/preview design | نعم |
| artifacts/mockup-sandbox/src/components/ui/slider.tsx | code | Sandbox/preview design | نعم |
| artifacts/mockup-sandbox/src/components/ui/sonner.tsx | code | Sandbox/preview design | نعم |
| artifacts/mockup-sandbox/src/components/ui/spinner.tsx | code | Sandbox/preview design | نعم |
| artifacts/mockup-sandbox/src/components/ui/switch.tsx | code | Sandbox/preview design | نعم |
| artifacts/mockup-sandbox/src/components/ui/table.tsx | code | Sandbox/preview design | نعم |
| artifacts/mockup-sandbox/src/components/ui/tabs.tsx | code | Sandbox/preview design | نعم |
| artifacts/mockup-sandbox/src/components/ui/textarea.tsx | code | Sandbox/preview design | نعم |
| artifacts/mockup-sandbox/src/components/ui/toast.tsx | code | Sandbox/preview design | نعم |
| artifacts/mockup-sandbox/src/components/ui/toaster.tsx | code | Sandbox/preview design | نعم |
| artifacts/mockup-sandbox/src/components/ui/toggle-group.tsx | code | Sandbox/preview design | نعم |
| artifacts/mockup-sandbox/src/components/ui/toggle.tsx | code | Sandbox/preview design | نعم |
| artifacts/mockup-sandbox/src/components/ui/tooltip.tsx | code | Sandbox/preview design | نعم |
| artifacts/mockup-sandbox/src/hooks/use-mobile.tsx | code | Sandbox/preview design | نعم |
| artifacts/mockup-sandbox/src/hooks/use-toast.ts | code | Sandbox/preview design | نعم |
| artifacts/mockup-sandbox/src/index.css | config/design asset | Sandbox/preview design | نعم |
| artifacts/mockup-sandbox/src/lib/utils.ts | code | Sandbox/preview design | نعم |
| artifacts/mockup-sandbox/src/main.tsx | code | Sandbox/preview design | نعم |
| artifacts/mockup-sandbox/tsconfig.json | config/design asset | إعدادات sandbox | نعم |
| artifacts/mockup-sandbox/vite.config.ts | code | إعدادات sandbox | نعم |

### attached_assets/

| المسار | النوع | الغرض المتوقع | مقروء بالكامل |
| --- | --- | --- | --- |
| attached_assets/ENGINEERINGOS_EXECUTION_ALIGNMENT_REPORT_1784147505317.md | documentation / data | تقرير أو سجل تاريخي مرفق | نعم |
| attached_assets/ENGINEERINGOS_MASTER_EXECUTION_CONSTITUTION(2)_(2)_1784143389784.md | documentation / data | تقرير أو سجل تاريخي مرفق | نعم |
| attached_assets/ENGINEERINGOS_PLACEHOLDER_REGISTER_1784147505353.md | documentation / data | تقرير أو سجل تاريخي مرفق | نعم |
| attached_assets/ENGINEERINGOS_RUNTIME_EXECUTION_MATRIX_1784147505400.md | documentation / data | تقرير أو سجل تاريخي مرفق | نعم |
| attached_assets/EngineeringOS_Audit_Report_1783641389270.md | documentation / data | تقرير أو سجل تاريخي مرفق | نعم |
| attached_assets/EngineeringOS_Audit_Report_Expanded_1783642792349.md | documentation / data | تقرير أو سجل تاريخي مرفق | نعم |
| attached_assets/EngineeringOS_Combined_Deep_Analysis_(1)_1783706911895.md | documentation / data | تقرير أو سجل تاريخي مرفق | نعم |
| attached_assets/EngineeringOS_Engineering_Truth_Verification_1784082430324.csv | documentation / data | جرد/مصفوفة/تصدير تحليلي تاريخي | نعم |
| attached_assets/EngineeringOS_Engineering_Truth_Verification_1784082430371.md | documentation / data | تقرير أو سجل تاريخي مرفق | نعم |
| attached_assets/EngineeringOS_Execution_Plan_1783831261195.pdf | document artifact | مستند تنفيذي/تحليلي مرفق | نعم |
| attached_assets/EngineeringOS_Executive_Build_Directive_v1_1783912619169.md | documentation / data | تقرير أو سجل تاريخي مرفق | نعم |
| attached_assets/EngineeringOS_File_Inventory_Complete(1)_1783706911845.md | documentation / data | تقرير أو سجل تاريخي مرفق | نعم |
| attached_assets/EngineeringOS_File_by_File_Fact_Record_1783725698283.md | documentation / data | تقرير أو سجل تاريخي مرفق | نعم |
| attached_assets/EngineeringOS_Implementation_Document_1783726156016.md | documentation / data | تقرير أو سجل تاريخي مرفق | نعم |
| attached_assets/EngineeringOS_Master_Truth_Register_(1)_1784077194501.xlsx | document artifact | مستند تنفيذي/تحليلي مرفق | نعم |
| attached_assets/EngineeringOS_Plan_1783818095882.pdf | document artifact | مستند تنفيذي/تحليلي مرفق | نعم |
| attached_assets/EngineeringOS_Project_1783718452179.pdf | document artifact | مستند تنفيذي/تحليلي مرفق | نعم |
| attached_assets/EngineeringOS_Project_Analysis_Report_(3)_1784675241263.md | documentation / data | تقرير أو سجل تاريخي مرفق | نعم |
| attached_assets/EngineeringOS_Truth_Flow_Matrix.schema_1784143389669.ts | code | schema/مصفوفة حقيقة أو دليل نوعي | نعم |
| attached_assets/EngineeringOS_Truth_Flow_Matrix_1784143389833.json | config/design asset | تصدير تحليلي أو baseline | نعم |
| attached_assets/EngineeringOS_Truth_Flow_Matrix_1784143389882.ts | code | schema/مصفوفة حقيقة أو دليل نوعي | نعم |
| attached_assets/EngineeringOS_Truth_Flow_PR_Checklist_1784143389929.md | documentation / data | تقرير أو سجل تاريخي مرفق | نعم |
| attached_assets/EngineeringOS_Truth_Register_Full_(1)_1784081699025.csv | documentation / data | جرد/مصفوفة/تصدير تحليلي تاريخي | نعم |
| attached_assets/EngineeringOS_Truth_Register_Full_1784081611461.csv | documentation / data | جرد/مصفوفة/تصدير تحليلي تاريخي | نعم |
| attached_assets/EngineeringOS_Truth_Register_and_PR_Roadmap_(1)_1784081698974.md | documentation / data | تقرير أو سجل تاريخي مرفق | نعم |
| attached_assets/EngineeringOS_Truth_Register_and_PR_Roadmap_1784081611536.md | documentation / data | تقرير أو سجل تاريخي مرفق | نعم |
| attached_assets/EngineeringOS_analysis_report(2)_(1)_1784047036210.md | documentation / data | تقرير أو سجل تاريخي مرفق | نعم |
| attached_assets/EngineeringOS_analysis_summary_1784485047967.json | config/design asset | تصدير تحليلي أو baseline | نعم |
| attached_assets/EngineeringOS_analysis_summary_1784487574320.json | config/design asset | تصدير تحليلي أو baseline | نعم |
| attached_assets/EngineeringOS_analysis_summary_1784488259980.json | config/design asset | تصدير تحليلي أو baseline | نعم |
| attached_assets/EngineeringOS_analysis_summary_1784489456836.json | config/design asset | تصدير تحليلي أو baseline | نعم |
| attached_assets/EngineeringOS_api_zod_index_export_diff_1784143389744.txt | documentation / data | ملف مشروع | نعم |
| attached_assets/EngineeringOS_architecture_analysis_report_1784040976647.md | documentation / data | تقرير أو سجل تاريخي مرفق | نعم |
| attached_assets/EngineeringOS_archive_entries_1784040976692.csv | documentation / data | جرد/مصفوفة/تصدير تحليلي تاريخي | نعم |
| attached_assets/EngineeringOS_archive_entries_1784041152876.csv | documentation / data | جرد/مصفوفة/تصدير تحليلي تاريخي | نعم |
| attached_assets/EngineeringOS_code_deep_analysis_1784052671648.md | documentation / data | تقرير أو سجل تاريخي مرفق | نعم |
| attached_assets/EngineeringOS_code_deep_analysis_1784052762652.md | documentation / data | تقرير أو سجل تاريخي مرفق | نعم |
| attached_assets/EngineeringOS_current_analysis_report_1784052671601.md | documentation / data | تقرير أو سجل تاريخي مرفق | نعم |
| attached_assets/EngineeringOS_current_analysis_report_1784052762572.md | documentation / data | تقرير أو سجل تاريخي مرفق | نعم |
| attached_assets/EngineeringOS_deep_analysis_report_1783800987828.md | documentation / data | تقرير أو سجل تاريخي مرفق | نعم |
| attached_assets/EngineeringOS_deep_dive_analysis_v2_1784152351310.md | documentation / data | تقرير أو سجل تاريخي مرفق | نعم |
| attached_assets/EngineeringOS_deepest_analysis_report(1)_(2)_1784154247108.md | documentation / data | تقرير أو سجل تاريخي مرفق | نعم |
| attached_assets/EngineeringOS_deepest_analysis_report_(1)_1784081611576.md | documentation / data | تقرير أو سجل تاريخي مرفق | نعم |
| attached_assets/EngineeringOS_deepest_analysis_report_(1)_1784081699061.md | documentation / data | تقرير أو سجل تاريخي مرفق | نعم |
| attached_assets/EngineeringOS_file_inventory_(1)_1783729892809.csv | documentation / data | جرد/مصفوفة/تصدير تحليلي تاريخي | نعم |
| attached_assets/EngineeringOS_file_inventory_current_1784052671527.csv | documentation / data | جرد/مصفوفة/تصدير تحليلي تاريخي | نعم |
| attached_assets/EngineeringOS_file_inventory_current_1784052762450.csv | documentation / data | جرد/مصفوفة/تصدير تحليلي تاريخي | نعم |
| attached_assets/EngineeringOS_file_inventory_full(2)_1783988496247.csv | documentation / data | جرد/مصفوفة/تصدير تحليلي تاريخي | نعم |
| attached_assets/EngineeringOS_file_inventory_full_1783800987783.csv | documentation / data | جرد/مصفوفة/تصدير تحليلي تاريخي | نعم |
| attached_assets/EngineeringOS_file_inventory_v2_1784427571850.csv | documentation / data | جرد/مصفوفة/تصدير تحليلي تاريخي | نعم |
| attached_assets/EngineeringOS_file_inventory_v2_1784427972718.csv | documentation / data | جرد/مصفوفة/تصدير تحليلي تاريخي | نعم |
| attached_assets/EngineeringOS_forensic_audit_report(1)_(1)_1784509785486.md | documentation / data | تقرير أو سجل تاريخي مرفق | نعم |
| attached_assets/EngineeringOS_forensic_audit_report_(1)_1784570354611.md | documentation / data | تقرير أو سجل تاريخي مرفق | نعم |
| attached_assets/EngineeringOS_forensic_engineering_report_v2_1784427571793.md | documentation / data | تقرير أو سجل تاريخي مرفق | نعم |
| attached_assets/EngineeringOS_forensic_engineering_report_v2_1784427972668.md | documentation / data | تقرير أو سجل تاريخي مرفق | نعم |
| attached_assets/EngineeringOS_forensic_report(1)_1784492362639.md | documentation / data | تقرير أو سجل تاريخي مرفق | نعم |
| attached_assets/EngineeringOS_forensic_report(1)_1784492400992.md | documentation / data | تقرير أو سجل تاريخي مرفق | نعم |
| attached_assets/EngineeringOS_forensic_report_full(1)_1784485047923.md | documentation / data | تقرير أو سجل تاريخي مرفق | نعم |
| attached_assets/EngineeringOS_forensic_report_full(1)_1784487574279.md | documentation / data | تقرير أو سجل تاريخي مرفق | نعم |
| attached_assets/EngineeringOS_forensic_report_full(1)_1784488259926.md | documentation / data | تقرير أو سجل تاريخي مرفق | نعم |
| attached_assets/EngineeringOS_forensic_report_full(1)_1784489456770.md | documentation / data | تقرير أو سجل تاريخي مرفق | نعم |
| attached_assets/EngineeringOS_full_analysis_report_1783988496190.md | documentation / data | تقرير أو سجل تاريخي مرفق | نعم |
| attached_assets/EngineeringOS_full_file_inventory(1)_1784040976594.csv | documentation / data | جرد/مصفوفة/تصدير تحليلي تاريخي | نعم |
| attached_assets/EngineeringOS_full_file_inventory(1)_1784041152926.csv | documentation / data | جرد/مصفوفة/تصدير تحليلي تاريخي | نعم |
| attached_assets/EngineeringOS_full_file_inventory_1784492401113.csv | documentation / data | جرد/مصفوفة/تصدير تحليلي تاريخي | نعم |
| attached_assets/EngineeringOS_full_inventory(1)_1784485047848.csv | documentation / data | جرد/مصفوفة/تصدير تحليلي تاريخي | نعم |
| attached_assets/EngineeringOS_full_inventory(1)_1784487574226.csv | documentation / data | جرد/مصفوفة/تصدير تحليلي تاريخي | نعم |
| attached_assets/EngineeringOS_full_inventory(1)_1784488259874.csv | documentation / data | جرد/مصفوفة/تصدير تحليلي تاريخي | نعم |
| attached_assets/EngineeringOS_full_inventory(1)_1784489456653.csv | documentation / data | جرد/مصفوفة/تصدير تحليلي تاريخي | نعم |
| attached_assets/EngineeringOS_inventory_(1)_1784570354569.csv | documentation / data | جرد/مصفوفة/تصدير تحليلي تاريخي | نعم |
| attached_assets/EngineeringOS_master_inventory(1)_(1)_1784509785451.csv | documentation / data | جرد/مصفوفة/تصدير تحليلي تاريخي | نعم |
| attached_assets/EngineeringOS_minimum_path_to_vision_(1)_1783830867380.md | documentation / data | تقرير أو سجل تاريخي مرفق | نعم |
| attached_assets/EngineeringOS_minimum_path_to_vision_1783830816710.md | documentation / data | تقرير أو سجل تاريخي مرفق | نعم |
| attached_assets/EngineeringOS_operational_status_record_1783912104506.md | documentation / data | تقرير أو سجل تاريخي مرفق | نعم |
| attached_assets/EngineeringOS_project_analysis_report(1)_1783729892769.md | documentation / data | تقرير أو سجل تاريخي مرفق | نعم |
| attached_assets/EngineeringOS_provenance_registry_linked_1783911530593.json | config/design asset | تصدير تحليلي أو baseline | نعم |
| attached_assets/EngineeringOS_provenance_registry_seed_1783911530658.json | config/design asset | تصدير تحليلي أو baseline | نعم |
| attached_assets/EngineeringOS_replit_execution_directive_1783800987701.json | config/design asset | تصدير تحليلي أو baseline | نعم |
| attached_assets/EngineeringOS_replit_execution_directive_1783800987743.md | documentation / data | تقرير أو سجل تاريخي مرفق | نعم |
| attached_assets/EngineeringOS_runtime_trace_matrix_1784492401053.csv | documentation / data | جرد/مصفوفة/تصدير تحليلي تاريخي | نعم |
| attached_assets/EngineeringOS_series14_truth_matrix_1783966531635.md | documentation / data | تقرير أو سجل تاريخي مرفق | نعم |
| attached_assets/EngineeringOS_series15_deep_evidence_1783966531578.md | documentation / data | تقرير أو سجل تاريخي مرفق | نعم |
| attached_assets/EngineeringOS_series16_truth_matrix_(1)_1783966531512.md | documentation / data | تقرير أو سجل تاريخي مرفق | نعم |
| attached_assets/EngineeringOS_series17_deep_analysis_1783966531444.md | documentation / data | تقرير أو سجل تاريخي مرفق | نعم |
| attached_assets/EngineeringOS_series18_status_register_(1)_1783966531375.md | documentation / data | تقرير أو سجل تاريخي مرفق | نعم |
| attached_assets/EngineeringOS_series19_control_plane_evidence_1783966531303.md | documentation / data | تقرير أو سجل تاريخي مرفق | نعم |
| attached_assets/EngineeringOS_series20_status_register_1783966531239.md | documentation / data | تقرير أو سجل تاريخي مرفق | نعم |
| attached_assets/EngineeringOS_series21_deep_status_1783966531177.md | documentation / data | تقرير أو سجل تاريخي مرفق | نعم |
| attached_assets/EngineeringOS_series22_second_wave_analysis_1783966531113.md | documentation / data | تقرير أو سجل تاريخي مرفق | نعم |
| attached_assets/EngineeringOS_series23_self_verifying_architecture_1783966531049.md | documentation / data | تقرير أو سجل تاريخي مرفق | نعم |
| attached_assets/EngineeringOS_series24_deep_evidence_1783966530990.md | documentation / data | تقرير أو سجل تاريخي مرفق | نعم |
| attached_assets/EngineeringOS_series25_truth_register_1783966530939.md | documentation / data | تقرير أو سجل تاريخي مرفق | نعم |
| attached_assets/EngineeringOS_series26_boundary_analysis_1783966530884.md | documentation / data | تقرير أو سجل تاريخي مرفق | نعم |
| attached_assets/EngineeringOS_series27_failure_semantics_1783966530824.md | documentation / data | تقرير أو سجل تاريخي مرفق | نعم |
| attached_assets/EngineeringOS_series28_traceability_mesh_1783966530766.md | documentation / data | تقرير أو سجل تاريخي مرفق | نعم |
| attached_assets/EngineeringOS_series29_trust_boundary_register_1783966530702.md | documentation / data | تقرير أو سجل تاريخي مرفق | نعم |
| attached_assets/EngineeringOS_series30_release_handoff_audit_1783966530642.md | documentation / data | تقرير أو سجل تاريخي مرفق | نعم |
| attached_assets/EngineeringOS_series31_release_handoff_audit_1783966530586.md | documentation / data | تقرير أو سجل تاريخي مرفق | نعم |
| attached_assets/EngineeringOS_series32_phase_conformance_audit_1783966530537.md | documentation / data | تقرير أو سجل تاريخي مرفق | نعم |
| attached_assets/EngineeringOS_series33_provenance_authority_graph_1783966530470.md | documentation / data | تقرير أو سجل تاريخي مرفق | نعم |
| attached_assets/EngineeringOS_status_record_(1)_1783980758791.md | documentation / data | تقرير أو سجل تاريخي مرفق | نعم |
| attached_assets/EngineeringOS_status_register_(1)_1783818095824.md | documentation / data | تقرير أو سجل تاريخي مرفق | نعم |
| attached_assets/EngineeringOS_status_register_final_1783902107873.md | documentation / data | تقرير أو سجل تاريخي مرفق | نعم |
| attached_assets/EngineeringOS_task_backlog_1783800987875.json | config/design asset | تصدير تحليلي أو baseline | نعم |
| attached_assets/EngineeringOS_truth_checklist_1784322972343.md | documentation / data | تقرير أو سجل تاريخي مرفق | نعم |
| attached_assets/EngineeringOS_truth_checklist_1784326108247.md | documentation / data | تقرير أو سجل تاريخي مرفق | نعم |
| attached_assets/EngineeringOS_truth_register_current_1783825680736.md | documentation / data | تقرير أو سجل تاريخي مرفق | نعم |
| attached_assets/Engineering_Os_Fact_Record_1783718570175.pdf | document artifact | مستند تنفيذي/تحليلي مرفق | نعم |
| attached_assets/Engineering_Os_Phased_Completion_Plan_(1)_1783718452123.pdf | document artifact | مستند تنفيذي/تحليلي مرفق | نعم |
| attached_assets/Engineering_Os_Phased_Completion_Plan_1783718452216.pdf | document artifact | مستند تنفيذي/تحليلي مرفق | نعم |
| attached_assets/PR_BACKLOG_1784470184510.md | documentation / data | تقرير أو سجل تاريخي مرفق | نعم |
| attached_assets/PR_BACKLOG_1784476473246.md | documentation / data | تقرير أو سجل تاريخي مرفق | نعم |
| attached_assets/Pasted---1783906604381_1783906604385.txt | documentation / data | ملف مشروع | نعم |
| attached_assets/Pasted---1783956390496_1783956390501.txt | documentation / data | ملف مشروع | نعم |
| attached_assets/Pasted---1784163447147_1784163447161.txt | documentation / data | ملف مشروع | نعم |
| attached_assets/Pasted---1784163799356_1784163799366.txt | documentation / data | ملف مشروع | نعم |
| attached_assets/Pasted---1784230995192_1784230995203.txt | documentation / data | ملف مشروع | نعم |
| attached_assets/Pasted---1784231528183_1784231528198.txt | documentation / data | ملف مشروع | نعم |
| attached_assets/Pasted---1784232069146_1784232069153.txt | documentation / data | ملف مشروع | نعم |
| attached_assets/Pasted---1784348446604_1784348446608.txt | documentation / data | ملف مشروع | نعم |
| attached_assets/Pasted---1784389595241_1784389595255.txt | documentation / data | ملف مشروع | نعم |
| attached_assets/Pasted---1784688081989_1784688081999.txt | documentation / data | ملف مشروع | نعم |
| attached_assets/Pasted--1--1784078393552_1784078393558.txt | documentation / data | ملف مشروع | نعم |
| attached_assets/Pasted--1-AI--1784682577942_1784682577946.txt | documentation / data | ملف مشروع | نعم |
| attached_assets/Pasted--1-Executive-Summary-I-scanned-the-whole-extracted-tree_1784520091488.txt | documentation / data | ملف مشروع | نعم |
| attached_assets/Pasted--1-Executive-Summary-I-scanned-the-whole-extracted-tree_1784520380555.txt | documentation / data | ملف مشروع | نعم |
| attached_assets/Pasted--1-Executive-Summary-I-scanned-the-whole-extracted-tree_1784565784400.txt | documentation / data | ملف مشروع | نعم |
| attached_assets/Pasted--1-Executive-Summary-ID-Path-Scope--1784588898200_1784588898209.txt | documentation / data | ملف مشروع | نعم |
| attached_assets/Pasted--1-Executive-Summary-ID-Path-Scope--1784588976178_1784588976181.txt | documentation / data | ملف مشروع | نعم |
| attached_assets/Pasted--1-Set-up-the-imported-project-What-Why-The-user-just-i_1784600640416.txt | documentation / data | ملف مشروع | نعم |
| attached_assets/Pasted--8-minutes-ago-Replacing-in-process-upload-store-The-us_1784600039567.txt | documentation / data | ملف مشروع | نعم |
| attached_assets/Pasted--Backlog-Execution-Backlog-v1-0--1783975284276_1783975284279.txt | documentation / data | ملف مشروع | نعم |
| attached_assets/Pasted--Code-Review-Plan-Groq-Scope-Save-API--1784175594438_1784175594440.txt | documentation / data | ملف مشروع | نعم |
| attached_assets/Pasted--Discovery-Layer--1783988471815_1783988471818.txt | documentation / data | ملف مشروع | نعم |
| attached_assets/Pasted--EngineeringOS--1784145653787_1784145653789.txt | documentation / data | ملف مشروع | نعم |
| attached_assets/Pasted--EngineeringOS-Autonomous-Project-Discovery-Onboarding-_1783565505918.txt | documentation / data | ملف مشروع | نعم |
| attached_assets/Pasted--EngineeringOS-Autonomous-Project-Discovery-Onboarding-_1783566150077.txt | documentation / data | ملف مشروع | نعم |
| attached_assets/Pasted--EngineeringOS-PR-Backlog-File-by-File-backlog--1784168_1784168977036.txt | documentation / data | ملف مشروع | نعم |
| attached_assets/Pasted--EngineeringOS-PR-Backlog-File-by-File-backlog--1784169_1784169315352.txt | documentation / data | ملف مشروع | نعم |
| attached_assets/Pasted--EngineeringOS-PR-by-PR-Execution-Pack-for-Replit-AI-PR_1784154335102.txt | documentation / data | ملف مشروع | نعم |
| attached_assets/Pasted--EngineeringOS-PR-by-PR-Execution-Pack-for-Replit-AI-PR_1784155079326.txt | documentation / data | ملف مشروع | نعم |
| attached_assets/Pasted--Forensic-Software-Engineering-Audit-1-Executive-Summar_1784515285022.txt | documentation / data | ملف مشروع | نعم |
| attached_assets/Pasted--Forensic-Software-Engineering-Audit-1-Executive-Summar_1784515636472.txt | documentation / data | ملف مشروع | نعم |
| attached_assets/Pasted--GROQ-API-KEY-JavaScript-Groq--1784088277237_1784088277243.txt | documentation / data | ملف مشروع | نعم |
| attached_assets/Pasted--Git-AI-Orchestrator-lib-ai-orchestrator-src-tools-git-_1784347517831.txt | documentation / data | ملف مشروع | نعم |
| attached_assets/Pasted--Knowledge-Graph-2-0--1784165514922_1784165514926.txt | documentation / data | ملف مشروع | نعم |
| attached_assets/Pasted--Knowledge-Graph-2-0-Checklist-File--1784165546932_1784165546935.txt | documentation / data | ملف مشروع | نعم |
| attached_assets/Pasted--PR--1784040954263_1784040954267.txt | documentation / data | ملف مشروع | نعم |
| attached_assets/Pasted--PR-01-Sync-OpenAPI-with-runtime-graph-surface-files-li_1784234215782.txt | documentation / data | ملف مشروع | نعم |
| attached_assets/Pasted--PR-03-Micro-Backlog-Contract-Layer-Stabilization-1-3--_1784158287520.txt | documentation / data | ملف مشروع | نعم |
| attached_assets/Pasted--PR-1-Hardening-Contract-Alignment-for-projects-ts-proj_1784052905584.txt | documentation / data | ملف مشروع | نعم |
| attached_assets/Pasted--PR-Backlog-EngineeringOS-1-Scoping-ownership-integrity_1784154359481.txt | documentation / data | ملف مشروع | نعم |
| attached_assets/Pasted--PR-Backlog-EngineeringOS-Execution-Alignment--17841474_1784147452495.txt | documentation / data | ملف مشروع | نعم |
| attached_assets/Pasted--PR-Title-fix-ai-chat-surface-AI-request-failures-and-r_1784130154946.txt | documentation / data | ملف مشروع | نعم |
| attached_assets/Pasted--PR-Title-fix-discovery-Classify-Project-Loading-Failur_1784086246178.txt | documentation / data | ملف مشروع | نعم |
| attached_assets/Pasted--PR-app-ts--1784047027177_1784047027183.txt | documentation / data | ملف مشروع | نعم |
| attached_assets/Pasted--PR-app-ts--1784047927706_1784047927710.txt | documentation / data | ملف مشروع | نعم |
| attached_assets/Pasted--PR-backlog-PR--1784509953092_1784509953095.txt | documentation / data | ملف مشروع | نعم |
| attached_assets/Pasted--PR-discovery-ts-PR-1-Discovery--1783996178319_1783996178325.txt | documentation / data | ملف مشروع | نعم |
| attached_assets/Pasted--PR-lib-ai-orchestrator-PR-1-Prompt-Templates--17839939_1783993953832.txt | documentation / data | ملف مشروع | نعم |
| attached_assets/Pasted--PR-lib-ai-orchestrator-PR-1-Prompt-Templates--17839939_1783993967887.txt | documentation / data | ملف مشروع | نعم |
| attached_assets/Pasted--PR-lib-ai-orchestrator-PR-1-Prompt-Templates--17839950_1783995013203.txt | documentation / data | ملف مشروع | نعم |
| attached_assets/Pasted--PR-title-Harden-auth-context-and-prepare-project-scope_1784044908893.txt | documentation / data | ملف مشروع | نعم |
| attached_assets/Pasted--PR-title-Hardening-discovery-ts-into-a-deterministic-o_1784053152915.txt | documentation / data | ملف مشروع | نعم |
| attached_assets/Pasted--Plan-3-Sync-fact-record-architecture-docs-3-Sync-Fact-_1783733496072.txt | documentation / data | ملف مشروع | نعم |
| attached_assets/Pasted--Plan-3-Sync-fact-record-architecture-docs-3-Sync-Fact-_1783790285219.txt | documentation / data | ملف مشروع | نعم |
| attached_assets/Pasted--Today-5-05-AM-EngineeringOS-main-66-zip-Zip-Archive-Fo_1784430667443.txt | documentation / data | ملف مشروع | نعم |
| attached_assets/Pasted--artifacts-api-server-src-lib-scan-runner-ts--178460388_1784603885654.txt | documentation / data | ملف مشروع | نعم |
| attached_assets/Pasted--artifacts-api-server-src-routes-ai-ts-lib-ai-orchestra_1784388540189.txt | documentation / data | ملف مشروع | نعم |
| attached_assets/Pasted--artifacts-api-server-src-routes-discovery-ts--17839967_1783996711676.txt | documentation / data | ملف مشروع | نعم |
| attached_assets/Pasted--artifacts-api-server-src-routes-discovery-ts--17839967_1783997082105.txt | documentation / data | ملف مشروع | نعم |
| attached_assets/Pasted--lib-ai-orchestrator--1783993997216_1783993997218.txt | documentation / data | ملف مشروع | نعم |
| attached_assets/Pasted--lib-db-test-script--1784159470823_1784159470827.txt | documentation / data | ملف مشروع | نعم |
| attached_assets/Pasted--onboarding-o-1783988399961_1783988399964.txt | documentation / data | ملف مشروع | نعم |
| attached_assets/Pasted--src-context-builder-ts-src-schemas-context-schema-1784_1784305372706.txt | documentation / data | ملف مشروع | نعم |
| attached_assets/Pasted--test--1784245726594_1784245726598.txt | documentation / data | ملف مشروع | نعم |
| attached_assets/Pasted--test--1784245803493_1784245803497.txt | documentation / data | ملف مشروع | نعم |
| attached_assets/Pasted-7-Upgrade-Dashboard-to-Operational-UI-What-Why-Current-_1783734748019.txt | documentation / data | ملف مشروع | نعم |
| attached_assets/Pasted-7-Upgrade-Dashboard-to-Operational-UI-What-Why-Current-_1783798897613.txt | documentation / data | ملف مشروع | نعم |
| attached_assets/Pasted-Continuing-with-the-appendices-and-the-remaining-large-_1784588937982.txt | documentation / data | ملف مشروع | نعم |
| attached_assets/Pasted-Continuing-with-the-appendices-and-the-remaining-large-_1784588957924.txt | documentation / data | ملف مشروع | نعم |
| attached_assets/Pasted-PR-Title-security-ai-Harden-User-Scoped-Groq-Credential_1784127290653.txt | documentation / data | ملف مشروع | نعم |
| attached_assets/Pasted-Plan-6-Deepen-graph-scanner-discovery-6-Deepen-Graph-Sc_1783734658300.txt | documentation / data | ملف مشروع | نعم |
| attached_assets/Pasted-We-are-CONTINUING-an-interrupted-implementation-session_1784565760215.txt | documentation / data | ملف مشروع | نعم |
| attached_assets/Pasted-We-are-CONTINUING-an-interrupted-implementation-session_1784565840455.txt | documentation / data | ملف مشروع | نعم |
| attached_assets/Screenshot_٢٠٢٦٠٧٠٩-٠٦١٦٢٥_1783567039006.png | image asset | أصل بصري | لا |
| attached_assets/Screenshot_٢٠٢٦٠٧٠٩-٠٦٢٠٣٨_1783610776566.png | image asset | أصل بصري | لا |
| attached_assets/Screenshot_٢٠٢٦٠٧١٣-٠٣٥٣١٨_1783904118069.png | image asset | أصل بصري | لا |
| attached_assets/Screenshot_٢٠٢٦٠٧١٣-٠٤٠٥١١_1783904724118.png | image asset | أصل بصري | لا |
| attached_assets/Screenshot_٢٠٢٦٠٧١٣-٠٤٤٤٢٨_1783907108840.png | image asset | أصل بصري | لا |
| attached_assets/Screenshot_٢٠٢٦٠٧١٣-٠٥٠١٣٨_1783908128704.png | image asset | أصل بصري | لا |
| attached_assets/Screenshot_٢٠٢٦٠٧١٣-٠٥١٤٥٤_1783908924873.png | image asset | أصل بصري | لا |
| attached_assets/Screenshot_٢٠٢٦٠٧١٣-٠٥١٩٤٨_1783909201747.png | image asset | أصل بصري | لا |
| attached_assets/Screenshot_٢٠٢٦٠٧١٦-٠٧٣٧٤٤_1784176683628.png | image asset | أصل بصري | لا |
| attached_assets/Screenshot_٢٠٢٦٠٧١٦-١٨٣٠٤١_1784216000977.png | image asset | أصل بصري | لا |
| attached_assets/Screenshot_٢٠٢٦٠٧١٦-١٨٣٠٤٦_1784216000942.png | image asset | أصل بصري | لا |
| attached_assets/Screenshot_٢٠٢٦٠٧١٨-٠١٠٨١٠_1784326132441.png | image asset | أصل بصري | لا |
| attached_assets/Screenshot_٢٠٢٦٠٧١٨-٠٦١٢٠٢_1784344398002.png | image asset | أصل بصري | لا |
| attached_assets/Screenshot_٢٠٢٦٠٧١٨-٠٦١٢٤٢_1784344397966.png | image asset | أصل بصري | لا |
| attached_assets/Screenshot_٢٠٢٦٠٧١٨-٠٦١٢٤٦_1784344397931.png | image asset | أصل بصري | لا |
| attached_assets/Screenshot_٢٠٢٦٠٧١٨-٠٦١٩١٠_1784344762476.png | image asset | أصل بصري | لا |
| attached_assets/Screenshot_٢٠٢٦٠٧١٩-٠٤٣٥١٧_1784424954601.png | image asset | أصل بصري | لا |
| attached_assets/Screenshot_٢٠٢٦٠٧١٩-٠٤٣٥٢١_1784424954559.png | image asset | أصل بصري | لا |
| attached_assets/Screenshot_٢٠٢٦٠٧٢٠-٠٢٠٢٥١_1784502211806.png | image asset | أصل بصري | لا |
| attached_assets/Screenshot_٢٠٢٦٠٧٢٠-٠٢٠٣٠٤_1784502211776.png | image asset | أصل بصري | لا |
| attached_assets/Screenshot_٢٠٢٦٠٧٢٠-٠٢٢٤٤٨_1784504071817.png | image asset | أصل بصري | لا |
| attached_assets/Screenshot_٢٠٢٦٠٧٢٠-٠٢٢٤٥١_1784504071787.png | image asset | أصل بصري | لا |
| attached_assets/Screenshot_٢٠٢٦٠٧٢٠-٠٢٢٤٥٥_1784504071737.png | image asset | أصل بصري | لا |
| attached_assets/Screenshot_٢٠٢٦٠٧٢٠-٠٣٢٣٤٤_1784507048475.png | image asset | أصل بصري | لا |
| attached_assets/Screenshot_٢٠٢٦٠٧٢٠-٠٤٤٥٣٥_1784512160900.png | image asset | أصل بصري | لا |
| attached_assets/Screenshot_٢٠٢٦٠٧٢٠-٠٦١٠٤٦_1784517131306.png | image asset | أصل بصري | لا |
| attached_assets/Screenshot_٢٠٢٦٠٧٢٠-٠٦١٠٥٢_1784517131269.png | image asset | أصل بصري | لا |
| attached_assets/Screenshot_٢٠٢٦٠٧٢١-١٨٠٩٠٦_1784646632784.png | image asset | أصل بصري | لا |
| attached_assets/Screenshot_٢٠٢٦٠٧٢٢-٠٣١٠٢٣_1784679051607.png | image asset | أصل بصري | لا |
| attached_assets/Screenshot_٢٠٢٦٠٧٢٢-٠٤١٩٠٩_1784683176768.png | image asset | أصل بصري | لا |
| attached_assets/agents_(1)_1783564013722.zip | archive snapshot | أرشيف لقطة من مجلدات المشروع | لا |
| attached_assets/ai_orchestrator_deep_dive_(1)_1783994021466.md | documentation / data | تقرير أو سجل تاريخي مرفق | نعم |
| attached_assets/artifacts_(7)_(1)_1783564013761.zip | archive snapshot | أرشيف لقطة من مجلدات المشروع | لا |
| attached_assets/engineeringos_forensic_analysis_1784431635464.md | documentation / data | تقرير أو سجل تاريخي مرفق | نعم |
| attached_assets/engineeringos_forensic_analysis_complete_1784431954519.md | documentation / data | تقرير أو سجل تاريخي مرفق | نعم |
| attached_assets/engineeringos_forensic_analysis_complete_1784476328406.md | documentation / data | تقرير أو سجل تاريخي مرفق | نعم |
| attached_assets/engineeringos_forensic_audit_report_(2)_1784594296592_1784597203240.md | documentation / data | تقرير أو سجل تاريخي مرفق | نعم |
| attached_assets/engineeringos_forensic_audit_report_(2)_1784594296592_1784600036061.md | documentation / data | تقرير أو سجل تاريخي مرفق | نعم |
| attached_assets/engineeringos_forensic_audit_report_(2)_1784594296592_1784601251287.md | documentation / data | تقرير أو سجل تاريخي مرفق | نعم |
| attached_assets/engineeringos_forensic_audit_report_1784498370433.md | documentation / data | تقرير أو سجل تاريخي مرفق | نعم |
| attached_assets/engineeringos_forensic_audit_report_1784499793978.md | documentation / data | تقرير أو سجل تاريخي مرفق | نعم |
| attached_assets/engineeringos_forensic_audit_report_1784500814802.md | documentation / data | تقرير أو سجل تاريخي مرفق | نعم |
| attached_assets/engineeringos_master_inventory_(3)_1784597203313.csv | documentation / data | جرد/مصفوفة/تصدير تحليلي تاريخي | نعم |
| attached_assets/engineeringos_master_inventory_(3)_1784600036116.csv | documentation / data | جرد/مصفوفة/تصدير تحليلي تاريخي | نعم |
| attached_assets/engineeringos_master_inventory_(3)_1784601251241.csv | documentation / data | جرد/مصفوفة/تصدير تحليلي تاريخي | نعم |
| attached_assets/engineeringos_master_inventory_1784498370483.csv | documentation / data | جرد/مصفوفة/تصدير تحليلي تاريخي | نعم |
| attached_assets/engineeringos_master_inventory_1784499794029.csv | documentation / data | جرد/مصفوفة/تصدير تحليلي تاريخي | نعم |
| attached_assets/engineeringos_master_inventory_1784500814907.csv | documentation / data | جرد/مصفوفة/تصدير تحليلي تاريخي | نعم |
| attached_assets/git_(2)_1783564013691.zip | archive snapshot | أرشيف لقطة من مجلدات المشروع | لا |
| attached_assets/gitattributes_1783564013915.txt | documentation / data | ملف مشروع | نعم |
| attached_assets/gitignore_(1)_1783564013965.txt | documentation / data | ملف مشروع | نعم |
| attached_assets/lib_(7)_(1)_1783564013810.zip | archive snapshot | أرشيف لقطة من مجلدات المشروع | لا |
| attached_assets/node_modules_(2)_1783564014266.zip | archive snapshot | أرشيف لقطة من مجلدات المشروع | لا |
| attached_assets/npmrc_(2)_1783564014024.txt | documentation / data | ملف مشروع | نعم |
| attached_assets/package_(1)_(7)_1783564014328.json | config/design asset | تصدير تحليلي أو baseline | نعم |
| attached_assets/pnpm-lock.yaml_(3)_1783564014392.txt | documentation / data | ملف مشروع | نعم |
| attached_assets/pnpm-workspace.yaml_(3)_1783564014449.txt | documentation / data | ملف مشروع | نعم |
| attached_assets/pr-backlog-ai-orchestrator_1784306020062.md | documentation / data | تقرير أو سجل تاريخي مرفق | نعم |
| attached_assets/replit_(13)_1783564014085.md | documentation / data | تقرير أو سجل تاريخي مرفق | نعم |
| attached_assets/replit_(2)_1783564014509.txt | documentation / data | ملف مشروع | نعم |
| attached_assets/replitignore_1783564014569.txt | documentation / data | ملف مشروع | نعم |
| attached_assets/scripts_(8)_1783564013865.zip | archive snapshot | أرشيف لقطة من مجلدات المشروع | لا |
| attached_assets/tsconfig.base_(2)_(1)_1783564014142.json | config/design asset | تصدير تحليلي أو baseline | نعم |
| attached_assets/tsconfig_(7)_1783564014202.json | config/design asset | تصدير تحليلي أو baseline | نعم |
| attached_assets/تحليل_EngineeringOS_1783804577785.docx | document artifact | مستند تنفيذي/تحليلي مرفق | نعم |
| attached_assets/خطة_العمل_التنفيذية_لمشروع_EngineeringOS_1783729892699.docx | document artifact | مستند تنفيذي/تحليلي مرفق | نعم |

### docs/

| المسار | النوع | الغرض المتوقع | مقروء بالكامل |
| --- | --- | --- | --- |
| docs/ENGINEERINGOS_MASTER_EXECUTION_CONSTITUTION.md | documentation / data | وثيقة مرجعية / تاريخ تنفيذ / سجل حقيقة | نعم |
| docs/EXECUTION_ALIGNMENT_REPORT.md | documentation / data | وثيقة مرجعية / تاريخ تنفيذ / سجل حقيقة | نعم |
| docs/PLACEHOLDER_REGISTER.md | documentation / data | وثيقة مرجعية / تاريخ تنفيذ / سجل حقيقة | نعم |
| docs/PR_BACKLOG.md | documentation / data | وثيقة مرجعية / تاريخ تنفيذ / سجل حقيقة | نعم |
| docs/RUNTIME_EXECUTION_MATRIX.md | documentation / data | وثيقة مرجعية / تاريخ تنفيذ / سجل حقيقة | نعم |
| docs/ai-orchestrator-executive-table.md | documentation / data | وثيقة مرجعية / تاريخ تنفيذ / سجل حقيقة | نعم |
| docs/ai-orchestrator-forensic-analysis.md | documentation / data | وثيقة مرجعية / تاريخ تنفيذ / سجل حقيقة | نعم |
| docs/ai-orchestrator-gap-analysis.md | documentation / data | وثيقة مرجعية / تاريخ تنفيذ / سجل حقيقة | نعم |
| docs/ai-orchestrator-trace-analysis.md | documentation / data | وثيقة مرجعية / تاريخ تنفيذ / سجل حقيقة | نعم |
| docs/architecture.md | documentation / data | وثيقة مرجعية / تاريخ تنفيذ / سجل حقيقة | نعم |
| docs/completion-plan.md | documentation / data | وثيقة مرجعية / تاريخ تنفيذ / سجل حقيقة | نعم |
| docs/fact-record.md | documentation / data | وثيقة مرجعية / تاريخ تنفيذ / سجل حقيقة | نعم |
| docs/pr-backlog-ai-orchestrator.md | documentation / data | وثيقة مرجعية / تاريخ تنفيذ / سجل حقيقة | نعم |
| docs/truth-flow-pr-checklist.md | documentation / data | وثيقة مرجعية / تاريخ تنفيذ / سجل حقيقة | نعم |
| docs/truth-flow-pr-review-plan.md | documentation / data | وثيقة مرجعية / تاريخ تنفيذ / سجل حقيقة | نعم |

### lib/

| المسار | النوع | الغرض المتوقع | مقروء بالكامل |
| --- | --- | --- | --- |
| lib/ai-orchestrator/package.json | config/design asset | طبقة AI orchestration | نعم |
| lib/ai-orchestrator/src/__tests__/chat-agent.test.ts | code | اختبار orchestration | نعم |
| lib/ai-orchestrator/src/__tests__/file-tools.test.ts | code | اختبار orchestration | نعم |
| lib/ai-orchestrator/src/__tests__/groq-client.test.ts | code | اختبار orchestration | نعم |
| lib/ai-orchestrator/src/__tests__/parsing.test.ts | code | اختبار orchestration | نعم |
| lib/ai-orchestrator/src/__tests__/schemas.test.ts | code | اختبار orchestration | نعم |
| lib/ai-orchestrator/src/__tests__/workflow-orchestrator.test.ts | code | اختبار orchestration | نعم |
| lib/ai-orchestrator/src/agents/chat-agent.ts | code | Agent | نعم |
| lib/ai-orchestrator/src/agents/code-reviewer.ts | code | Agent | نعم |
| lib/ai-orchestrator/src/agents/scan-analyst.ts | code | Agent | نعم |
| lib/ai-orchestrator/src/agents/task-agent.ts | code | Agent | نعم |
| lib/ai-orchestrator/src/agents/workflow-orchestrator.ts | code | Agent | نعم |
| lib/ai-orchestrator/src/context-builder.test.ts | code | اختبار orchestration | نعم |
| lib/ai-orchestrator/src/context-builder.ts | code | طبقة AI orchestration | نعم |
| lib/ai-orchestrator/src/deepseek-client.ts | code | طبقة AI orchestration | نعم |
| lib/ai-orchestrator/src/errors.ts | code | طبقة AI orchestration | نعم |
| lib/ai-orchestrator/src/groq-client.ts | code | طبقة AI orchestration | نعم |
| lib/ai-orchestrator/src/index.ts | code | طبقة AI orchestration | نعم |
| lib/ai-orchestrator/src/parsing.ts | code | طبقة AI orchestration | نعم |
| lib/ai-orchestrator/src/prompts/chat.prompt.ts | code | Prompt | نعم |
| lib/ai-orchestrator/src/prompts/index.ts | code | Prompt | نعم |
| lib/ai-orchestrator/src/prompts/review.prompt.ts | code | Prompt | نعم |
| lib/ai-orchestrator/src/prompts/scan.prompt.ts | code | Prompt | نعم |
| lib/ai-orchestrator/src/prompts/task.prompt.ts | code | Prompt | نعم |
| lib/ai-orchestrator/src/prompts/workflow.prompt.ts | code | Prompt | نعم |
| lib/ai-orchestrator/src/schemas/chat.schema.ts | code | Schema للأوضاع AI | نعم |
| lib/ai-orchestrator/src/schemas/code-review.schema.ts | code | Schema للأوضاع AI | نعم |
| lib/ai-orchestrator/src/schemas/context.schema.ts | code | Schema للأوضاع AI | نعم |
| lib/ai-orchestrator/src/schemas/index.ts | code | Schema للأوضاع AI | نعم |
| lib/ai-orchestrator/src/schemas/scan.schema.ts | code | Schema للأوضاع AI | نعم |
| lib/ai-orchestrator/src/schemas/task.schema.ts | code | Schema للأوضاع AI | نعم |
| lib/ai-orchestrator/src/schemas/workflow.schema.ts | code | Schema للأوضاع AI | نعم |
| lib/ai-orchestrator/src/tools/file-tools.ts | code | Tool runtime | نعم |
| lib/ai-orchestrator/src/tools/git-tools.ts | code | Tool runtime | نعم |
| lib/ai-orchestrator/tsconfig.json | config/design asset | طبقة AI orchestration | نعم |
| lib/ai-orchestrator/vitest.config.ts | code | طبقة AI orchestration | نعم |
| lib/api-client-react/package.json | config/design asset | واجهة عميل React | نعم |
| lib/api-client-react/src/custom-fetch.ts | code | واجهة عميل React | نعم |
| lib/api-client-react/src/generated/api.schemas.ts | code | React Query generated client | نعم |
| lib/api-client-react/src/generated/api.ts | code | React Query generated client | نعم |
| lib/api-client-react/src/index.ts | code | واجهة عميل React | نعم |
| lib/api-client-react/src/project-error.ts | code | واجهة عميل React | نعم |
| lib/api-client-react/src/use-ai-chat-stream.ts | code | واجهة عميل React | نعم |
| lib/api-client-react/tsconfig.json | config/design asset | واجهة عميل React | نعم |
| lib/api-spec/openapi.yaml | config/design asset | OpenAPI / codegen spec | نعم |
| lib/api-spec/orval.config.ts | code | OpenAPI / codegen spec | نعم |
| lib/api-spec/package.json | config/design asset | OpenAPI / codegen spec | نعم |
| lib/api-zod/package.json | config/design asset | Zod contract | نعم |
| lib/api-zod/src/generated/api.ts | code | Zod generated contract | نعم |
| lib/api-zod/src/generated/types/activeProviderStatus.ts | code | Zod generated contract | نعم |
| lib/api-zod/src/generated/types/activeProviderStatusProvider.ts | code | Zod generated contract | نعم |
| lib/api-zod/src/generated/types/aiApplyChangesRequest.ts | code | Zod generated contract | نعم |
| lib/api-zod/src/generated/types/aiApplyChangesRequestChangesItem.ts | code | Zod generated contract | نعم |
| lib/api-zod/src/generated/types/aiApplyChangesResult.ts | code | Zod generated contract | نعم |
| lib/api-zod/src/generated/types/aiApplyChangesResultResultsItem.ts | code | Zod generated contract | نعم |
| lib/api-zod/src/generated/types/aiChatMessage.ts | code | Zod generated contract | نعم |
| lib/api-zod/src/generated/types/aiChatMessageRole.ts | code | Zod generated contract | نعم |
| lib/api-zod/src/generated/types/aiChatOutput.ts | code | Zod generated contract | نعم |
| lib/api-zod/src/generated/types/aiChatRequest.ts | code | Zod generated contract | نعم |
| lib/api-zod/src/generated/types/aiChatSession.ts | code | Zod generated contract | نعم |
| lib/api-zod/src/generated/types/aiCodeIssue.ts | code | Zod generated contract | نعم |
| lib/api-zod/src/generated/types/aiCodeIssueSeverity.ts | code | Zod generated contract | نعم |
| lib/api-zod/src/generated/types/aiCodeIssueType.ts | code | Zod generated contract | نعم |
| lib/api-zod/src/generated/types/aiCodeReview.ts | code | Zod generated contract | نعم |
| lib/api-zod/src/generated/types/aiCodeReviewVerdict.ts | code | Zod generated contract | نعم |
| lib/api-zod/src/generated/types/aiOrchestrateRequest.ts | code | Zod generated contract | نعم |
| lib/api-zod/src/generated/types/aiOrchestrationDecision.ts | code | Zod generated contract | نعم |
| lib/api-zod/src/generated/types/aiOrchestrationDecisionAction.ts | code | Zod generated contract | نعم |
| lib/api-zod/src/generated/types/aiPendingChange.ts | code | Zod generated contract | نعم |
| lib/api-zod/src/generated/types/aiReviewRequest.ts | code | Zod generated contract | نعم |
| lib/api-zod/src/generated/types/aiReviewRequestFileContents.ts | code | Zod generated contract | نعم |
| lib/api-zod/src/generated/types/aiScanAnalysis.ts | code | Zod generated contract | نعم |
| lib/api-zod/src/generated/types/aiScanInsight.ts | code | Zod generated contract | نعم |
| lib/api-zod/src/generated/types/aiScanInsightCategory.ts | code | Zod generated contract | نعم |
| lib/api-zod/src/generated/types/aiScanInsightSeverity.ts | code | Zod generated contract | نعم |
| lib/api-zod/src/generated/types/apiError.ts | code | Zod generated contract | نعم |
| lib/api-zod/src/generated/types/archiveUploadInput.ts | code | Zod generated contract | نعم |
| lib/api-zod/src/generated/types/archiveUploadOutput.ts | code | Zod generated contract | نعم |
| lib/api-zod/src/generated/types/createProjectInput.ts | code | Zod generated contract | نعم |
| lib/api-zod/src/generated/types/createRuleInput.ts | code | Zod generated contract | نعم |
| lib/api-zod/src/generated/types/createTaskInput.ts | code | Zod generated contract | نعم |
| lib/api-zod/src/generated/types/createWorkflowInput.ts | code | Zod generated contract | نعم |
| lib/api-zod/src/generated/types/dashboardOverview.ts | code | Zod generated contract | نعم |
| lib/api-zod/src/generated/types/dashboardOverviewProjectScoresItem.ts | code | Zod generated contract | نعم |
| lib/api-zod/src/generated/types/dashboardOverviewProjectScoresItemTrend.ts | code | Zod generated contract | نعم |
| lib/api-zod/src/generated/types/dashboardOverviewTaskStatusBreakdown.ts | code | Zod generated contract | نعم |
| lib/api-zod/src/generated/types/dashboardOverviewTopRulesItem.ts | code | Zod generated contract | نعم |
| lib/api-zod/src/generated/types/deepSeekKeyStatus.ts | code | Zod generated contract | نعم |
| lib/api-zod/src/generated/types/deleteDeepSeekKey200.ts | code | Zod generated contract | نعم |
| lib/api-zod/src/generated/types/deleteGroqKey200.ts | code | Zod generated contract | نعم |
| lib/api-zod/src/generated/types/discoveryGraphSummaryData.ts | code | Zod generated contract | نعم |
| lib/api-zod/src/generated/types/discoveryGraphSummaryDataEntitiesByType.ts | code | Zod generated contract | نعم |
| lib/api-zod/src/generated/types/discoveryGraphSummaryDataFilesByLanguage.ts | code | Zod generated contract | نعم |
| lib/api-zod/src/generated/types/discoveryOptions.ts | code | Zod generated contract | نعم |
| lib/api-zod/src/generated/types/discoveryReport.ts | code | Zod generated contract | نعم |
| lib/api-zod/src/generated/types/discoveryRuleViolationItem.ts | code | Zod generated contract | نعم |
| lib/api-zod/src/generated/types/discoverySessionStatus.ts | code | Zod generated contract | نعم |
| lib/api-zod/src/generated/types/discoverySessionStatusStatus.ts | code | Zod generated contract | نعم |
| lib/api-zod/src/generated/types/discoverySourceCapability.ts | code | Zod generated contract | نعم |
| lib/api-zod/src/generated/types/discoverySourceConfig.ts | code | Zod generated contract | نعم |
| lib/api-zod/src/generated/types/discoverySourceConfigCredentials.ts | code | Zod generated contract | نعم |
| lib/api-zod/src/generated/types/discoveryStepItem.ts | code | Zod generated contract | نعم |
| lib/api-zod/src/generated/types/discoveryStepItemStatus.ts | code | Zod generated contract | نعم |
| lib/api-zod/src/generated/types/entityType.ts | code | Zod generated contract | نعم |
| lib/api-zod/src/generated/types/evaluateRuleRequest.ts | code | Zod generated contract | نعم |
| lib/api-zod/src/generated/types/event.ts | code | Zod generated contract | نعم |
| lib/api-zod/src/generated/types/eventPayload.ts | code | Zod generated contract | نعم |
| lib/api-zod/src/generated/types/eventSeverity.ts | code | Zod generated contract | نعم |
| lib/api-zod/src/generated/types/failWorkflowPhaseInput.ts | code | Zod generated contract | نعم |
| lib/api-zod/src/generated/types/getGraphEntityImpact404.ts | code | Zod generated contract | نعم |
| lib/api-zod/src/generated/types/getGraphEntityImpactParams.ts | code | Zod generated contract | نعم |
| lib/api-zod/src/generated/types/getGraphEntityNeighbors200.ts | code | Zod generated contract | نعم |
| lib/api-zod/src/generated/types/getGraphEntityNeighbors404.ts | code | Zod generated contract | نعم |
| lib/api-zod/src/generated/types/getGraphEvidence403.ts | code | Zod generated contract | نعم |
| lib/api-zod/src/generated/types/getGraphEvidence404.ts | code | Zod generated contract | نعم |
| lib/api-zod/src/generated/types/getGraphPathParams.ts | code | Zod generated contract | نعم |
| lib/api-zod/src/generated/types/getGraphRuntimeSubgraph403.ts | code | Zod generated contract | نعم |
| lib/api-zod/src/generated/types/getGraphRuntimeSubgraph404.ts | code | Zod generated contract | نعم |
| lib/api-zod/src/generated/types/getGraphSemanticNeighborhood400.ts | code | Zod generated contract | نعم |
| lib/api-zod/src/generated/types/getGraphSemanticNeighborhood403.ts | code | Zod generated contract | نعم |
| lib/api-zod/src/generated/types/getGraphSemanticNeighborhood404.ts | code | Zod generated contract | نعم |
| lib/api-zod/src/generated/types/getGraphSemanticNeighborhoodParams.ts | code | Zod generated contract | نعم |
| lib/api-zod/src/generated/types/getGraphSubgraph400.ts | code | Zod generated contract | نعم |
| lib/api-zod/src/generated/types/getGraphSubgraph403.ts | code | Zod generated contract | نعم |
| lib/api-zod/src/generated/types/getGraphSubgraph404.ts | code | Zod generated contract | نعم |
| lib/api-zod/src/generated/types/getGraphSubgraphParams.ts | code | Zod generated contract | نعم |
| lib/api-zod/src/generated/types/getLatestMetricsParams.ts | code | Zod generated contract | نعم |
| lib/api-zod/src/generated/types/gitCommitEntry.ts | code | Zod generated contract | نعم |
| lib/api-zod/src/generated/types/gitCommitInput.ts | code | Zod generated contract | نعم |
| lib/api-zod/src/generated/types/gitConfig.ts | code | Zod generated contract | نعم |
| lib/api-zod/src/generated/types/gitHubTokenStatus.ts | code | Zod generated contract | نعم |
| lib/api-zod/src/generated/types/gitLog.ts | code | Zod generated contract | نعم |
| lib/api-zod/src/generated/types/gitOperationResult.ts | code | Zod generated contract | نعم |
| lib/api-zod/src/generated/types/gitPushResult.ts | code | Zod generated contract | نعم |
| lib/api-zod/src/generated/types/gitStatus.ts | code | Zod generated contract | نعم |
| lib/api-zod/src/generated/types/gitStatusFile.ts | code | Zod generated contract | نعم |
| lib/api-zod/src/generated/types/graphCentralityScore.ts | code | Zod generated contract | نعم |
| lib/api-zod/src/generated/types/graphEdgeType.ts | code | Zod generated contract | نعم |
| lib/api-zod/src/generated/types/graphEntity.ts | code | Zod generated contract | نعم |
| lib/api-zod/src/generated/types/graphEntityMetadata.ts | code | Zod generated contract | نعم |
| lib/api-zod/src/generated/types/graphEvidence.ts | code | Zod generated contract | نعم |
| lib/api-zod/src/generated/types/graphEvidenceBundle.ts | code | Zod generated contract | نعم |
| lib/api-zod/src/generated/types/graphEvidenceKind.ts | code | Zod generated contract | نعم |
| lib/api-zod/src/generated/types/graphEvidenceResponse.ts | code | Zod generated contract | نعم |
| lib/api-zod/src/generated/types/graphImpactHop.ts | code | Zod generated contract | نعم |
| lib/api-zod/src/generated/types/graphImpactResult.ts | code | Zod generated contract | نعم |
| lib/api-zod/src/generated/types/graphLayerCounts.ts | code | Zod generated contract | نعم |
| lib/api-zod/src/generated/types/graphPathResult.ts | code | Zod generated contract | نعم |
| lib/api-zod/src/generated/types/graphPathStep.ts | code | Zod generated contract | نعم |
| lib/api-zod/src/generated/types/graphProvenance.ts | code | Zod generated contract | نعم |
| lib/api-zod/src/generated/types/graphRelationship.ts | code | Zod generated contract | نعم |
| lib/api-zod/src/generated/types/graphRelationshipMetadata.ts | code | Zod generated contract | نعم |
| lib/api-zod/src/generated/types/graphRuntimeSubgraph.ts | code | Zod generated contract | نعم |
| lib/api-zod/src/generated/types/graphSemanticNeighborhood.ts | code | Zod generated contract | نعم |
| lib/api-zod/src/generated/types/graphSubgraph.ts | code | Zod generated contract | نعم |
| lib/api-zod/src/generated/types/graphSubgraphFilters.ts | code | Zod generated contract | نعم |
| lib/api-zod/src/generated/types/graphSubgraphLayered.ts | code | Zod generated contract | نعم |
| lib/api-zod/src/generated/types/graphSummary.ts | code | Zod generated contract | نعم |
| lib/api-zod/src/generated/types/graphSummaryEntitiesByType.ts | code | Zod generated contract | نعم |
| lib/api-zod/src/generated/types/graphSummaryRelationsByType.ts | code | Zod generated contract | نعم |
| lib/api-zod/src/generated/types/groqKeyStatus.ts | code | Zod generated contract | نعم |
| lib/api-zod/src/generated/types/healthStatus.ts | code | Zod generated contract | نعم |
| lib/api-zod/src/generated/types/healthStatusStatus.ts | code | Zod generated contract | نعم |
| lib/api-zod/src/generated/types/importProjectInput.ts | code | Zod generated contract | نعم |
| lib/api-zod/src/generated/types/importProjectInputOverrides.ts | code | Zod generated contract | نعم |
| lib/api-zod/src/generated/types/index.ts | code | Zod generated contract | نعم |
| lib/api-zod/src/generated/types/jobQueueStats.ts | code | Zod generated contract | نعم |
| lib/api-zod/src/generated/types/listAiChatSessionsParams.ts | code | Zod generated contract | نعم |
| lib/api-zod/src/generated/types/listEventsParams.ts | code | Zod generated contract | نعم |
| lib/api-zod/src/generated/types/listGraphEntitiesParams.ts | code | Zod generated contract | نعم |
| lib/api-zod/src/generated/types/listGraphRelationshipsParams.ts | code | Zod generated contract | نعم |
| lib/api-zod/src/generated/types/listMetricsParams.ts | code | Zod generated contract | نعم |
| lib/api-zod/src/generated/types/listRulesParams.ts | code | Zod generated contract | نعم |
| lib/api-zod/src/generated/types/listTasksParams.ts | code | Zod generated contract | نعم |
| lib/api-zod/src/generated/types/listWorkflowsParams.ts | code | Zod generated contract | نعم |
| lib/api-zod/src/generated/types/metricRecord.ts | code | Zod generated contract | نعم |
| lib/api-zod/src/generated/types/metricRecordBuildStatus.ts | code | Zod generated contract | نعم |
| lib/api-zod/src/generated/types/operationalCounters.ts | code | Zod generated contract | نعم |
| lib/api-zod/src/generated/types/plugin.ts | code | Zod generated contract | نعم |
| lib/api-zod/src/generated/types/pluginCapabilitiesItem.ts | code | Zod generated contract | نعم |
| lib/api-zod/src/generated/types/pluginProjectRequest.ts | code | Zod generated contract | نعم |
| lib/api-zod/src/generated/types/project.ts | code | Zod generated contract | نعم |
| lib/api-zod/src/generated/types/projectStatus.ts | code | Zod generated contract | نعم |
| lib/api-zod/src/generated/types/projectSummary.ts | code | Zod generated contract | نعم |
| lib/api-zod/src/generated/types/projectSummaryTaskCounts.ts | code | Zod generated contract | نعم |
| lib/api-zod/src/generated/types/rule.ts | code | Zod generated contract | نعم |
| lib/api-zod/src/generated/types/ruleEvaluationResult.ts | code | Zod generated contract | نعم |
| lib/api-zod/src/generated/types/ruleEvaluationResultMatchesItem.ts | code | Zod generated contract | نعم |
| lib/api-zod/src/generated/types/ruleSeverity.ts | code | Zod generated contract | نعم |
| lib/api-zod/src/generated/types/saveDeepSeekKeyInput.ts | code | Zod generated contract | نعم |
| lib/api-zod/src/generated/types/saveGitHubTokenInput.ts | code | Zod generated contract | نعم |
| lib/api-zod/src/generated/types/saveGroqKeyInput.ts | code | Zod generated contract | نعم |
| lib/api-zod/src/generated/types/scanJob.ts | code | Zod generated contract | نعم |
| lib/api-zod/src/generated/types/scanJobStatus.ts | code | Zod generated contract | نعم |
| lib/api-zod/src/generated/types/scanResult.ts | code | Zod generated contract | نعم |
| lib/api-zod/src/generated/types/sourceType.ts | code | Zod generated contract | نعم |
| lib/api-zod/src/generated/types/startDiscoveryInput.ts | code | Zod generated contract | نعم |
| lib/api-zod/src/generated/types/task.ts | code | Zod generated contract | نعم |
| lib/api-zod/src/generated/types/taskLog.ts | code | Zod generated contract | نعم |
| lib/api-zod/src/generated/types/taskLogLevel.ts | code | Zod generated contract | نعم |
| lib/api-zod/src/generated/types/taskLogMetadata.ts | code | Zod generated contract | نعم |
| lib/api-zod/src/generated/types/taskPriority.ts | code | Zod generated contract | نعم |
| lib/api-zod/src/generated/types/taskStatus.ts | code | Zod generated contract | نعم |
| lib/api-zod/src/generated/types/updateGitConfigInput.ts | code | Zod generated contract | نعم |
| lib/api-zod/src/generated/types/updateProjectInput.ts | code | Zod generated contract | نعم |
| lib/api-zod/src/generated/types/updateProjectInputStatus.ts | code | Zod generated contract | نعم |
| lib/api-zod/src/generated/types/updateRuleInput.ts | code | Zod generated contract | نعم |
| lib/api-zod/src/generated/types/updateTaskInput.ts | code | Zod generated contract | نعم |
| lib/api-zod/src/generated/types/verificationResult.ts | code | Zod generated contract | نعم |
| lib/api-zod/src/generated/types/verificationResultStepsItem.ts | code | Zod generated contract | نعم |
| lib/api-zod/src/generated/types/workflow.ts | code | Zod generated contract | نعم |
| lib/api-zod/src/generated/types/workflowExecution.ts | code | Zod generated contract | نعم |
| lib/api-zod/src/generated/types/workflowPhase.ts | code | Zod generated contract | نعم |
| lib/api-zod/src/generated/types/workflowStatus.ts | code | Zod generated contract | نعم |
| lib/api-zod/src/index.ts | code | Zod contract | نعم |
| lib/api-zod/src/truth-flow-matrix.schema.ts | code | Schema governance | نعم |
| lib/api-zod/tsconfig.json | config/design asset | Zod contract | نعم |
| lib/db/drizzle.config.ts | code | طبقة DB | نعم |
| lib/db/package.json | config/design asset | طبقة DB | نعم |
| lib/db/src/index.ts | code | طبقة DB | نعم |
| lib/db/src/schema/ai_chats.ts | code | Drizzle schema / table | نعم |
| lib/db/src/schema/ai_provider_credentials.ts | code | Drizzle schema / table | نعم |
| lib/db/src/schema/audit_logs.ts | code | Drizzle schema / table | نعم |
| lib/db/src/schema/discovery.ts | code | Drizzle schema / table | نعم |
| lib/db/src/schema/events.ts | code | Drizzle schema / table | نعم |
| lib/db/src/schema/graph.ts | code | Drizzle schema / table | نعم |
| lib/db/src/schema/index.ts | code | Drizzle schema / table | نعم |
| lib/db/src/schema/metrics.ts | code | Drizzle schema / table | نعم |
| lib/db/src/schema/plugins.ts | code | Drizzle schema / table | نعم |
| lib/db/src/schema/projects.ts | code | Drizzle schema / table | نعم |
| lib/db/src/schema/rate_limits.ts | code | Drizzle schema / table | نعم |
| lib/db/src/schema/rules.ts | code | Drizzle schema / table | نعم |
| lib/db/src/schema/scan_jobs.ts | code | Drizzle schema / table | نعم |
| lib/db/src/schema/task_logs.ts | code | Drizzle schema / table | نعم |
| lib/db/src/schema/tasks.ts | code | Drizzle schema / table | نعم |
| lib/db/src/schema/uploads.ts | code | Drizzle schema / table | نعم |
| lib/db/src/schema/workflows.ts | code | Drizzle schema / table | نعم |
| lib/db/tsconfig.json | config/design asset | طبقة DB | نعم |
| lib/knowledge-engine/package.json | config/design asset | محرك استعلام ومعرفة graph | نعم |
| lib/knowledge-engine/src/__tests__/inference.test.ts | code | محرك استعلام ومعرفة graph | نعم |
| lib/knowledge-engine/src/__tests__/queries.test.ts | code | محرك استعلام ومعرفة graph | نعم |
| lib/knowledge-engine/src/index.ts | code | محرك استعلام ومعرفة graph | نعم |
| lib/knowledge-engine/src/inference.ts | code | محرك استعلام ومعرفة graph | نعم |
| lib/knowledge-engine/src/queries.ts | code | محرك استعلام ومعرفة graph | نعم |
| lib/knowledge-engine/src/types.ts | code | محرك استعلام ومعرفة graph | نعم |
| lib/knowledge-engine/tsconfig.json | config/design asset | محرك استعلام ومعرفة graph | نعم |
| lib/scanner/package.json | config/design asset | محرك scan / AST / rules / metrics | نعم |
| lib/scanner/src/__tests__/file-walker.test.ts | code | اختبار scanner | نعم |
| lib/scanner/src/__tests__/graph-extractor.test.ts | code | اختبار scanner | نعم |
| lib/scanner/src/__tests__/metrics-calc.test.ts | code | اختبار scanner | نعم |
| lib/scanner/src/__tests__/rule-matcher.test.ts | code | اختبار scanner | نعم |
| lib/scanner/src/file-walker.ts | code | محرك scan / AST / rules / metrics | نعم |
| lib/scanner/src/graph-extractor.ts | code | محرك scan / AST / rules / metrics | نعم |
| lib/scanner/src/index.ts | code | محرك scan / AST / rules / metrics | نعم |
| lib/scanner/src/metrics-calc.ts | code | محرك scan / AST / rules / metrics | نعم |
| lib/scanner/src/python-ast-script.py | code | محرك scan / AST / rules / metrics | نعم |
| lib/scanner/src/python-ast-script.ts | code | محرك scan / AST / rules / metrics | نعم |
| lib/scanner/src/python-extractor.ts | code | محرك scan / AST / rules / metrics | نعم |
| lib/scanner/src/rule-matcher.ts | code | محرك scan / AST / rules / metrics | نعم |
| lib/scanner/tsconfig.json | config/design asset | محرك scan / AST / rules / metrics | نعم |
| lib/scanner/vitest.config.ts | code | محرك scan / AST / rules / metrics | نعم |

### scripts/

| المسار | النوع | الغرض المتوقع | مقروء بالكامل |
| --- | --- | --- | --- |
| scripts/check-codegen-drift.ts | code | سكريبت تشغيل/تحقق | نعم |
| scripts/package.json | config/design asset | سكريبت تشغيل/تحقق | نعم |
| scripts/post-merge.sh | code | سكريبت تشغيل/تحقق | نعم |
| scripts/src/hello.ts | code | سكريبت تشغيل/تحقق | نعم |
| scripts/trigger-scan.mts | other | سكريبت تشغيل/تحقق | نعم |
| scripts/tsconfig.json | config/design asset | سكريبت تشغيل/تحقق | نعم |
| scripts/validate-truth-flow.ts | code | سكريبت تشغيل/تحقق | نعم |
| scripts/verify-setup.sh | code | سكريبت تشغيل/تحقق | نعم |

### root/

| المسار | النوع | الغرض المتوقع | مقروء بالكامل |
| --- | --- | --- | --- |
| .gitattributes | other | سياسة LFS/نصوص لبعض الأصول | نعم |
| .gitignore | other | استبعاد الملفات المولّدة والسرّية | نعم |
| .npmrc | other | إعدادات pnpm و hoisting | نعم |
| .replit | documentation / data | تشغيل Replit وإعداد secrets/workflows | نعم |
| .replitignore | other | استبعاد ملفات النشر | نعم |
| package.json | config/design asset | مانيفست الجذر وأوامر monorepo | نعم |
| pnpm-lock.yaml | config/design asset | قفل الاعتماديات | نعم |
| pnpm-workspace.yaml | config/design asset | إعدادات مساحة العمل وسياسة الأمان | نعم |
| replit.md | documentation / data | ملف مشروع | نعم |
| tsconfig.base.json | config/design asset | إعدادات TypeScript الأساسية | نعم |
| tsconfig.base.json.bak | other | نسخة احتياطية/مرجعية لإعداد TypeScript | نعم |
| tsconfig.json | config/design asset | مراجع TypeScript لمسارات الحزم | نعم |
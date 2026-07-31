# EngineeringOS — التحليل الهندسي الشامل وخطة الاستكمال

> منهجية العمل: تمت قراءة الملفات النصية في الأرشيف آليًا، وتم فهرسة الملفات الثنائية/الأرشيفية بالاسم والنوع والبنية. في كل موضع، فرّقت بين: ما تم التحقق منه من الملفات، وما هو استنتاج مدعوم بالأدلة، وما لا يمكن إثباته من الملفات.

## 1) الملخص التنفيذي

- الأرشيف الذي تم تحليله يحتوي على **825 ملفًا**.
- منها **780 ملفًا نصيًا/قابلًا للقراءة آليًا** و **45 ملفًا ثنائيًا أو أرشيفيًا**.
- البنية العامة واضحة: **عقد API → Zod/Client مولَّدين → خادم Express → طبقة بيانات Drizzle/Postgres → Scanner → Knowledge Engine → AI Orchestrator → Dashboard**.
- توجد مطابقة بنيوية قوية بين OpenAPI والـ routes runtime، مع طبقة توليد تُغذي Zod والعميل React Query.
- المشروع ليس مجرد واجهة؛ بل منصة هندسية متكاملة لإدارة المشاريع، الاكتشاف، الفحص، الرسم البياني المعرفي، الأتمتة بالذكاء الاصطناعي، والحوكمة.
- أكبر المخاطر الحالية ليست في غياب الأساسيات، بل في **ديمومة الـ job queue**، و**ضجيج الأصول التاريخية**، و**غياب اختبارات واضحة للواجهة الأمامية**.

## 2) فهرس الملفات التي تمت قراءتها

| المستوى الأعلى | عدد الملفات | نصي/قابل للقراءة | ثنائي/أرشيفي | الدور المتوقع |
|---|---:|---:|---:|---|
| `lib` | 261 | 261 | 0 | shared libraries / core runtime |
| `attached_assets` | 251 | 206 | 45 | historical evidence / exports / screenshots |
| `artifacts` | 237 | 235 | 2 | runnable applications / delivery artifacts |
| `.agents` | 40 | 40 | 0 | decision memory / historical notes |
| `docs` | 15 | 15 | 0 | governance docs / truth baseline |
| `scripts` | 8 | 8 | 0 | validation / build / operational scripts |
| `.gitattributes` | 1 | 1 | 0 | workspace configuration / repo governance |
| `.github` | 1 | 1 | 0 | CI/CD configuration |
| `.gitignore` | 1 | 1 | 0 | workspace configuration / repo governance |
| `.npmrc` | 1 | 1 | 0 | workspace configuration / repo governance |
| `.replit` | 1 | 1 | 0 | workspace configuration / repo governance |
| `.replitignore` | 1 | 1 | 0 | workspace configuration / repo governance |
| `package.json` | 1 | 1 | 0 | workspace configuration / repo governance |
| `pnpm-lock.yaml` | 1 | 1 | 0 | workspace configuration / repo governance |
| `pnpm-workspace.yaml` | 1 | 1 | 0 | workspace configuration / repo governance |
| `replit.md` | 1 | 1 | 0 | workspace configuration / repo governance |
| `tsconfig.base.json` | 1 | 1 | 0 | workspace configuration / repo governance |
| `tsconfig.base.json.bak` | 1 | 1 | 0 | workspace configuration / repo governance |
| `tsconfig.json` | 1 | 1 | 0 | workspace configuration / repo governance |

ملاحظة: الجدول أعلاه يلخص التوزيع على مستوى المجلدات. الفهرس الكامل بكل ملف موجود في الملحق الأخير.

## 3) تحليل المشروع

### الهدف النهائي للمشروع
EngineeringOS هو **منصة ذكاء هندسي للمشاريع البرمجية**. من خلال الملفات، يتضح أنه يحل مشكلة تجميع الحقيقة الهندسية في مكان واحد: يفهرس المستودع، يبني Knowledge Graph، يطبق قواعد الجودة، يدير المهام والتدفقات، ويقدم AI chat وتنفيذ مهام مدعومًا بسياق المشروع.

**المستخدمون المستهدفون** المستدل عليهم من الملفات: المهندسون البرمجيون، قادة الفرق، والمشغلون التقنيون الذين يحتاجون رؤية موحدة للكود، الجداول، الأحداث، والمهام.

**القيمة المقدمة**: 
- سبر/اكتشاف المشاريع البرمجية وتحويلها إلى بيانات منظمة.
- رسم معرفة قابل للاستعلام.
- تتبع التنفيذ عبر الأحداث، الـ audit، والـ metrics.
- مساعدة AI على فهم سياق المشروع الحقيقي بدل التخمين.

**السيناريوهات الأساسية للاستخدام**: 
- إضافة مشروع ثم فحصه وبناء المعرفة.
- اكتشاف مشروع من مجلد محلي أو Git repo أو أرشيف مرفوع.
- تشغيل AI chat على مشروع معين مع pending changes.
- تنفيذ مهام/تدفقات عمل ومتابعة الأحداث والـ metrics.

## 4) تحليل المعمارية

الطبقات التي تظهر بوضوح في الملفات:
- **طبقة العقد**: `lib/api-spec/openapi.yaml` ثم المخرجات المولدة في `lib/api-zod/src/generated/*` و`lib/api-client-react/src/generated/*`.
- **طبقة الواجهة**: `artifacts/dashboard` مبنية على React + Vite + wouter + React Query.
- **طبقة API runtime**: `artifacts/api-server` المبنية على Express.
- **طبقة البيانات**: `lib/db` مبنية على Drizzle/Postgres.
- **طبقة الفهم/التحليل**: `lib/scanner` و`lib/knowledge-engine`.
- **طبقة الذكاء الاصطناعي**: `lib/ai-orchestrator`.
- **طبقة الحوكمة والتشغيل**: `docs/*`, `scripts/*`, `.github/workflows/ci.yml`, `.agents/memory/*`.

### رسم معماري نصي

```text
Dashboard (React + Vite + React Query)
   │
   │ same-origin cookie auth
   ▼
API Server (Express + Clerk + auth/ownership middleware)
   ├── Routes: projects, tasks, rules, workflows, events, metrics, graph, discovery, plugins, ai, git, upload
   ├── Background jobs: heavyJobQueue + job-reconciliation
   ├── Audit/Event emission
   ├── Scan runner / discovery runner
   └── AI orchestration entrypoints
         │
         ├── lib/db (Drizzle/Postgres)
         ├── lib/scanner
         ├── lib/knowledge-engine
         └── lib/ai-orchestrator
                ├── Groq client
                ├── context builder
                ├── agents (chat / scan / review / task / workflow)
                └── file + git tools
```

### التوازي بين العقدة والـ runtime
- `lib/api-spec/openapi.yaml` يحتوي على **65 path definitions**.
- الـ API runtime يحتوي على **83 route declarations**.
- بعد التطبيع البنيوي لمسارات المعلمات، تظهر **65 shape-aligned paths**؛ وهذا يدعم ادعاء الاتساق البنيوي بين spec وruntime.

## 5) تحليل الطبقات

| الطبقة | المسؤولية | الحالة | ملفات مرجعية | ملاحظة |
|---|---|---|---|---|
| العقد / Contract | OpenAPI + Zod + client generated | مكتمل | lib/api-spec/openapi.yaml, lib/api-zod/src/generated/*, lib/api-client-react/src/generated/* | عقد API قابل للتوليد والتحقق |
| البيانات / Data | Drizzle schema + Postgres | مكتمل جزئيًا | lib/db/src/schema/* | 17 جدولًا رئيسيًا + علاقات + قيود + enums |
| الخادم / Runtime API | Express routes, middleware, job queue, audit | مكتمل جزئيًا | artifacts/api-server/src/* | كل routes الأساسية موجودة، مع auth وownership وlogging |
| الاكتشاف / Discovery | source adapters + runner + validation | مكتمل جزئيًا | artifacts/api-server/src/routes/discovery.ts, src/lib/discovery-* | يدعم local folder / git / archive / workspace project |
| المسح / Scanner | walk → rules → graph → metrics | مكتمل | lib/scanner/src/* | مقروء من الاختبارات وواجهة التصدير |
| Knowledge Engine | graph traversal + inference | مكتمل | lib/knowledge-engine/src/* | Typed queries + centrality + path/impact/neighborhood |
| AI Orchestrator | LLM agents + context + parsing + tools | مكتمل جزئيًا | lib/ai-orchestrator/src/* | 5 وكلاء، context cache، file/git tools، schemas |
| Dashboard | Project UX and operational pages | مكتمل جزئيًا | artifacts/dashboard/src/pages/* | 15 صفحة عملياتية رئيسية |
| Scripts / Governance | validation, drift checks, bootstrapping | مكتمل | scripts/*, .github/workflows/ci.yml | codegen drift + truth-flow validation + post-merge |
| .agents/memory | decision memory | مكتمل | .agents/memory/* | سجل قرارات وتغييرات وتشخيصات |

## 6) تحليل المكونات

| المكوّن | الطبقة | الحالة | % تقديري | الأدلة |
|---|---|---|---:|---|
| Contract surface (OpenAPI → Zod → client) | Application contract | مكتمل | 98% | openapi.yaml, lib/api-zod/src/generated/*, lib/api-client-react/src/generated/*, docs/architecture.md |
| Database schema | Data layer | مكتمل جزئيًا | 90% | lib/db/src/schema/*, docs/architecture.md §8 |
| API server runtime | Application runtime | مكتمل جزئيًا | 90% | artifacts/api-server/src/app.ts, src/index.ts, src/routes/* |
| Discovery pipeline | Backend execution | مكتمل جزئيًا | 90% | artifacts/api-server/src/routes/discovery.ts, src/lib/discovery-* |
| Scanner | Analysis engine | مكتمل | 95% | lib/scanner/src/* |
| Knowledge engine | Graph/query engine | مكتمل | 95% | lib/knowledge-engine/src/* |
| AI orchestrator | LLM orchestration | مكتمل جزئيًا | 90% | lib/ai-orchestrator/src/*, artifacts/api-server/src/routes/ai/* |
| Dashboard | UI | مكتمل جزئيًا | 85% | artifacts/dashboard/src/pages/*, src/components/* |
| Governance / truth flow | Process control | مكتمل | 95% | docs/fact-record.md, docs/architecture.md, scripts/validate-truth-flow.ts |
| CI / build scripts | Tooling | مكتمل | 95% | .github/workflows/ci.yml, scripts/check-codegen-drift.ts, package.json |
| Background job system | Runtime infrastructure | مكتمل جزئيًا | 80% | artifacts/api-server/src/lib/job-queue.ts, job-reconciliation.ts |
| Historical evidence archive | Attached assets | تصميم فقط | 60% | attached_assets/* |

### ملاحظات على المكونات
- **API contract surface** قوي جدًا؛ توجد عملية توليد drift gate وtypecheck وclient generation.
- **Scanner** و**Knowledge Engine** يبدوان الأقرب إلى الاكتمال الوظيفي لأنهما يملكان واجهات نظيفة واختبارات واضحة.
- **API server** و**Dashboard** ليسا مجرد stubs؛ لكنهما ما زالا يحملان بعض الالتصاق بالقرارات التشغيلية والـ UX polish.
- **AI Orchestrator** واضح أنه عملي، لكنه يعتمد على parsing defensiveness وسياق cache ومزودات خارجية.

## 7) تحليل الكود

### نقاط الدخول الرئيسية
- `artifacts/api-server/src/index.ts` و`artifacts/api-server/src/app.ts`.
- `artifacts/dashboard/src/main.tsx` و`artifacts/dashboard/src/App.tsx`.
- `lib/scanner/src/index.ts`.
- `lib/knowledge-engine/src/index.ts`.
- `lib/ai-orchestrator/src/index.ts`.
- `scripts/check-codegen-drift.ts` و`scripts/validate-truth-flow.ts` و`scripts/post-merge.sh`.

### مسارات التنفيذ الأساسية
- **Project discovery**: `POST /projects/discover` → source adapter → job queue → discovery runner → DB updates.
- **Scan**: `POST /projects/:projectId/scan` → queue → `scan-runner` → scanner → knowledge graph → metrics/events.
- **AI chat**: `POST /api/ai/chat` → auth/ownership → key/rate checks → project context → Groq tool loop → parsing → persist messages.
- **Task AI execute**: `POST /api/ai/tasks/:taskId/execute` → claim → executeTask → status/log/event/audit.
- **Workflow orchestration**: `POST /api/ai/workflows/:workflowId/orchestrate` و`POST /workflows/:workflowId/advance`.

### المصادقة والتفويض
- `clerkMiddleware` في `app.ts`، و`requireAuth` على المسارات المحمية.
- `requireProjectAccess` و`requireProjectWriteAccess` يطبقان scoping على مستوى `projectId`.
- `projectsTable.ownerId` هو محور ownership؛ هذا واضح من schema والـ middleware والـ docs.

### الخلفيات والـ jobs
- يوجد `heavyJobQueue` كطابور process-local محدود التوازي.
- يوجد `job-reconciliation.ts` و`startup-migrations.ts` لإصلاح الحالات العالقة عند الإقلاع.
- يوجد `advisory-lock.ts` كحاجز إضافي ضد التكرار المتزامن.

### الأحداث والـ audit
- جداول `events` و`audit_logs` موجودة في schema.
- `recordAudit` مستخدم على مسارات mutations المختلفة.
- معظم الـ write-paths تُسجّل أحداثًا قابلة للتتبع مع `correlationId` عندما يكون ذلك مناسبًا.

### التسجيل Logging
- الخادم يستخدم `pino-http` مع serializers لطلب/استجابة مختصرين.
- يوجد `logger.ts` في API server؛ والحِزم التشغيلية تسجل counters وqueue state في startup.

### الاختبارات
- يوجد **34 ملف اختبار** عبر API server وAI orchestrator وscanner وknowledge-engine.
- لا يظهر لي مسار اختبار مخصص داخل `artifacts/dashboard`، وهذا فراغ مهم في تغطية الواجهة.

### CI/CD وأدوات البناء
- GitHub Actions في `.github/workflows/ci.yml`.
- `pnpm` هو مدير الحزم الأساسي، مع قفل release age في `pnpm-workspace.yaml` لأمان سلسلة التوريد.
- `orval` يولد Zod/client surfaces من OpenAPI.
- `esbuild` يبني API server، و`vite` يبني dashboard.
- `drizzle-kit` مسؤول عن schema push.

## 8) تحليل الوثائق

### المستندات الرئيسية
- `docs/architecture.md` — **أقوى وثيقة حالية**؛ تصف البنية الحالية وتقول صراحة إنها baseline الحقيقة الحالية.
- `docs/fact-record.md` — سجل حقيقة ملفّي، ويصرّح بأنه **historical phase log** وليس baseline الحالي.
- `docs/completion-plan.md` — خطة مرحلية تاريخية، وليست baseline حالية.
- `docs/PR_BACKLOG.md` — backlog للـ PRs المفتوحة/المغلقة؛ مفيد كخارطة تطور.
- `docs/PLACEHOLDER_REGISTER.md` — يسجل الأماكن المشبوهة أو التي تحتاج مراجعة.
- `docs/RUNTIME_EXECUTION_MATRIX.md` — يربط feature/UI/API/DB/tests.

### التوافق مع الواقع
- الوثائق الأساسية متسقة مع الكود الحالي إلى حد كبير، وخصوصًا `docs/architecture.md`.
- `docs/completion-plan.md` و`docs/fact-record.md` يحتويان تاريخًا مرحليًا صريحًا؛ لذلك لا ينبغي معاملتهما كمرجع نهائي للحالة الحالية.
- `attached_assets/*` يحتوي على نسخ أقدم/تاريخية كثيرة من تقارير وتحاليل؛ هذه مفيدة كسياق لكنها ليست baseline.

### التناقضات أو الناقص
- أكبر مشكلة وثائقية ليست خطأ تقني، بل **تعدد الطبعات**: نفس النوع من التحليل محفوظ بصيغ عديدة داخل `attached_assets`.
- توجد أصول ثنائية (PDF/DOCX/XLSX/PNG/ZIP) لا يمكن التحقق من معناها النصي بنفس عمق الملفات النصية في هذه الجولة.

## 9) تحليل الجودة

| البعد | التقييم | السبب |
|---|---|---|
| جودة المعمارية | عالية | تقسيم طبقي واضح، contract-first، اعتماديات أحادية الاتجاه، وحدود مسؤولية مرئية في الملفات. |
| جودة التنظيم | عالية | monorepo منظم، حزم منفصلة، ملفات package واضحة، ومسارات predictable. |
| جودة التوثيق | عالية لكن مزدحمة | الوثائق الحالية قوية، لكن الأرشيف مليء بالنسخ التاريخية المتعددة. |
| جودة الكود | عالية | TypeScript منضبط، zod schemas، middleware، error handling، واختبارات موجودة على عدة طبقات. |
| سهولة الصيانة | متوسطة إلى عالية | الهيكل يساعد على الصيانة، لكن كثرة الأصول التاريخية والـ generated surfaces ترفع عبء الفهم. |
| القابلية للتوسع | متوسطة | جيدة وظيفيًا، لكن queue محلي ووجود بعض افتراضات single-process يقلل السعة التشغيلية. |
| الأمان | عالية | Clerk auth، scoping بالملكية، rate limiting، path validation، وتشفير credentials. |
| الاختبارات | جيدة | هناك 34 اختبارات، لكن تغطية الواجهة الأمامية غير ظاهرة بوضوح. |
| جاهزية الإنتاج | متوسطة إلى عالية | المنتج قابل للتشغيل، لكن job durability وbinary evidence governance وUI testing تحتاج صقلًا. |

## 10) تحليل الفجوات

| العنصر | الموجود فعليًا | المتوقع | الفجوة | مستوى الخطورة | الأولوية |
|---|---|---|---|---|---|
| In-process job queue durability | heavyJobQueue is process-local; a crash or restart can lose queued/running work. The docs explicitly keep this as an H-1 observability baseline rather than a durable queue. | Persistent queue or equivalent durable re-enqueue semantics across restarts | artifacts/api-server/src/lib/job-queue.ts; artifacts/api-server/src/lib/job-reconciliation.ts; docs/architecture.md §7 | High | High |
| Multi-instance job execution model | Advisory locks reduce duplicates, but the current queue is still process-local and not a distributed scheduler. | Multi-worker / multi-instance safe job dispatch | artifacts/api-server/src/lib/job-queue.ts; docs/architecture.md | High | Medium |
| Dashboard automated tests | I found many API/lib tests, but no dashboard page tests in the archive. | UI-level tests for key flows such as AiChat, DiscoverProjectWizard, Projects, Tasks | artifacts/dashboard/src/pages/* | Medium | Medium |
| Binary historical attachments | Many PDFs, DOCX, XLSX, PNGs, and ZIPs exist in attached_assets, but they are not semantically inspectable to the same depth as text sources in this run. | Content-level verification or OCR/indexing for binary evidence | attached_assets/* | Medium | Medium |
| Historical-doc drift risk | There are multiple generations of analysis reports and inventories in attached_assets, so older attached docs can contradict newer baseline docs. | Single canonical baseline and explicit supersession policy | docs/architecture.md; docs/fact-record.md; attached_assets/* | Medium | Medium |
| Append-only historical clutter | The archive contains many duplicate analysis exports and screenshots, which increases noise and makes it easier to read stale evidence as current truth. | Retention / archive policy or canonical index | attached_assets/* | Low | Low |

## 11) إطار متابعة المشروع

### 11.1 بطاقة حالة لكل مكوّن
استخدم البطاقة التالية لكل مكوّن:

```text
الاسم:
الطبقة:
الحالة: [مكتمل / مكتمل جزئيًا / قيد التنفيذ / تصميم فقط / لم يبدأ / غير معروف]
نسبة الإنجاز:
الأولوية:
المسؤول:
آخر تحديث:
المخاطر:
الاعتماديات:
الملفات المرجعية:
```

### 11.2 مصفوفة ربط الوثائق
اربط كل مهمة/متطلب/قرار إلى الأدلة التالية: المتطلبات → التصميم → الكود → الاختبارات → المهام → الملفات. أي عنصر لا يمكن تتبعه إلى ملف أو اختبار أو وثيقة يجب اعتباره غير مكتمل من ناحية الحوكمة.

### 11.3 دورة عمل المتابعة
1. مراجعة الوثائق الحالية.
2. مراجعة الكود والـ tests.
3. تحديث حالة المكونات.
4. اكتشاف الفجوات.
5. إنشاء المهام.
6. تنفيذ المهام.
7. التحقق.
8. تحديث التوثيق.

### 11.4 قالب تحويل الفجوة إلى مهمة
```text
العنوان:
الوصف:
السبب:
الملفات:
الاعتماديات:
معايير القبول:
الأولوية:
تقدير الجهد:
```

## 12) خطة الاستكمال

### قصير المدى
**الهدف:** إغلاق الفجوات التشغيلية الأكثر خطورة.  
**السبب:** هذه الفجوات تؤثر مباشرة على الثبات اليومي والثقة في النظام.  
**المخرجات:** queue أكثر موثوقية، تتبع أوضح للمهام، وتقليل drift بين baseline والواقع.  
**المهام:**
- تقوية ديمومة الـ job queue أو على الأقل جعل إعادة الإقلاع أكثر شفافية.
- إضافة/تعزيز اختبارات الواجهة الأمامية للرحلات الحرجة.
- تقليل ضجيج الأرشيف التاريخي أو وضع canonical index أوضح.
**الاعتماديات:** بنية queue الحالية، وCI الحالي، و`docs/architecture.md`.  
**المخاطر:** أي تغيير في queue قد يكسر discover/scan/AI task flows.  
**التحقق:** tests + startup smoke checks + health endpoint + manual verification.  
**المهارات المطلوبة:** backend، testing، DevOps.  
**الزمن التقديري:** قصير المدى.

### متوسط المدى
**الهدف:** تحسين الاعتمادية والاتساق على مستوى النظام كله.  
**السبب:** بعد تثبيت الأساسيات، يصبح أهم شيء هو الحد من drift بين contract/runtime/docs.  
**المخرجات:** traceability أقوى، UI coverage أفضل، وإدارة أصول أوضح.  
**المهام:**
- تحسين ربط الوثائق والملفات بالمفاهيم/المهام.
- توسيع الاختبارات التكاملية بين dashboard وAPI.
- تقوية governance للأصول الثنائية والتاريخية.
**الاعتماديات:** استقرار الـ runtime، and docs baseline.  
**المخاطر:** زيادة الوقت المستهلك في الحوكمة إذا لم تُبسّط الأدوات.  
**التحقق:** drift checks، route/spec parity، dashboards/tests.  
**المهارات المطلوبة:** full-stack، QA automation، information architecture.  
**الزمن التقديري:** متوسط المدى.

### طويل المدى
**الهدف:** نقل EngineeringOS إلى طبقة تشغيل مؤسسية أكثر نضجًا.  
**السبب:** سيبقى هناك حد طبيعي لما يمكن لqueue محلي وواجهة واحدة أن تحققه.  
**المخرجات:** job durability مؤسسية، archival policy، وربما توسيع multi-instance readiness.  
**المهام:**
- تحويل الـ job execution إلى نموذج أكثر ديمومة وتوزيعًا.
- إضفاء canonical source policy على الوثائق والأصول التاريخية.
- تعزيز القياس التشغيلي والـ observability.
**الاعتماديات:** قرار معماري، وربما توسعة infra.  
**المخاطر:** تعقيد تشغيلي أعلى.  
**التحقق:** اختبارات تحمل، failure injection، ومراقبة production-style.  
**المهارات المطلوبة:** platform engineering، distributed systems، observability.  
**الزمن التقديري:** طويل المدى.

## 13) سجل المخاطر

| الخطر | الأثر | الشدة | التخفيف |
|---|---|---|---|
| Queue loss on crash/restart | jobs may be lost or duplicated unless reconciliation runs cleanly | High | evolve queue durability or re-enqueue semantics |
| Historical drift | older reports can be mistaken for current truth | Medium | keep a single canonical baseline and mark archives clearly |
| Frontend blind spots | UI regressions may slip through without page tests | Medium | add dashboard-level tests for critical flows |
| Environment dependency | AI features degrade without Clerk/Groq secrets | Medium | document required secrets and add smoke checks |
| Binary evidence opacity | binary artifacts need separate tooling for deep verification | Medium | index binary evidence or extract text/OCR where needed |

## 14) قائمة الافتراضات غير المؤكدة

- I treated text-like files as fully parsed by programmatic inspection and binary artifacts as indexed by filename/type only.
- I treated docs/architecture.md as the current baseline because it explicitly says it is the current truth baseline.
- I treated docs/completion-plan.md and docs/fact-record.md as historical logs because they explicitly say so.
- I treated attached_assets as historical evidence and exports rather than runtime source code unless the filename clearly indicates otherwise.

## 15) ملحق يحتوي على جميع الملفات التي تم تحليلها

### ملاحظات الملحق
- الحقول: المسار الكامل، اسم الملف، النوع، الغرض المتوقع (استدلالي من المسار)، فئة المحتوى، وحالة القراءة.
- حالة القراءة: **مقروء بالكامل** للملفات النصية التي أمكن تحليلها آليًا، و**بيانات/فهرسة فقط** للأصول الثنائية أو الأرشيفية.
- ترتيب الملفات داخل كل قسم أبجدي.

#### `.agents` (40)

- `EngineeringOS-main/.agents/agent_assets_metadata.toml` | `agent_assets_metadata.toml` | `.toml` | other | text/doc/config | مقروء بالكامل
- `EngineeringOS-main/.agents/memory/MEMORY.md` | `MEMORY.md` | `.md` | decision memory and historical notes | text/doc/config | مقروء بالكامل
- `EngineeringOS-main/.agents/memory/ai-orchestrator-gap-closure.md` | `ai-orchestrator-gap-closure.md` | `.md` | decision memory and historical notes | text/doc/config | مقروء بالكامل
- `EngineeringOS-main/.agents/memory/ai-orchestrator-hardening.md` | `ai-orchestrator-hardening.md` | `.md` | decision memory and historical notes | text/doc/config | مقروء بالكامل
- `EngineeringOS-main/.agents/memory/ai-orchestrator-layer.md` | `ai-orchestrator-layer.md` | `.md` | decision memory and historical notes | text/doc/config | مقروء بالكامل
- `EngineeringOS-main/.agents/memory/ai-tool-calling.md` | `ai-tool-calling.md` | `.md` | decision memory and historical notes | text/doc/config | مقروء بالكامل
- `EngineeringOS-main/.agents/memory/audit-fixes.md` | `audit-fixes.md` | `.md` | decision memory and historical notes | text/doc/config | مقروء بالكامل
- `EngineeringOS-main/.agents/memory/clerk-401-race-cookie-vs-bearer.md` | `clerk-401-race-cookie-vs-bearer.md` | `.md` | decision memory and historical notes | text/doc/config | مقروء بالكامل
- `EngineeringOS-main/.agents/memory/clerk-auth-testing.md` | `clerk-auth-testing.md` | `.md` | decision memory and historical notes | text/doc/config | مقروء بالكامل
- `EngineeringOS-main/.agents/memory/completion-plan-stale-backlog.md` | `completion-plan-stale-backlog.md` | `.md` | decision memory and historical notes | text/doc/config | مقروء بالكامل
- `EngineeringOS-main/.agents/memory/context-cache-invalidation-rule.md` | `context-cache-invalidation-rule.md` | `.md` | decision memory and historical notes | text/doc/config | مقروء بالكامل
- `EngineeringOS-main/.agents/memory/dashboard-scoping-pr01.md` | `dashboard-scoping-pr01.md` | `.md` | decision memory and historical notes | text/doc/config | مقروء بالكامل
- `EngineeringOS-main/.agents/memory/discovery-adapter-registry.md` | `discovery-adapter-registry.md` | `.md` | decision memory and historical notes | text/doc/config | مقروء بالكامل
- `EngineeringOS-main/.agents/memory/discovery-feature.md` | `discovery-feature.md` | `.md` | decision memory and historical notes | text/doc/config | مقروء بالكامل
- `EngineeringOS-main/.agents/memory/discovery-multi-source.md` | `discovery-multi-source.md` | `.md` | decision memory and historical notes | text/doc/config | مقروء بالكامل
- `EngineeringOS-main/.agents/memory/drizzle-error-wrapping.md` | `drizzle-error-wrapping.md` | `.md` | decision memory and historical notes | text/doc/config | مقروء بالكامل
- `EngineeringOS-main/.agents/memory/engineeringos-completion-plan.md` | `engineeringos-completion-plan.md` | `.md` | decision memory and historical notes | text/doc/config | مقروء بالكامل
- `EngineeringOS-main/.agents/memory/fk-atomic-claim-ordering.md` | `fk-atomic-claim-ordering.md` | `.md` | decision memory and historical notes | text/doc/config | مقروء بالكامل
- `EngineeringOS-main/.agents/memory/forensic-audit-batch.md` | `forensic-audit-batch.md` | `.md` | decision memory and historical notes | text/doc/config | مقروء بالكامل
- `EngineeringOS-main/.agents/memory/forensic-audit-pr01-06.md` | `forensic-audit-pr01-06.md` | `.md` | decision memory and historical notes | text/doc/config | مقروء بالكامل
- `EngineeringOS-main/.agents/memory/gap-analysis-fixes-batch1.md` | `gap-analysis-fixes-batch1.md` | `.md` | decision memory and historical notes | text/doc/config | مقروء بالكامل
- `EngineeringOS-main/.agents/memory/gap-analysis-fixes-batch2.md` | `gap-analysis-fixes-batch2.md` | `.md` | decision memory and historical notes | text/doc/config | مقروء بالكامل
- `EngineeringOS-main/.agents/memory/git-ai-orchestrator-fixes.md` | `git-ai-orchestrator-fixes.md` | `.md` | decision memory and historical notes | text/doc/config | مقروء بالكامل
- `EngineeringOS-main/.agents/memory/imported-project-clerk-secrets.md` | `imported-project-clerk-secrets.md` | `.md` | decision memory and historical notes | text/doc/config | مقروء بالكامل
- `EngineeringOS-main/.agents/memory/imported-project-workflow-failures.md` | `imported-project-workflow-failures.md` | `.md` | decision memory and historical notes | text/doc/config | مقروء بالكامل
- `EngineeringOS-main/.agents/memory/knowledge-engine-bfs-depth.md` | `knowledge-engine-bfs-depth.md` | `.md` | decision memory and historical notes | text/doc/config | مقروء بالكامل
- `EngineeringOS-main/.agents/memory/knowledge-engine.md` | `knowledge-engine.md` | `.md` | decision memory and historical notes | text/doc/config | مقروء بالكامل
- `EngineeringOS-main/.agents/memory/orval-openapi-codegen.md` | `orval-openapi-codegen.md` | `.md` | decision memory and historical notes | text/doc/config | مقروء بالكامل
- `EngineeringOS-main/.agents/memory/pr-c-ai-autotrigger.md` | `pr-c-ai-autotrigger.md` | `.md` | decision memory and historical notes | text/doc/config | مقروء بالكامل
- `EngineeringOS-main/.agents/memory/pr-d-workflow-conditions.md` | `pr-d-workflow-conditions.md` | `.md` | decision memory and historical notes | text/doc/config | مقروء بالكامل
- `EngineeringOS-main/.agents/memory/pr-d1-job-queue-durability.md` | `pr-d1-job-queue-durability.md` | `.md` | decision memory and historical notes | text/doc/config | مقروء بالكامل
- `EngineeringOS-main/.agents/memory/pr-h-i-completion.md` | `pr-h-i-completion.md` | `.md` | decision memory and historical notes | text/doc/config | مقروء بالكامل
- `EngineeringOS-main/.agents/memory/pr01-job-durability.md` | `pr01-job-durability.md` | `.md` | decision memory and historical notes | text/doc/config | مقروء بالكامل
- `EngineeringOS-main/.agents/memory/pr02-provenance-layer.md` | `pr02-provenance-layer.md` | `.md` | decision memory and historical notes | text/doc/config | مقروء بالكامل
- `EngineeringOS-main/.agents/memory/pr04-discovery-hardening.md` | `pr04-discovery-hardening.md` | `.md` | decision memory and historical notes | text/doc/config | مقروء بالكامل
- `EngineeringOS-main/.agents/memory/project-bootstrap.md` | `project-bootstrap.md` | `.md` | decision memory and historical notes | text/doc/config | مقروء بالكامل
- `EngineeringOS-main/.agents/memory/project-ownership-scoping.md` | `project-ownership-scoping.md` | `.md` | decision memory and historical notes | text/doc/config | مقروء بالكامل
- `EngineeringOS-main/.agents/memory/scanner-ast-extraction.md` | `scanner-ast-extraction.md` | `.md` | decision memory and historical notes | text/doc/config | مقروء بالكامل
- `EngineeringOS-main/.agents/memory/testing-drift-checks.md` | `testing-drift-checks.md` | `.md` | decision memory and historical notes | text/doc/config | مقروء بالكامل
- `EngineeringOS-main/.agents/memory/trace-analysis.md` | `trace-analysis.md` | `.md` | decision memory and historical notes | text/doc/config | مقروء بالكامل

#### `artifacts` (237)

- `EngineeringOS-main/artifacts/api-server/.replit-artifact/artifact.toml` | `artifact.toml` | `.toml` | API server artifact | text/doc/config | مقروء بالكامل
- `EngineeringOS-main/artifacts/api-server/build.mjs` | `build.mjs` | `.mjs` | build/runtime configuration | code | مقروء بالكامل
- `EngineeringOS-main/artifacts/api-server/package.json` | `package.json` | `.json` | workspace configuration / repo governance | config/text | مقروء بالكامل
- `EngineeringOS-main/artifacts/api-server/src/app.ts` | `app.ts` | `.ts` | API server artifact | code | مقروء بالكامل
- `EngineeringOS-main/artifacts/api-server/src/config.ts` | `config.ts` | `.ts` | API server artifact | code | مقروء بالكامل
- `EngineeringOS-main/artifacts/api-server/src/index.ts` | `index.ts` | `.ts` | API server artifact | code | مقروء بالكامل
- `EngineeringOS-main/artifacts/api-server/src/lib/.gitkeep` | `.gitkeep` | `[noext]` | API server runtime utility | config/text | مقروء بالكامل
- `EngineeringOS-main/artifacts/api-server/src/lib/advisory-lock.ts` | `advisory-lock.ts` | `.ts` | API server runtime utility | code | مقروء بالكامل
- `EngineeringOS-main/artifacts/api-server/src/lib/ai-route-helpers.ts` | `ai-route-helpers.ts` | `.ts` | API server runtime utility | code | مقروء بالكامل
- `EngineeringOS-main/artifacts/api-server/src/lib/audit.ts` | `audit.ts` | `.ts` | API server runtime utility | code | مقروء بالكامل
- `EngineeringOS-main/artifacts/api-server/src/lib/condition-evaluator.ts` | `condition-evaluator.ts` | `.ts` | API server runtime utility | code | مقروء بالكامل
- `EngineeringOS-main/artifacts/api-server/src/lib/credentials-crypto.ts` | `credentials-crypto.ts` | `.ts` | API server runtime utility | code | مقروء بالكامل
- `EngineeringOS-main/artifacts/api-server/src/lib/db-rate-limiter.ts` | `db-rate-limiter.ts` | `.ts` | API server runtime utility | code | مقروء بالكامل
- `EngineeringOS-main/artifacts/api-server/src/lib/discovery-adapters.test.ts` | `discovery-adapters.test.ts` | `.ts` | API server runtime utility | code | مقروء بالكامل
- `EngineeringOS-main/artifacts/api-server/src/lib/discovery-adapters.ts` | `discovery-adapters.ts` | `.ts` | API server runtime utility | code | مقروء بالكامل
- `EngineeringOS-main/artifacts/api-server/src/lib/discovery-runner.ts` | `discovery-runner.ts` | `.ts` | API server runtime utility | code | مقروء بالكامل
- `EngineeringOS-main/artifacts/api-server/src/lib/graph-provenance.ts` | `graph-provenance.ts` | `.ts` | API server runtime utility | code | مقروء بالكامل
- `EngineeringOS-main/artifacts/api-server/src/lib/job-queue.test.ts` | `job-queue.test.ts` | `.ts` | API server runtime utility | code | مقروء بالكامل
- `EngineeringOS-main/artifacts/api-server/src/lib/job-queue.ts` | `job-queue.ts` | `.ts` | API server runtime utility | code | مقروء بالكامل
- `EngineeringOS-main/artifacts/api-server/src/lib/job-reconciliation.test.ts` | `job-reconciliation.test.ts` | `.ts` | API server runtime utility | code | مقروء بالكامل
- `EngineeringOS-main/artifacts/api-server/src/lib/job-reconciliation.ts` | `job-reconciliation.ts` | `.ts` | API server runtime utility | code | مقروء بالكامل
- `EngineeringOS-main/artifacts/api-server/src/lib/logger.ts` | `logger.ts` | `.ts` | API server runtime utility | code | مقروء بالكامل
- `EngineeringOS-main/artifacts/api-server/src/lib/operational-counters.ts` | `operational-counters.ts` | `.ts` | API server runtime utility | code | مقروء بالكامل
- `EngineeringOS-main/artifacts/api-server/src/lib/path-validation.test.ts` | `path-validation.test.ts` | `.ts` | API server runtime utility | code | مقروء بالكامل
- `EngineeringOS-main/artifacts/api-server/src/lib/path-validation.ts` | `path-validation.ts` | `.ts` | API server runtime utility | code | مقروء بالكامل
- `EngineeringOS-main/artifacts/api-server/src/lib/plugin-runtime.test.ts` | `plugin-runtime.test.ts` | `.ts` | API server runtime utility | code | مقروء بالكامل
- `EngineeringOS-main/artifacts/api-server/src/lib/plugin-runtime.ts` | `plugin-runtime.ts` | `.ts` | API server runtime utility | code | مقروء بالكامل
- `EngineeringOS-main/artifacts/api-server/src/lib/project-error.test.ts` | `project-error.test.ts` | `.ts` | API server runtime utility | code | مقروء بالكامل
- `EngineeringOS-main/artifacts/api-server/src/lib/rootpath-validator.ts` | `rootpath-validator.ts` | `.ts` | API server runtime utility | code | مقروء بالكامل
- `EngineeringOS-main/artifacts/api-server/src/lib/scan-runner.ts` | `scan-runner.ts` | `.ts` | API server runtime utility | code | مقروء بالكامل
- `EngineeringOS-main/artifacts/api-server/src/lib/startup-migrations.ts` | `startup-migrations.ts` | `.ts` | API server runtime utility | code | مقروء بالكامل
- `EngineeringOS-main/artifacts/api-server/src/lib/upload-store.test.ts` | `upload-store.test.ts` | `.ts` | API server runtime utility | code | مقروء بالكامل
- `EngineeringOS-main/artifacts/api-server/src/lib/upload-store.ts` | `upload-store.ts` | `.ts` | API server runtime utility | code | مقروء بالكامل
- `EngineeringOS-main/artifacts/api-server/src/middlewares/.gitkeep` | `.gitkeep` | `[noext]` | request/auth middleware | config/text | مقروء بالكامل
- `EngineeringOS-main/artifacts/api-server/src/middlewares/clerkProxyMiddleware.ts` | `clerkProxyMiddleware.ts` | `.ts` | request/auth middleware | code | مقروء بالكامل
- `EngineeringOS-main/artifacts/api-server/src/middlewares/requireAuth.test.ts` | `requireAuth.test.ts` | `.ts` | request/auth middleware | code | مقروء بالكامل
- `EngineeringOS-main/artifacts/api-server/src/middlewares/requireAuth.ts` | `requireAuth.ts` | `.ts` | request/auth middleware | code | مقروء بالكامل
- `EngineeringOS-main/artifacts/api-server/src/middlewares/requireProjectAccess.ts` | `requireProjectAccess.ts` | `.ts` | request/auth middleware | code | مقروء بالكامل
- `EngineeringOS-main/artifacts/api-server/src/routes/ai-route-parity.test.ts` | `ai-route-parity.test.ts` | `.ts` | runtime API route | code | مقروء بالكامل
- `EngineeringOS-main/artifacts/api-server/src/routes/ai.test.ts` | `ai.test.ts` | `.ts` | runtime API route | code | مقروء بالكامل
- `EngineeringOS-main/artifacts/api-server/src/routes/ai.ts` | `ai.ts` | `.ts` | runtime API route | code | مقروء بالكامل
- `EngineeringOS-main/artifacts/api-server/src/routes/ai/analysis.ts` | `analysis.ts` | `.ts` | runtime API route | code | مقروء بالكامل
- `EngineeringOS-main/artifacts/api-server/src/routes/ai/chat.ts` | `chat.ts` | `.ts` | runtime API route | code | مقروء بالكامل
- `EngineeringOS-main/artifacts/api-server/src/routes/ai/index.ts` | `index.ts` | `.ts` | runtime API route | code | مقروء بالكامل
- `EngineeringOS-main/artifacts/api-server/src/routes/ai/providers.ts` | `providers.ts` | `.ts` | runtime API route | code | مقروء بالكامل
- `EngineeringOS-main/artifacts/api-server/src/routes/ai/tasks.ts` | `tasks.ts` | `.ts` | runtime API route | code | مقروء بالكامل
- `EngineeringOS-main/artifacts/api-server/src/routes/ai/workflows.ts` | `workflows.ts` | `.ts` | runtime API route | code | مقروء بالكامل
- `EngineeringOS-main/artifacts/api-server/src/routes/dashboard.test.ts` | `dashboard.test.ts` | `.ts` | runtime API route | code | مقروء بالكامل
- `EngineeringOS-main/artifacts/api-server/src/routes/dashboard.ts` | `dashboard.ts` | `.ts` | runtime API route | code | مقروء بالكامل
- `EngineeringOS-main/artifacts/api-server/src/routes/discovery.test.ts` | `discovery.test.ts` | `.ts` | runtime API route | code | مقروء بالكامل
- `EngineeringOS-main/artifacts/api-server/src/routes/discovery.ts` | `discovery.ts` | `.ts` | runtime API route | code | مقروء بالكامل
- `EngineeringOS-main/artifacts/api-server/src/routes/events.test.ts` | `events.test.ts` | `.ts` | runtime API route | code | مقروء بالكامل
- `EngineeringOS-main/artifacts/api-server/src/routes/events.ts` | `events.ts` | `.ts` | runtime API route | code | مقروء بالكامل
- `EngineeringOS-main/artifacts/api-server/src/routes/git.ts` | `git.ts` | `.ts` | runtime API route | code | مقروء بالكامل
- `EngineeringOS-main/artifacts/api-server/src/routes/graph.test.ts` | `graph.test.ts` | `.ts` | runtime API route | code | مقروء بالكامل
- `EngineeringOS-main/artifacts/api-server/src/routes/graph.ts` | `graph.ts` | `.ts` | runtime API route | code | مقروء بالكامل
- `EngineeringOS-main/artifacts/api-server/src/routes/health.test.ts` | `health.test.ts` | `.ts` | runtime API route | code | مقروء بالكامل
- `EngineeringOS-main/artifacts/api-server/src/routes/health.ts` | `health.ts` | `.ts` | runtime API route | code | مقروء بالكامل
- `EngineeringOS-main/artifacts/api-server/src/routes/index.ts` | `index.ts` | `.ts` | runtime API route | code | مقروء بالكامل
- `EngineeringOS-main/artifacts/api-server/src/routes/metrics.test.ts` | `metrics.test.ts` | `.ts` | runtime API route | code | مقروء بالكامل
- `EngineeringOS-main/artifacts/api-server/src/routes/metrics.ts` | `metrics.ts` | `.ts` | runtime API route | code | مقروء بالكامل
- `EngineeringOS-main/artifacts/api-server/src/routes/plugins.test.ts` | `plugins.test.ts` | `.ts` | runtime API route | code | مقروء بالكامل
- `EngineeringOS-main/artifacts/api-server/src/routes/plugins.ts` | `plugins.ts` | `.ts` | runtime API route | code | مقروء بالكامل
- `EngineeringOS-main/artifacts/api-server/src/routes/projects.test.ts` | `projects.test.ts` | `.ts` | runtime API route | code | مقروء بالكامل
- `EngineeringOS-main/artifacts/api-server/src/routes/projects.ts` | `projects.ts` | `.ts` | runtime API route | code | مقروء بالكامل
- `EngineeringOS-main/artifacts/api-server/src/routes/rules.test.ts` | `rules.test.ts` | `.ts` | runtime API route | code | مقروء بالكامل
- `EngineeringOS-main/artifacts/api-server/src/routes/rules.ts` | `rules.ts` | `.ts` | runtime API route | code | مقروء بالكامل
- `EngineeringOS-main/artifacts/api-server/src/routes/tasks.test.ts` | `tasks.test.ts` | `.ts` | runtime API route | code | مقروء بالكامل
- `EngineeringOS-main/artifacts/api-server/src/routes/tasks.ts` | `tasks.ts` | `.ts` | runtime API route | code | مقروء بالكامل
- `EngineeringOS-main/artifacts/api-server/src/routes/upload.ts` | `upload.ts` | `.ts` | runtime API route | code | مقروء بالكامل
- `EngineeringOS-main/artifacts/api-server/src/routes/workflows.test.ts` | `workflows.test.ts` | `.ts` | runtime API route | code | مقروء بالكامل
- `EngineeringOS-main/artifacts/api-server/src/routes/workflows.ts` | `workflows.ts` | `.ts` | runtime API route | code | مقروء بالكامل
- `EngineeringOS-main/artifacts/api-server/src/scripts/seed-provenance.ts` | `seed-provenance.ts` | `.ts` | API server artifact | code | مقروء بالكامل
- `EngineeringOS-main/artifacts/api-server/src/services/task-service.ts` | `task-service.ts` | `.ts` | API server artifact | code | مقروء بالكامل
- `EngineeringOS-main/artifacts/api-server/src/services/workflow-service.ts` | `workflow-service.ts` | `.ts` | API server artifact | code | مقروء بالكامل
- `EngineeringOS-main/artifacts/api-server/src/types/express.d.ts` | `express.d.ts` | `.ts` | API server artifact | code | مقروء بالكامل
- `EngineeringOS-main/artifacts/api-server/tsconfig.json` | `tsconfig.json` | `.json` | workspace configuration / repo governance | config/text | مقروء بالكامل
- `EngineeringOS-main/artifacts/api-server/vitest.config.ts` | `vitest.config.ts` | `.ts` | API server artifact | code | مقروء بالكامل
- `EngineeringOS-main/artifacts/dashboard/.replit-artifact/artifact.toml` | `artifact.toml` | `.toml` | dashboard artifact | text/doc/config | مقروء بالكامل
- `EngineeringOS-main/artifacts/dashboard/components.json` | `components.json` | `.json` | dashboard build/config | text/doc/config | مقروء بالكامل
- `EngineeringOS-main/artifacts/dashboard/index.html` | `index.html` | `.html` | dashboard build/config | text/doc/config | مقروء بالكامل
- `EngineeringOS-main/artifacts/dashboard/package.json` | `package.json` | `.json` | workspace configuration / repo governance | config/text | مقروء بالكامل
- `EngineeringOS-main/artifacts/dashboard/public/favicon.svg` | `favicon.svg` | `.svg` | dashboard artifact | text/doc/config | مقروء بالكامل
- `EngineeringOS-main/artifacts/dashboard/public/logo.svg` | `logo.svg` | `.svg` | dashboard artifact | text/doc/config | مقروء بالكامل
- `EngineeringOS-main/artifacts/dashboard/public/robots.txt` | `robots.txt` | `.txt` | dashboard artifact | text/doc/config | مقروء بالكامل
- `EngineeringOS-main/artifacts/dashboard/src/App.tsx` | `App.tsx` | `.tsx` | dashboard artifact | code | مقروء بالكامل
- `EngineeringOS-main/artifacts/dashboard/src/components/GitPanel.tsx` | `GitPanel.tsx` | `.tsx` | dashboard component | code | مقروء بالكامل
- `EngineeringOS-main/artifacts/dashboard/src/components/layout/Shell.tsx` | `Shell.tsx` | `.tsx` | dashboard component | code | مقروء بالكامل
- `EngineeringOS-main/artifacts/dashboard/src/components/layout/Sidebar.tsx` | `Sidebar.tsx` | `.tsx` | dashboard component | code | مقروء بالكامل
- `EngineeringOS-main/artifacts/dashboard/src/components/ui/accordion.tsx` | `accordion.tsx` | `.tsx` | dashboard component | code | مقروء بالكامل
- `EngineeringOS-main/artifacts/dashboard/src/components/ui/alert-dialog.tsx` | `alert-dialog.tsx` | `.tsx` | dashboard component | code | مقروء بالكامل
- `EngineeringOS-main/artifacts/dashboard/src/components/ui/alert.tsx` | `alert.tsx` | `.tsx` | dashboard component | code | مقروء بالكامل
- `EngineeringOS-main/artifacts/dashboard/src/components/ui/aspect-ratio.tsx` | `aspect-ratio.tsx` | `.tsx` | dashboard component | code | مقروء بالكامل
- `EngineeringOS-main/artifacts/dashboard/src/components/ui/avatar.tsx` | `avatar.tsx` | `.tsx` | dashboard component | code | مقروء بالكامل
- `EngineeringOS-main/artifacts/dashboard/src/components/ui/badge.tsx` | `badge.tsx` | `.tsx` | dashboard component | code | مقروء بالكامل
- `EngineeringOS-main/artifacts/dashboard/src/components/ui/breadcrumb.tsx` | `breadcrumb.tsx` | `.tsx` | dashboard component | code | مقروء بالكامل
- `EngineeringOS-main/artifacts/dashboard/src/components/ui/button-group.tsx` | `button-group.tsx` | `.tsx` | dashboard component | code | مقروء بالكامل
- `EngineeringOS-main/artifacts/dashboard/src/components/ui/button.tsx` | `button.tsx` | `.tsx` | dashboard component | code | مقروء بالكامل
- `EngineeringOS-main/artifacts/dashboard/src/components/ui/calendar.tsx` | `calendar.tsx` | `.tsx` | dashboard component | code | مقروء بالكامل
- `EngineeringOS-main/artifacts/dashboard/src/components/ui/card.tsx` | `card.tsx` | `.tsx` | dashboard component | code | مقروء بالكامل
- `EngineeringOS-main/artifacts/dashboard/src/components/ui/carousel.tsx` | `carousel.tsx` | `.tsx` | dashboard component | code | مقروء بالكامل
- `EngineeringOS-main/artifacts/dashboard/src/components/ui/chart.tsx` | `chart.tsx` | `.tsx` | dashboard component | code | مقروء بالكامل
- `EngineeringOS-main/artifacts/dashboard/src/components/ui/checkbox.tsx` | `checkbox.tsx` | `.tsx` | dashboard component | code | مقروء بالكامل
- `EngineeringOS-main/artifacts/dashboard/src/components/ui/collapsible.tsx` | `collapsible.tsx` | `.tsx` | dashboard component | code | مقروء بالكامل
- `EngineeringOS-main/artifacts/dashboard/src/components/ui/command.tsx` | `command.tsx` | `.tsx` | dashboard component | code | مقروء بالكامل
- `EngineeringOS-main/artifacts/dashboard/src/components/ui/context-menu.tsx` | `context-menu.tsx` | `.tsx` | dashboard component | code | مقروء بالكامل
- `EngineeringOS-main/artifacts/dashboard/src/components/ui/dialog.tsx` | `dialog.tsx` | `.tsx` | dashboard component | code | مقروء بالكامل
- `EngineeringOS-main/artifacts/dashboard/src/components/ui/drawer.tsx` | `drawer.tsx` | `.tsx` | dashboard component | code | مقروء بالكامل
- `EngineeringOS-main/artifacts/dashboard/src/components/ui/dropdown-menu.tsx` | `dropdown-menu.tsx` | `.tsx` | dashboard component | code | مقروء بالكامل
- `EngineeringOS-main/artifacts/dashboard/src/components/ui/empty.tsx` | `empty.tsx` | `.tsx` | dashboard component | code | مقروء بالكامل
- `EngineeringOS-main/artifacts/dashboard/src/components/ui/field.tsx` | `field.tsx` | `.tsx` | dashboard component | code | مقروء بالكامل
- `EngineeringOS-main/artifacts/dashboard/src/components/ui/form.tsx` | `form.tsx` | `.tsx` | dashboard component | code | مقروء بالكامل
- `EngineeringOS-main/artifacts/dashboard/src/components/ui/hover-card.tsx` | `hover-card.tsx` | `.tsx` | dashboard component | code | مقروء بالكامل
- `EngineeringOS-main/artifacts/dashboard/src/components/ui/input-group.tsx` | `input-group.tsx` | `.tsx` | dashboard component | code | مقروء بالكامل
- `EngineeringOS-main/artifacts/dashboard/src/components/ui/input-otp.tsx` | `input-otp.tsx` | `.tsx` | dashboard component | code | مقروء بالكامل
- `EngineeringOS-main/artifacts/dashboard/src/components/ui/input.tsx` | `input.tsx` | `.tsx` | dashboard component | code | مقروء بالكامل
- `EngineeringOS-main/artifacts/dashboard/src/components/ui/item.tsx` | `item.tsx` | `.tsx` | dashboard component | code | مقروء بالكامل
- `EngineeringOS-main/artifacts/dashboard/src/components/ui/kbd.tsx` | `kbd.tsx` | `.tsx` | dashboard component | code | مقروء بالكامل
- `EngineeringOS-main/artifacts/dashboard/src/components/ui/label.tsx` | `label.tsx` | `.tsx` | dashboard component | code | مقروء بالكامل
- `EngineeringOS-main/artifacts/dashboard/src/components/ui/menubar.tsx` | `menubar.tsx` | `.tsx` | dashboard component | code | مقروء بالكامل
- `EngineeringOS-main/artifacts/dashboard/src/components/ui/navigation-menu.tsx` | `navigation-menu.tsx` | `.tsx` | dashboard component | code | مقروء بالكامل
- `EngineeringOS-main/artifacts/dashboard/src/components/ui/pagination.tsx` | `pagination.tsx` | `.tsx` | dashboard component | code | مقروء بالكامل
- `EngineeringOS-main/artifacts/dashboard/src/components/ui/popover.tsx` | `popover.tsx` | `.tsx` | dashboard component | code | مقروء بالكامل
- `EngineeringOS-main/artifacts/dashboard/src/components/ui/progress.tsx` | `progress.tsx` | `.tsx` | dashboard component | code | مقروء بالكامل
- `EngineeringOS-main/artifacts/dashboard/src/components/ui/radio-group.tsx` | `radio-group.tsx` | `.tsx` | dashboard component | code | مقروء بالكامل
- `EngineeringOS-main/artifacts/dashboard/src/components/ui/resizable.tsx` | `resizable.tsx` | `.tsx` | dashboard component | code | مقروء بالكامل
- `EngineeringOS-main/artifacts/dashboard/src/components/ui/scroll-area.tsx` | `scroll-area.tsx` | `.tsx` | dashboard component | code | مقروء بالكامل
- `EngineeringOS-main/artifacts/dashboard/src/components/ui/select.tsx` | `select.tsx` | `.tsx` | dashboard component | code | مقروء بالكامل
- `EngineeringOS-main/artifacts/dashboard/src/components/ui/separator.tsx` | `separator.tsx` | `.tsx` | dashboard component | code | مقروء بالكامل
- `EngineeringOS-main/artifacts/dashboard/src/components/ui/sheet.tsx` | `sheet.tsx` | `.tsx` | dashboard component | code | مقروء بالكامل
- `EngineeringOS-main/artifacts/dashboard/src/components/ui/sidebar.tsx` | `sidebar.tsx` | `.tsx` | dashboard component | code | مقروء بالكامل
- `EngineeringOS-main/artifacts/dashboard/src/components/ui/skeleton.tsx` | `skeleton.tsx` | `.tsx` | dashboard component | code | مقروء بالكامل
- `EngineeringOS-main/artifacts/dashboard/src/components/ui/slider.tsx` | `slider.tsx` | `.tsx` | dashboard component | code | مقروء بالكامل
- `EngineeringOS-main/artifacts/dashboard/src/components/ui/sonner.tsx` | `sonner.tsx` | `.tsx` | dashboard component | code | مقروء بالكامل
- `EngineeringOS-main/artifacts/dashboard/src/components/ui/spinner.tsx` | `spinner.tsx` | `.tsx` | dashboard component | code | مقروء بالكامل
- `EngineeringOS-main/artifacts/dashboard/src/components/ui/switch.tsx` | `switch.tsx` | `.tsx` | dashboard component | code | مقروء بالكامل
- `EngineeringOS-main/artifacts/dashboard/src/components/ui/table.tsx` | `table.tsx` | `.tsx` | dashboard component | code | مقروء بالكامل
- `EngineeringOS-main/artifacts/dashboard/src/components/ui/tabs.tsx` | `tabs.tsx` | `.tsx` | dashboard component | code | مقروء بالكامل
- `EngineeringOS-main/artifacts/dashboard/src/components/ui/textarea.tsx` | `textarea.tsx` | `.tsx` | dashboard component | code | مقروء بالكامل
- `EngineeringOS-main/artifacts/dashboard/src/components/ui/toast.tsx` | `toast.tsx` | `.tsx` | dashboard component | code | مقروء بالكامل
- `EngineeringOS-main/artifacts/dashboard/src/components/ui/toaster.tsx` | `toaster.tsx` | `.tsx` | dashboard component | code | مقروء بالكامل
- `EngineeringOS-main/artifacts/dashboard/src/components/ui/toggle-group.tsx` | `toggle-group.tsx` | `.tsx` | dashboard component | code | مقروء بالكامل
- `EngineeringOS-main/artifacts/dashboard/src/components/ui/toggle.tsx` | `toggle.tsx` | `.tsx` | dashboard component | code | مقروء بالكامل
- `EngineeringOS-main/artifacts/dashboard/src/components/ui/tooltip.tsx` | `tooltip.tsx` | `.tsx` | dashboard component | code | مقروء بالكامل
- `EngineeringOS-main/artifacts/dashboard/src/hooks/use-mobile.tsx` | `use-mobile.tsx` | `.tsx` | dashboard hook | code | مقروء بالكامل
- `EngineeringOS-main/artifacts/dashboard/src/hooks/use-toast.ts` | `use-toast.ts` | `.ts` | dashboard hook | code | مقروء بالكامل
- `EngineeringOS-main/artifacts/dashboard/src/index.css` | `index.css` | `.css` | dashboard artifact | text/doc/config | مقروء بالكامل
- `EngineeringOS-main/artifacts/dashboard/src/lib/api-fetch.ts` | `api-fetch.ts` | `.ts` | dashboard utility | code | مقروء بالكامل
- `EngineeringOS-main/artifacts/dashboard/src/lib/clerk.ts` | `clerk.ts` | `.ts` | dashboard utility | code | مقروء بالكامل
- `EngineeringOS-main/artifacts/dashboard/src/lib/utils.ts` | `utils.ts` | `.ts` | dashboard utility | code | مقروء بالكامل
- `EngineeringOS-main/artifacts/dashboard/src/main.tsx` | `main.tsx` | `.tsx` | dashboard artifact | code | مقروء بالكامل
- `EngineeringOS-main/artifacts/dashboard/src/pages/AiChat.tsx` | `AiChat.tsx` | `.tsx` | dashboard page | code | مقروء بالكامل
- `EngineeringOS-main/artifacts/dashboard/src/pages/Dashboard.tsx` | `Dashboard.tsx` | `.tsx` | dashboard page | code | مقروء بالكامل
- `EngineeringOS-main/artifacts/dashboard/src/pages/DiscoverProjectWizard.tsx` | `DiscoverProjectWizard.tsx` | `.tsx` | dashboard page | code | مقروء بالكامل
- `EngineeringOS-main/artifacts/dashboard/src/pages/Events.tsx` | `Events.tsx` | `.tsx` | dashboard page | code | مقروء بالكامل
- `EngineeringOS-main/artifacts/dashboard/src/pages/Graph.tsx` | `Graph.tsx` | `.tsx` | dashboard page | code | مقروء بالكامل
- `EngineeringOS-main/artifacts/dashboard/src/pages/Landing.tsx` | `Landing.tsx` | `.tsx` | dashboard page | code | مقروء بالكامل
- `EngineeringOS-main/artifacts/dashboard/src/pages/Metrics.tsx` | `Metrics.tsx` | `.tsx` | dashboard page | code | مقروء بالكامل
- `EngineeringOS-main/artifacts/dashboard/src/pages/ProjectDetail.tsx` | `ProjectDetail.tsx` | `.tsx` | dashboard page | code | مقروء بالكامل
- `EngineeringOS-main/artifacts/dashboard/src/pages/Projects.tsx` | `Projects.tsx` | `.tsx` | dashboard page | code | مقروء بالكامل
- `EngineeringOS-main/artifacts/dashboard/src/pages/Rules.tsx` | `Rules.tsx` | `.tsx` | dashboard page | code | مقروء بالكامل
- `EngineeringOS-main/artifacts/dashboard/src/pages/SignIn.tsx` | `SignIn.tsx` | `.tsx` | dashboard page | code | مقروء بالكامل
- `EngineeringOS-main/artifacts/dashboard/src/pages/SignUp.tsx` | `SignUp.tsx` | `.tsx` | dashboard page | code | مقروء بالكامل
- `EngineeringOS-main/artifacts/dashboard/src/pages/Tasks.tsx` | `Tasks.tsx` | `.tsx` | dashboard page | code | مقروء بالكامل
- `EngineeringOS-main/artifacts/dashboard/src/pages/Workflows.tsx` | `Workflows.tsx` | `.tsx` | dashboard page | code | مقروء بالكامل
- `EngineeringOS-main/artifacts/dashboard/src/pages/not-found.tsx` | `not-found.tsx` | `.tsx` | dashboard page | code | مقروء بالكامل
- `EngineeringOS-main/artifacts/dashboard/tsconfig.json` | `tsconfig.json` | `.json` | workspace configuration / repo governance | config/text | مقروء بالكامل
- `EngineeringOS-main/artifacts/dashboard/vite.config.ts` | `vite.config.ts` | `.ts` | dashboard build/config | code | مقروء بالكامل
- `EngineeringOS-main/artifacts/mockup-sandbox/.replit-artifact/artifact.toml` | `artifact.toml` | `.toml` | mockup sandbox artifact | text/doc/config | مقروء بالكامل
- `EngineeringOS-main/artifacts/mockup-sandbox/components.json` | `components.json` | `.json` | mockup sandbox artifact | text/doc/config | مقروء بالكامل
- `EngineeringOS-main/artifacts/mockup-sandbox/index.html` | `index.html` | `.html` | mockup sandbox artifact | text/doc/config | مقروء بالكامل
- `EngineeringOS-main/artifacts/mockup-sandbox/mockupPreviewPlugin.ts` | `mockupPreviewPlugin.ts` | `.ts` | mockup sandbox artifact | code | مقروء بالكامل
- `EngineeringOS-main/artifacts/mockup-sandbox/package.json` | `package.json` | `.json` | workspace configuration / repo governance | config/text | مقروء بالكامل
- `EngineeringOS-main/artifacts/mockup-sandbox/src/.generated/mockup-components.ts` | `mockup-components.ts` | `.ts` | mockup sandbox UI | code | مقروء بالكامل
- `EngineeringOS-main/artifacts/mockup-sandbox/src/App.tsx` | `App.tsx` | `.tsx` | mockup sandbox UI | code | مقروء بالكامل
- `EngineeringOS-main/artifacts/mockup-sandbox/src/components/ui/accordion.tsx` | `accordion.tsx` | `.tsx` | mockup sandbox UI | code | مقروء بالكامل
- `EngineeringOS-main/artifacts/mockup-sandbox/src/components/ui/alert-dialog.tsx` | `alert-dialog.tsx` | `.tsx` | mockup sandbox UI | code | مقروء بالكامل
- `EngineeringOS-main/artifacts/mockup-sandbox/src/components/ui/alert.tsx` | `alert.tsx` | `.tsx` | mockup sandbox UI | code | مقروء بالكامل
- `EngineeringOS-main/artifacts/mockup-sandbox/src/components/ui/aspect-ratio.tsx` | `aspect-ratio.tsx` | `.tsx` | mockup sandbox UI | code | مقروء بالكامل
- `EngineeringOS-main/artifacts/mockup-sandbox/src/components/ui/avatar.tsx` | `avatar.tsx` | `.tsx` | mockup sandbox UI | code | مقروء بالكامل
- `EngineeringOS-main/artifacts/mockup-sandbox/src/components/ui/badge.tsx` | `badge.tsx` | `.tsx` | mockup sandbox UI | code | مقروء بالكامل
- `EngineeringOS-main/artifacts/mockup-sandbox/src/components/ui/breadcrumb.tsx` | `breadcrumb.tsx` | `.tsx` | mockup sandbox UI | code | مقروء بالكامل
- `EngineeringOS-main/artifacts/mockup-sandbox/src/components/ui/button-group.tsx` | `button-group.tsx` | `.tsx` | mockup sandbox UI | code | مقروء بالكامل
- `EngineeringOS-main/artifacts/mockup-sandbox/src/components/ui/button.tsx` | `button.tsx` | `.tsx` | mockup sandbox UI | code | مقروء بالكامل
- `EngineeringOS-main/artifacts/mockup-sandbox/src/components/ui/calendar.tsx` | `calendar.tsx` | `.tsx` | mockup sandbox UI | code | مقروء بالكامل
- `EngineeringOS-main/artifacts/mockup-sandbox/src/components/ui/card.tsx` | `card.tsx` | `.tsx` | mockup sandbox UI | code | مقروء بالكامل
- `EngineeringOS-main/artifacts/mockup-sandbox/src/components/ui/carousel.tsx` | `carousel.tsx` | `.tsx` | mockup sandbox UI | code | مقروء بالكامل
- `EngineeringOS-main/artifacts/mockup-sandbox/src/components/ui/chart.tsx` | `chart.tsx` | `.tsx` | mockup sandbox UI | code | مقروء بالكامل
- `EngineeringOS-main/artifacts/mockup-sandbox/src/components/ui/checkbox.tsx` | `checkbox.tsx` | `.tsx` | mockup sandbox UI | code | مقروء بالكامل
- `EngineeringOS-main/artifacts/mockup-sandbox/src/components/ui/collapsible.tsx` | `collapsible.tsx` | `.tsx` | mockup sandbox UI | code | مقروء بالكامل
- `EngineeringOS-main/artifacts/mockup-sandbox/src/components/ui/command.tsx` | `command.tsx` | `.tsx` | mockup sandbox UI | code | مقروء بالكامل
- `EngineeringOS-main/artifacts/mockup-sandbox/src/components/ui/context-menu.tsx` | `context-menu.tsx` | `.tsx` | mockup sandbox UI | code | مقروء بالكامل
- `EngineeringOS-main/artifacts/mockup-sandbox/src/components/ui/dialog.tsx` | `dialog.tsx` | `.tsx` | mockup sandbox UI | code | مقروء بالكامل
- `EngineeringOS-main/artifacts/mockup-sandbox/src/components/ui/drawer.tsx` | `drawer.tsx` | `.tsx` | mockup sandbox UI | code | مقروء بالكامل
- `EngineeringOS-main/artifacts/mockup-sandbox/src/components/ui/dropdown-menu.tsx` | `dropdown-menu.tsx` | `.tsx` | mockup sandbox UI | code | مقروء بالكامل
- `EngineeringOS-main/artifacts/mockup-sandbox/src/components/ui/empty.tsx` | `empty.tsx` | `.tsx` | mockup sandbox UI | code | مقروء بالكامل
- `EngineeringOS-main/artifacts/mockup-sandbox/src/components/ui/field.tsx` | `field.tsx` | `.tsx` | mockup sandbox UI | code | مقروء بالكامل
- `EngineeringOS-main/artifacts/mockup-sandbox/src/components/ui/form.tsx` | `form.tsx` | `.tsx` | mockup sandbox UI | code | مقروء بالكامل
- `EngineeringOS-main/artifacts/mockup-sandbox/src/components/ui/hover-card.tsx` | `hover-card.tsx` | `.tsx` | mockup sandbox UI | code | مقروء بالكامل
- `EngineeringOS-main/artifacts/mockup-sandbox/src/components/ui/input-group.tsx` | `input-group.tsx` | `.tsx` | mockup sandbox UI | code | مقروء بالكامل
- `EngineeringOS-main/artifacts/mockup-sandbox/src/components/ui/input-otp.tsx` | `input-otp.tsx` | `.tsx` | mockup sandbox UI | code | مقروء بالكامل
- `EngineeringOS-main/artifacts/mockup-sandbox/src/components/ui/input.tsx` | `input.tsx` | `.tsx` | mockup sandbox UI | code | مقروء بالكامل
- `EngineeringOS-main/artifacts/mockup-sandbox/src/components/ui/item.tsx` | `item.tsx` | `.tsx` | mockup sandbox UI | code | مقروء بالكامل
- `EngineeringOS-main/artifacts/mockup-sandbox/src/components/ui/kbd.tsx` | `kbd.tsx` | `.tsx` | mockup sandbox UI | code | مقروء بالكامل
- `EngineeringOS-main/artifacts/mockup-sandbox/src/components/ui/label.tsx` | `label.tsx` | `.tsx` | mockup sandbox UI | code | مقروء بالكامل
- `EngineeringOS-main/artifacts/mockup-sandbox/src/components/ui/menubar.tsx` | `menubar.tsx` | `.tsx` | mockup sandbox UI | code | مقروء بالكامل
- `EngineeringOS-main/artifacts/mockup-sandbox/src/components/ui/navigation-menu.tsx` | `navigation-menu.tsx` | `.tsx` | mockup sandbox UI | code | مقروء بالكامل
- `EngineeringOS-main/artifacts/mockup-sandbox/src/components/ui/pagination.tsx` | `pagination.tsx` | `.tsx` | mockup sandbox UI | code | مقروء بالكامل
- `EngineeringOS-main/artifacts/mockup-sandbox/src/components/ui/popover.tsx` | `popover.tsx` | `.tsx` | mockup sandbox UI | code | مقروء بالكامل
- `EngineeringOS-main/artifacts/mockup-sandbox/src/components/ui/progress.tsx` | `progress.tsx` | `.tsx` | mockup sandbox UI | code | مقروء بالكامل
- `EngineeringOS-main/artifacts/mockup-sandbox/src/components/ui/radio-group.tsx` | `radio-group.tsx` | `.tsx` | mockup sandbox UI | code | مقروء بالكامل
- `EngineeringOS-main/artifacts/mockup-sandbox/src/components/ui/resizable.tsx` | `resizable.tsx` | `.tsx` | mockup sandbox UI | code | مقروء بالكامل
- `EngineeringOS-main/artifacts/mockup-sandbox/src/components/ui/scroll-area.tsx` | `scroll-area.tsx` | `.tsx` | mockup sandbox UI | code | مقروء بالكامل
- `EngineeringOS-main/artifacts/mockup-sandbox/src/components/ui/select.tsx` | `select.tsx` | `.tsx` | mockup sandbox UI | code | مقروء بالكامل
- `EngineeringOS-main/artifacts/mockup-sandbox/src/components/ui/separator.tsx` | `separator.tsx` | `.tsx` | mockup sandbox UI | code | مقروء بالكامل
- `EngineeringOS-main/artifacts/mockup-sandbox/src/components/ui/sheet.tsx` | `sheet.tsx` | `.tsx` | mockup sandbox UI | code | مقروء بالكامل
- `EngineeringOS-main/artifacts/mockup-sandbox/src/components/ui/sidebar.tsx` | `sidebar.tsx` | `.tsx` | mockup sandbox UI | code | مقروء بالكامل
- `EngineeringOS-main/artifacts/mockup-sandbox/src/components/ui/skeleton.tsx` | `skeleton.tsx` | `.tsx` | mockup sandbox UI | code | مقروء بالكامل
- `EngineeringOS-main/artifacts/mockup-sandbox/src/components/ui/slider.tsx` | `slider.tsx` | `.tsx` | mockup sandbox UI | code | مقروء بالكامل
- `EngineeringOS-main/artifacts/mockup-sandbox/src/components/ui/sonner.tsx` | `sonner.tsx` | `.tsx` | mockup sandbox UI | code | مقروء بالكامل
- `EngineeringOS-main/artifacts/mockup-sandbox/src/components/ui/spinner.tsx` | `spinner.tsx` | `.tsx` | mockup sandbox UI | code | مقروء بالكامل
- `EngineeringOS-main/artifacts/mockup-sandbox/src/components/ui/switch.tsx` | `switch.tsx` | `.tsx` | mockup sandbox UI | code | مقروء بالكامل
- `EngineeringOS-main/artifacts/mockup-sandbox/src/components/ui/table.tsx` | `table.tsx` | `.tsx` | mockup sandbox UI | code | مقروء بالكامل
- `EngineeringOS-main/artifacts/mockup-sandbox/src/components/ui/tabs.tsx` | `tabs.tsx` | `.tsx` | mockup sandbox UI | code | مقروء بالكامل
- `EngineeringOS-main/artifacts/mockup-sandbox/src/components/ui/textarea.tsx` | `textarea.tsx` | `.tsx` | mockup sandbox UI | code | مقروء بالكامل
- `EngineeringOS-main/artifacts/mockup-sandbox/src/components/ui/toast.tsx` | `toast.tsx` | `.tsx` | mockup sandbox UI | code | مقروء بالكامل
- `EngineeringOS-main/artifacts/mockup-sandbox/src/components/ui/toaster.tsx` | `toaster.tsx` | `.tsx` | mockup sandbox UI | code | مقروء بالكامل
- `EngineeringOS-main/artifacts/mockup-sandbox/src/components/ui/toggle-group.tsx` | `toggle-group.tsx` | `.tsx` | mockup sandbox UI | code | مقروء بالكامل
- `EngineeringOS-main/artifacts/mockup-sandbox/src/components/ui/toggle.tsx` | `toggle.tsx` | `.tsx` | mockup sandbox UI | code | مقروء بالكامل
- `EngineeringOS-main/artifacts/mockup-sandbox/src/components/ui/tooltip.tsx` | `tooltip.tsx` | `.tsx` | mockup sandbox UI | code | مقروء بالكامل
- `EngineeringOS-main/artifacts/mockup-sandbox/src/hooks/use-mobile.tsx` | `use-mobile.tsx` | `.tsx` | mockup sandbox UI | code | مقروء بالكامل
- `EngineeringOS-main/artifacts/mockup-sandbox/src/hooks/use-toast.ts` | `use-toast.ts` | `.ts` | mockup sandbox UI | code | مقروء بالكامل
- `EngineeringOS-main/artifacts/mockup-sandbox/src/index.css` | `index.css` | `.css` | mockup sandbox UI | text/doc/config | مقروء بالكامل
- `EngineeringOS-main/artifacts/mockup-sandbox/src/lib/utils.ts` | `utils.ts` | `.ts` | mockup sandbox UI | code | مقروء بالكامل
- `EngineeringOS-main/artifacts/mockup-sandbox/src/main.tsx` | `main.tsx` | `.tsx` | mockup sandbox UI | code | مقروء بالكامل
- `EngineeringOS-main/artifacts/mockup-sandbox/tsconfig.json` | `tsconfig.json` | `.json` | workspace configuration / repo governance | config/text | مقروء بالكامل
- `EngineeringOS-main/artifacts/mockup-sandbox/vite.config.ts` | `vite.config.ts` | `.ts` | mockup sandbox artifact | code | مقروء بالكامل

#### `attached_assets` (251)

- `EngineeringOS-main/attached_assets/ENGINEERINGOS_EXECUTION_ALIGNMENT_REPORT_1784147505317.md` | `ENGINEERINGOS_EXECUTION_ALIGNMENT_REPORT_1784147505317.md` | `.md` | historical analysis / export / evidence | text/doc/config | مقروء بالكامل
- `EngineeringOS-main/attached_assets/ENGINEERINGOS_MASTER_EXECUTION_CONSTITUTION(2)_(2)_1784143389784.md` | `ENGINEERINGOS_MASTER_EXECUTION_CONSTITUTION(2)_(2)_1784143389784.md` | `.md` | historical analysis / export / evidence | text/doc/config | مقروء بالكامل
- `EngineeringOS-main/attached_assets/ENGINEERINGOS_PLACEHOLDER_REGISTER_1784147505353.md` | `ENGINEERINGOS_PLACEHOLDER_REGISTER_1784147505353.md` | `.md` | historical analysis / export / evidence | text/doc/config | مقروء بالكامل
- `EngineeringOS-main/attached_assets/ENGINEERINGOS_RUNTIME_EXECUTION_MATRIX_1784147505400.md` | `ENGINEERINGOS_RUNTIME_EXECUTION_MATRIX_1784147505400.md` | `.md` | historical analysis / export / evidence | text/doc/config | مقروء بالكامل
- `EngineeringOS-main/attached_assets/EngineeringOS_Audit_Report_1783641389270.md` | `EngineeringOS_Audit_Report_1783641389270.md` | `.md` | historical analysis / export / evidence | text/doc/config | مقروء بالكامل
- `EngineeringOS-main/attached_assets/EngineeringOS_Audit_Report_Expanded_1783642792349.md` | `EngineeringOS_Audit_Report_Expanded_1783642792349.md` | `.md` | historical analysis / export / evidence | text/doc/config | مقروء بالكامل
- `EngineeringOS-main/attached_assets/EngineeringOS_Combined_Deep_Analysis_(1)_1783706911895.md` | `EngineeringOS_Combined_Deep_Analysis_(1)_1783706911895.md` | `.md` | historical analysis / export / evidence | text/doc/config | مقروء بالكامل
- `EngineeringOS-main/attached_assets/EngineeringOS_Engineering_Truth_Verification_1784082430324.csv` | `EngineeringOS_Engineering_Truth_Verification_1784082430324.csv` | `.csv` | historical analysis / export / evidence | text/doc/config | مقروء بالكامل
- `EngineeringOS-main/attached_assets/EngineeringOS_Engineering_Truth_Verification_1784082430371.md` | `EngineeringOS_Engineering_Truth_Verification_1784082430371.md` | `.md` | historical analysis / export / evidence | text/doc/config | مقروء بالكامل
- `EngineeringOS-main/attached_assets/EngineeringOS_Execution_Plan_1783831261195.pdf` | `EngineeringOS_Execution_Plan_1783831261195.pdf` | `.pdf` | historical evidence or archive | binary artifact | بيانات/فهرسة فقط
- `EngineeringOS-main/attached_assets/EngineeringOS_Executive_Build_Directive_v1_1783912619169.md` | `EngineeringOS_Executive_Build_Directive_v1_1783912619169.md` | `.md` | historical analysis / export / evidence | text/doc/config | مقروء بالكامل
- `EngineeringOS-main/attached_assets/EngineeringOS_File_Inventory_Complete(1)_1783706911845.md` | `EngineeringOS_File_Inventory_Complete(1)_1783706911845.md` | `.md` | historical analysis / export / evidence | text/doc/config | مقروء بالكامل
- `EngineeringOS-main/attached_assets/EngineeringOS_File_by_File_Fact_Record_1783725698283.md` | `EngineeringOS_File_by_File_Fact_Record_1783725698283.md` | `.md` | historical analysis / export / evidence | text/doc/config | مقروء بالكامل
- `EngineeringOS-main/attached_assets/EngineeringOS_Implementation_Document_1783726156016.md` | `EngineeringOS_Implementation_Document_1783726156016.md` | `.md` | historical analysis / export / evidence | text/doc/config | مقروء بالكامل
- `EngineeringOS-main/attached_assets/EngineeringOS_Master_Truth_Register_(1)_1784077194501.xlsx` | `EngineeringOS_Master_Truth_Register_(1)_1784077194501.xlsx` | `.xlsx` | historical evidence or archive | binary artifact | بيانات/فهرسة فقط
- `EngineeringOS-main/attached_assets/EngineeringOS_Plan_1783818095882.pdf` | `EngineeringOS_Plan_1783818095882.pdf` | `.pdf` | historical evidence or archive | binary artifact | بيانات/فهرسة فقط
- `EngineeringOS-main/attached_assets/EngineeringOS_Project_1783718452179.pdf` | `EngineeringOS_Project_1783718452179.pdf` | `.pdf` | historical evidence or archive | binary artifact | بيانات/فهرسة فقط
- `EngineeringOS-main/attached_assets/EngineeringOS_Project_Analysis_Report_(3)_1784675241263.md` | `EngineeringOS_Project_Analysis_Report_(3)_1784675241263.md` | `.md` | historical analysis / export / evidence | text/doc/config | مقروء بالكامل
- `EngineeringOS-main/attached_assets/EngineeringOS_Truth_Flow_Matrix.schema_1784143389669.ts` | `EngineeringOS_Truth_Flow_Matrix.schema_1784143389669.ts` | `.ts` | historical attachment | code | مقروء بالكامل
- `EngineeringOS-main/attached_assets/EngineeringOS_Truth_Flow_Matrix_1784143389833.json` | `EngineeringOS_Truth_Flow_Matrix_1784143389833.json` | `.json` | historical analysis / export / evidence | text/doc/config | مقروء بالكامل
- `EngineeringOS-main/attached_assets/EngineeringOS_Truth_Flow_Matrix_1784143389882.ts` | `EngineeringOS_Truth_Flow_Matrix_1784143389882.ts` | `.ts` | historical attachment | code | مقروء بالكامل
- `EngineeringOS-main/attached_assets/EngineeringOS_Truth_Flow_PR_Checklist_1784143389929.md` | `EngineeringOS_Truth_Flow_PR_Checklist_1784143389929.md` | `.md` | historical analysis / export / evidence | text/doc/config | مقروء بالكامل
- `EngineeringOS-main/attached_assets/EngineeringOS_Truth_Register_Full_(1)_1784081699025.csv` | `EngineeringOS_Truth_Register_Full_(1)_1784081699025.csv` | `.csv` | historical analysis / export / evidence | text/doc/config | مقروء بالكامل
- `EngineeringOS-main/attached_assets/EngineeringOS_Truth_Register_Full_1784081611461.csv` | `EngineeringOS_Truth_Register_Full_1784081611461.csv` | `.csv` | historical analysis / export / evidence | text/doc/config | مقروء بالكامل
- `EngineeringOS-main/attached_assets/EngineeringOS_Truth_Register_and_PR_Roadmap_(1)_1784081698974.md` | `EngineeringOS_Truth_Register_and_PR_Roadmap_(1)_1784081698974.md` | `.md` | historical analysis / export / evidence | text/doc/config | مقروء بالكامل
- `EngineeringOS-main/attached_assets/EngineeringOS_Truth_Register_and_PR_Roadmap_1784081611536.md` | `EngineeringOS_Truth_Register_and_PR_Roadmap_1784081611536.md` | `.md` | historical analysis / export / evidence | text/doc/config | مقروء بالكامل
- `EngineeringOS-main/attached_assets/EngineeringOS_analysis_report(2)_(1)_1784047036210.md` | `EngineeringOS_analysis_report(2)_(1)_1784047036210.md` | `.md` | historical analysis / export / evidence | text/doc/config | مقروء بالكامل
- `EngineeringOS-main/attached_assets/EngineeringOS_analysis_summary_1784485047967.json` | `EngineeringOS_analysis_summary_1784485047967.json` | `.json` | historical analysis / export / evidence | text/doc/config | مقروء بالكامل
- `EngineeringOS-main/attached_assets/EngineeringOS_analysis_summary_1784487574320.json` | `EngineeringOS_analysis_summary_1784487574320.json` | `.json` | historical analysis / export / evidence | text/doc/config | مقروء بالكامل
- `EngineeringOS-main/attached_assets/EngineeringOS_analysis_summary_1784488259980.json` | `EngineeringOS_analysis_summary_1784488259980.json` | `.json` | historical analysis / export / evidence | text/doc/config | مقروء بالكامل
- `EngineeringOS-main/attached_assets/EngineeringOS_analysis_summary_1784489456836.json` | `EngineeringOS_analysis_summary_1784489456836.json` | `.json` | historical analysis / export / evidence | text/doc/config | مقروء بالكامل
- `EngineeringOS-main/attached_assets/EngineeringOS_api_zod_index_export_diff_1784143389744.txt` | `EngineeringOS_api_zod_index_export_diff_1784143389744.txt` | `.txt` | historical analysis / export / evidence | text/doc/config | مقروء بالكامل
- `EngineeringOS-main/attached_assets/EngineeringOS_architecture_analysis_report_1784040976647.md` | `EngineeringOS_architecture_analysis_report_1784040976647.md` | `.md` | historical analysis / export / evidence | text/doc/config | مقروء بالكامل
- `EngineeringOS-main/attached_assets/EngineeringOS_archive_entries_1784040976692.csv` | `EngineeringOS_archive_entries_1784040976692.csv` | `.csv` | historical analysis / export / evidence | text/doc/config | مقروء بالكامل
- `EngineeringOS-main/attached_assets/EngineeringOS_archive_entries_1784041152876.csv` | `EngineeringOS_archive_entries_1784041152876.csv` | `.csv` | historical analysis / export / evidence | text/doc/config | مقروء بالكامل
- `EngineeringOS-main/attached_assets/EngineeringOS_code_deep_analysis_1784052671648.md` | `EngineeringOS_code_deep_analysis_1784052671648.md` | `.md` | historical analysis / export / evidence | text/doc/config | مقروء بالكامل
- `EngineeringOS-main/attached_assets/EngineeringOS_code_deep_analysis_1784052762652.md` | `EngineeringOS_code_deep_analysis_1784052762652.md` | `.md` | historical analysis / export / evidence | text/doc/config | مقروء بالكامل
- `EngineeringOS-main/attached_assets/EngineeringOS_current_analysis_report_1784052671601.md` | `EngineeringOS_current_analysis_report_1784052671601.md` | `.md` | historical analysis / export / evidence | text/doc/config | مقروء بالكامل
- `EngineeringOS-main/attached_assets/EngineeringOS_current_analysis_report_1784052762572.md` | `EngineeringOS_current_analysis_report_1784052762572.md` | `.md` | historical analysis / export / evidence | text/doc/config | مقروء بالكامل
- `EngineeringOS-main/attached_assets/EngineeringOS_deep_analysis_report_1783800987828.md` | `EngineeringOS_deep_analysis_report_1783800987828.md` | `.md` | historical analysis / export / evidence | text/doc/config | مقروء بالكامل
- `EngineeringOS-main/attached_assets/EngineeringOS_deep_dive_analysis_v2_1784152351310.md` | `EngineeringOS_deep_dive_analysis_v2_1784152351310.md` | `.md` | historical analysis / export / evidence | text/doc/config | مقروء بالكامل
- `EngineeringOS-main/attached_assets/EngineeringOS_deepest_analysis_report(1)_(2)_1784154247108.md` | `EngineeringOS_deepest_analysis_report(1)_(2)_1784154247108.md` | `.md` | historical analysis / export / evidence | text/doc/config | مقروء بالكامل
- `EngineeringOS-main/attached_assets/EngineeringOS_deepest_analysis_report_(1)_1784081611576.md` | `EngineeringOS_deepest_analysis_report_(1)_1784081611576.md` | `.md` | historical analysis / export / evidence | text/doc/config | مقروء بالكامل
- `EngineeringOS-main/attached_assets/EngineeringOS_deepest_analysis_report_(1)_1784081699061.md` | `EngineeringOS_deepest_analysis_report_(1)_1784081699061.md` | `.md` | historical analysis / export / evidence | text/doc/config | مقروء بالكامل
- `EngineeringOS-main/attached_assets/EngineeringOS_file_inventory_(1)_1783729892809.csv` | `EngineeringOS_file_inventory_(1)_1783729892809.csv` | `.csv` | historical analysis / export / evidence | text/doc/config | مقروء بالكامل
- `EngineeringOS-main/attached_assets/EngineeringOS_file_inventory_current_1784052671527.csv` | `EngineeringOS_file_inventory_current_1784052671527.csv` | `.csv` | historical analysis / export / evidence | text/doc/config | مقروء بالكامل
- `EngineeringOS-main/attached_assets/EngineeringOS_file_inventory_current_1784052762450.csv` | `EngineeringOS_file_inventory_current_1784052762450.csv` | `.csv` | historical analysis / export / evidence | text/doc/config | مقروء بالكامل
- `EngineeringOS-main/attached_assets/EngineeringOS_file_inventory_full(2)_1783988496247.csv` | `EngineeringOS_file_inventory_full(2)_1783988496247.csv` | `.csv` | historical analysis / export / evidence | text/doc/config | مقروء بالكامل
- `EngineeringOS-main/attached_assets/EngineeringOS_file_inventory_full_1783800987783.csv` | `EngineeringOS_file_inventory_full_1783800987783.csv` | `.csv` | historical analysis / export / evidence | text/doc/config | مقروء بالكامل
- `EngineeringOS-main/attached_assets/EngineeringOS_file_inventory_v2_1784427571850.csv` | `EngineeringOS_file_inventory_v2_1784427571850.csv` | `.csv` | historical analysis / export / evidence | text/doc/config | مقروء بالكامل
- `EngineeringOS-main/attached_assets/EngineeringOS_file_inventory_v2_1784427972718.csv` | `EngineeringOS_file_inventory_v2_1784427972718.csv` | `.csv` | historical analysis / export / evidence | text/doc/config | مقروء بالكامل
- `EngineeringOS-main/attached_assets/EngineeringOS_forensic_audit_report(1)_(1)_1784509785486.md` | `EngineeringOS_forensic_audit_report(1)_(1)_1784509785486.md` | `.md` | historical analysis / export / evidence | text/doc/config | مقروء بالكامل
- `EngineeringOS-main/attached_assets/EngineeringOS_forensic_audit_report_(1)_1784570354611.md` | `EngineeringOS_forensic_audit_report_(1)_1784570354611.md` | `.md` | historical analysis / export / evidence | text/doc/config | مقروء بالكامل
- `EngineeringOS-main/attached_assets/EngineeringOS_forensic_engineering_report_v2_1784427571793.md` | `EngineeringOS_forensic_engineering_report_v2_1784427571793.md` | `.md` | historical analysis / export / evidence | text/doc/config | مقروء بالكامل
- `EngineeringOS-main/attached_assets/EngineeringOS_forensic_engineering_report_v2_1784427972668.md` | `EngineeringOS_forensic_engineering_report_v2_1784427972668.md` | `.md` | historical analysis / export / evidence | text/doc/config | مقروء بالكامل
- `EngineeringOS-main/attached_assets/EngineeringOS_forensic_report(1)_1784492362639.md` | `EngineeringOS_forensic_report(1)_1784492362639.md` | `.md` | historical analysis / export / evidence | text/doc/config | مقروء بالكامل
- `EngineeringOS-main/attached_assets/EngineeringOS_forensic_report(1)_1784492400992.md` | `EngineeringOS_forensic_report(1)_1784492400992.md` | `.md` | historical analysis / export / evidence | text/doc/config | مقروء بالكامل
- `EngineeringOS-main/attached_assets/EngineeringOS_forensic_report_full(1)_1784485047923.md` | `EngineeringOS_forensic_report_full(1)_1784485047923.md` | `.md` | historical analysis / export / evidence | text/doc/config | مقروء بالكامل
- `EngineeringOS-main/attached_assets/EngineeringOS_forensic_report_full(1)_1784487574279.md` | `EngineeringOS_forensic_report_full(1)_1784487574279.md` | `.md` | historical analysis / export / evidence | text/doc/config | مقروء بالكامل
- `EngineeringOS-main/attached_assets/EngineeringOS_forensic_report_full(1)_1784488259926.md` | `EngineeringOS_forensic_report_full(1)_1784488259926.md` | `.md` | historical analysis / export / evidence | text/doc/config | مقروء بالكامل
- `EngineeringOS-main/attached_assets/EngineeringOS_forensic_report_full(1)_1784489456770.md` | `EngineeringOS_forensic_report_full(1)_1784489456770.md` | `.md` | historical analysis / export / evidence | text/doc/config | مقروء بالكامل
- `EngineeringOS-main/attached_assets/EngineeringOS_full_analysis_report_1783988496190.md` | `EngineeringOS_full_analysis_report_1783988496190.md` | `.md` | historical analysis / export / evidence | text/doc/config | مقروء بالكامل
- `EngineeringOS-main/attached_assets/EngineeringOS_full_file_inventory(1)_1784040976594.csv` | `EngineeringOS_full_file_inventory(1)_1784040976594.csv` | `.csv` | historical analysis / export / evidence | text/doc/config | مقروء بالكامل
- `EngineeringOS-main/attached_assets/EngineeringOS_full_file_inventory(1)_1784041152926.csv` | `EngineeringOS_full_file_inventory(1)_1784041152926.csv` | `.csv` | historical analysis / export / evidence | text/doc/config | مقروء بالكامل
- `EngineeringOS-main/attached_assets/EngineeringOS_full_file_inventory_1784492401113.csv` | `EngineeringOS_full_file_inventory_1784492401113.csv` | `.csv` | historical analysis / export / evidence | text/doc/config | مقروء بالكامل
- `EngineeringOS-main/attached_assets/EngineeringOS_full_inventory(1)_1784485047848.csv` | `EngineeringOS_full_inventory(1)_1784485047848.csv` | `.csv` | historical analysis / export / evidence | text/doc/config | مقروء بالكامل
- `EngineeringOS-main/attached_assets/EngineeringOS_full_inventory(1)_1784487574226.csv` | `EngineeringOS_full_inventory(1)_1784487574226.csv` | `.csv` | historical analysis / export / evidence | text/doc/config | مقروء بالكامل
- `EngineeringOS-main/attached_assets/EngineeringOS_full_inventory(1)_1784488259874.csv` | `EngineeringOS_full_inventory(1)_1784488259874.csv` | `.csv` | historical analysis / export / evidence | text/doc/config | مقروء بالكامل
- `EngineeringOS-main/attached_assets/EngineeringOS_full_inventory(1)_1784489456653.csv` | `EngineeringOS_full_inventory(1)_1784489456653.csv` | `.csv` | historical analysis / export / evidence | text/doc/config | مقروء بالكامل
- `EngineeringOS-main/attached_assets/EngineeringOS_inventory_(1)_1784570354569.csv` | `EngineeringOS_inventory_(1)_1784570354569.csv` | `.csv` | historical analysis / export / evidence | text/doc/config | مقروء بالكامل
- `EngineeringOS-main/attached_assets/EngineeringOS_master_inventory(1)_(1)_1784509785451.csv` | `EngineeringOS_master_inventory(1)_(1)_1784509785451.csv` | `.csv` | historical analysis / export / evidence | text/doc/config | مقروء بالكامل
- `EngineeringOS-main/attached_assets/EngineeringOS_minimum_path_to_vision_(1)_1783830867380.md` | `EngineeringOS_minimum_path_to_vision_(1)_1783830867380.md` | `.md` | historical analysis / export / evidence | text/doc/config | مقروء بالكامل
- `EngineeringOS-main/attached_assets/EngineeringOS_minimum_path_to_vision_1783830816710.md` | `EngineeringOS_minimum_path_to_vision_1783830816710.md` | `.md` | historical analysis / export / evidence | text/doc/config | مقروء بالكامل
- `EngineeringOS-main/attached_assets/EngineeringOS_operational_status_record_1783912104506.md` | `EngineeringOS_operational_status_record_1783912104506.md` | `.md` | historical analysis / export / evidence | text/doc/config | مقروء بالكامل
- `EngineeringOS-main/attached_assets/EngineeringOS_project_analysis_report(1)_1783729892769.md` | `EngineeringOS_project_analysis_report(1)_1783729892769.md` | `.md` | historical analysis / export / evidence | text/doc/config | مقروء بالكامل
- `EngineeringOS-main/attached_assets/EngineeringOS_provenance_registry_linked_1783911530593.json` | `EngineeringOS_provenance_registry_linked_1783911530593.json` | `.json` | historical analysis / export / evidence | text/doc/config | مقروء بالكامل
- `EngineeringOS-main/attached_assets/EngineeringOS_provenance_registry_seed_1783911530658.json` | `EngineeringOS_provenance_registry_seed_1783911530658.json` | `.json` | historical analysis / export / evidence | text/doc/config | مقروء بالكامل
- `EngineeringOS-main/attached_assets/EngineeringOS_replit_execution_directive_1783800987701.json` | `EngineeringOS_replit_execution_directive_1783800987701.json` | `.json` | historical analysis / export / evidence | text/doc/config | مقروء بالكامل
- `EngineeringOS-main/attached_assets/EngineeringOS_replit_execution_directive_1783800987743.md` | `EngineeringOS_replit_execution_directive_1783800987743.md` | `.md` | historical analysis / export / evidence | text/doc/config | مقروء بالكامل
- `EngineeringOS-main/attached_assets/EngineeringOS_runtime_trace_matrix_1784492401053.csv` | `EngineeringOS_runtime_trace_matrix_1784492401053.csv` | `.csv` | historical analysis / export / evidence | text/doc/config | مقروء بالكامل
- `EngineeringOS-main/attached_assets/EngineeringOS_series14_truth_matrix_1783966531635.md` | `EngineeringOS_series14_truth_matrix_1783966531635.md` | `.md` | historical analysis / export / evidence | text/doc/config | مقروء بالكامل
- `EngineeringOS-main/attached_assets/EngineeringOS_series15_deep_evidence_1783966531578.md` | `EngineeringOS_series15_deep_evidence_1783966531578.md` | `.md` | historical analysis / export / evidence | text/doc/config | مقروء بالكامل
- `EngineeringOS-main/attached_assets/EngineeringOS_series16_truth_matrix_(1)_1783966531512.md` | `EngineeringOS_series16_truth_matrix_(1)_1783966531512.md` | `.md` | historical analysis / export / evidence | text/doc/config | مقروء بالكامل
- `EngineeringOS-main/attached_assets/EngineeringOS_series17_deep_analysis_1783966531444.md` | `EngineeringOS_series17_deep_analysis_1783966531444.md` | `.md` | historical analysis / export / evidence | text/doc/config | مقروء بالكامل
- `EngineeringOS-main/attached_assets/EngineeringOS_series18_status_register_(1)_1783966531375.md` | `EngineeringOS_series18_status_register_(1)_1783966531375.md` | `.md` | historical analysis / export / evidence | text/doc/config | مقروء بالكامل
- `EngineeringOS-main/attached_assets/EngineeringOS_series19_control_plane_evidence_1783966531303.md` | `EngineeringOS_series19_control_plane_evidence_1783966531303.md` | `.md` | historical analysis / export / evidence | text/doc/config | مقروء بالكامل
- `EngineeringOS-main/attached_assets/EngineeringOS_series20_status_register_1783966531239.md` | `EngineeringOS_series20_status_register_1783966531239.md` | `.md` | historical analysis / export / evidence | text/doc/config | مقروء بالكامل
- `EngineeringOS-main/attached_assets/EngineeringOS_series21_deep_status_1783966531177.md` | `EngineeringOS_series21_deep_status_1783966531177.md` | `.md` | historical analysis / export / evidence | text/doc/config | مقروء بالكامل
- `EngineeringOS-main/attached_assets/EngineeringOS_series22_second_wave_analysis_1783966531113.md` | `EngineeringOS_series22_second_wave_analysis_1783966531113.md` | `.md` | historical analysis / export / evidence | text/doc/config | مقروء بالكامل
- `EngineeringOS-main/attached_assets/EngineeringOS_series23_self_verifying_architecture_1783966531049.md` | `EngineeringOS_series23_self_verifying_architecture_1783966531049.md` | `.md` | historical analysis / export / evidence | text/doc/config | مقروء بالكامل
- `EngineeringOS-main/attached_assets/EngineeringOS_series24_deep_evidence_1783966530990.md` | `EngineeringOS_series24_deep_evidence_1783966530990.md` | `.md` | historical analysis / export / evidence | text/doc/config | مقروء بالكامل
- `EngineeringOS-main/attached_assets/EngineeringOS_series25_truth_register_1783966530939.md` | `EngineeringOS_series25_truth_register_1783966530939.md` | `.md` | historical analysis / export / evidence | text/doc/config | مقروء بالكامل
- `EngineeringOS-main/attached_assets/EngineeringOS_series26_boundary_analysis_1783966530884.md` | `EngineeringOS_series26_boundary_analysis_1783966530884.md` | `.md` | historical analysis / export / evidence | text/doc/config | مقروء بالكامل
- `EngineeringOS-main/attached_assets/EngineeringOS_series27_failure_semantics_1783966530824.md` | `EngineeringOS_series27_failure_semantics_1783966530824.md` | `.md` | historical analysis / export / evidence | text/doc/config | مقروء بالكامل
- `EngineeringOS-main/attached_assets/EngineeringOS_series28_traceability_mesh_1783966530766.md` | `EngineeringOS_series28_traceability_mesh_1783966530766.md` | `.md` | historical analysis / export / evidence | text/doc/config | مقروء بالكامل
- `EngineeringOS-main/attached_assets/EngineeringOS_series29_trust_boundary_register_1783966530702.md` | `EngineeringOS_series29_trust_boundary_register_1783966530702.md` | `.md` | historical analysis / export / evidence | text/doc/config | مقروء بالكامل
- `EngineeringOS-main/attached_assets/EngineeringOS_series30_release_handoff_audit_1783966530642.md` | `EngineeringOS_series30_release_handoff_audit_1783966530642.md` | `.md` | historical analysis / export / evidence | text/doc/config | مقروء بالكامل
- `EngineeringOS-main/attached_assets/EngineeringOS_series31_release_handoff_audit_1783966530586.md` | `EngineeringOS_series31_release_handoff_audit_1783966530586.md` | `.md` | historical analysis / export / evidence | text/doc/config | مقروء بالكامل
- `EngineeringOS-main/attached_assets/EngineeringOS_series32_phase_conformance_audit_1783966530537.md` | `EngineeringOS_series32_phase_conformance_audit_1783966530537.md` | `.md` | historical analysis / export / evidence | text/doc/config | مقروء بالكامل
- `EngineeringOS-main/attached_assets/EngineeringOS_series33_provenance_authority_graph_1783966530470.md` | `EngineeringOS_series33_provenance_authority_graph_1783966530470.md` | `.md` | historical analysis / export / evidence | text/doc/config | مقروء بالكامل
- `EngineeringOS-main/attached_assets/EngineeringOS_status_record_(1)_1783980758791.md` | `EngineeringOS_status_record_(1)_1783980758791.md` | `.md` | historical analysis / export / evidence | text/doc/config | مقروء بالكامل
- `EngineeringOS-main/attached_assets/EngineeringOS_status_register_(1)_1783818095824.md` | `EngineeringOS_status_register_(1)_1783818095824.md` | `.md` | historical analysis / export / evidence | text/doc/config | مقروء بالكامل
- `EngineeringOS-main/attached_assets/EngineeringOS_status_register_final_1783902107873.md` | `EngineeringOS_status_register_final_1783902107873.md` | `.md` | historical analysis / export / evidence | text/doc/config | مقروء بالكامل
- `EngineeringOS-main/attached_assets/EngineeringOS_task_backlog_1783800987875.json` | `EngineeringOS_task_backlog_1783800987875.json` | `.json` | historical analysis / export / evidence | text/doc/config | مقروء بالكامل
- `EngineeringOS-main/attached_assets/EngineeringOS_truth_checklist_1784322972343.md` | `EngineeringOS_truth_checklist_1784322972343.md` | `.md` | historical analysis / export / evidence | text/doc/config | مقروء بالكامل
- `EngineeringOS-main/attached_assets/EngineeringOS_truth_checklist_1784326108247.md` | `EngineeringOS_truth_checklist_1784326108247.md` | `.md` | historical analysis / export / evidence | text/doc/config | مقروء بالكامل
- `EngineeringOS-main/attached_assets/EngineeringOS_truth_register_current_1783825680736.md` | `EngineeringOS_truth_register_current_1783825680736.md` | `.md` | historical analysis / export / evidence | text/doc/config | مقروء بالكامل
- `EngineeringOS-main/attached_assets/Engineering_Os_Fact_Record_1783718570175.pdf` | `Engineering_Os_Fact_Record_1783718570175.pdf` | `.pdf` | historical evidence or archive | binary artifact | بيانات/فهرسة فقط
- `EngineeringOS-main/attached_assets/Engineering_Os_Phased_Completion_Plan_(1)_1783718452123.pdf` | `Engineering_Os_Phased_Completion_Plan_(1)_1783718452123.pdf` | `.pdf` | historical evidence or archive | binary artifact | بيانات/فهرسة فقط
- `EngineeringOS-main/attached_assets/Engineering_Os_Phased_Completion_Plan_1783718452216.pdf` | `Engineering_Os_Phased_Completion_Plan_1783718452216.pdf` | `.pdf` | historical evidence or archive | binary artifact | بيانات/فهرسة فقط
- `EngineeringOS-main/attached_assets/PR_BACKLOG_1784470184510.md` | `PR_BACKLOG_1784470184510.md` | `.md` | historical analysis / export / evidence | text/doc/config | مقروء بالكامل
- `EngineeringOS-main/attached_assets/PR_BACKLOG_1784476473246.md` | `PR_BACKLOG_1784476473246.md` | `.md` | historical analysis / export / evidence | text/doc/config | مقروء بالكامل
- `EngineeringOS-main/attached_assets/Pasted---1783906604381_1783906604385.txt` | `Pasted---1783906604381_1783906604385.txt` | `.txt` | historical analysis / export / evidence | text/doc/config | مقروء بالكامل
- `EngineeringOS-main/attached_assets/Pasted---1783956390496_1783956390501.txt` | `Pasted---1783956390496_1783956390501.txt` | `.txt` | historical analysis / export / evidence | text/doc/config | مقروء بالكامل
- `EngineeringOS-main/attached_assets/Pasted---1784163447147_1784163447161.txt` | `Pasted---1784163447147_1784163447161.txt` | `.txt` | historical analysis / export / evidence | text/doc/config | مقروء بالكامل
- `EngineeringOS-main/attached_assets/Pasted---1784163799356_1784163799366.txt` | `Pasted---1784163799356_1784163799366.txt` | `.txt` | historical analysis / export / evidence | text/doc/config | مقروء بالكامل
- `EngineeringOS-main/attached_assets/Pasted---1784230995192_1784230995203.txt` | `Pasted---1784230995192_1784230995203.txt` | `.txt` | historical analysis / export / evidence | text/doc/config | مقروء بالكامل
- `EngineeringOS-main/attached_assets/Pasted---1784231528183_1784231528198.txt` | `Pasted---1784231528183_1784231528198.txt` | `.txt` | historical analysis / export / evidence | text/doc/config | مقروء بالكامل
- `EngineeringOS-main/attached_assets/Pasted---1784232069146_1784232069153.txt` | `Pasted---1784232069146_1784232069153.txt` | `.txt` | historical analysis / export / evidence | text/doc/config | مقروء بالكامل
- `EngineeringOS-main/attached_assets/Pasted---1784348446604_1784348446608.txt` | `Pasted---1784348446604_1784348446608.txt` | `.txt` | historical analysis / export / evidence | text/doc/config | مقروء بالكامل
- `EngineeringOS-main/attached_assets/Pasted---1784389595241_1784389595255.txt` | `Pasted---1784389595241_1784389595255.txt` | `.txt` | historical analysis / export / evidence | text/doc/config | مقروء بالكامل
- `EngineeringOS-main/attached_assets/Pasted---1784688081989_1784688081999.txt` | `Pasted---1784688081989_1784688081999.txt` | `.txt` | historical analysis / export / evidence | text/doc/config | مقروء بالكامل
- `EngineeringOS-main/attached_assets/Pasted--1--1784078393552_1784078393558.txt` | `Pasted--1--1784078393552_1784078393558.txt` | `.txt` | historical analysis / export / evidence | text/doc/config | مقروء بالكامل
- `EngineeringOS-main/attached_assets/Pasted--1-AI--1784682577942_1784682577946.txt` | `Pasted--1-AI--1784682577942_1784682577946.txt` | `.txt` | historical analysis / export / evidence | text/doc/config | مقروء بالكامل
- `EngineeringOS-main/attached_assets/Pasted--1-Executive-Summary-I-scanned-the-whole-extracted-tree_1784520091488.txt` | `Pasted--1-Executive-Summary-I-scanned-the-whole-extracted-tree_1784520091488.txt` | `.txt` | historical analysis / export / evidence | text/doc/config | مقروء بالكامل
- `EngineeringOS-main/attached_assets/Pasted--1-Executive-Summary-I-scanned-the-whole-extracted-tree_1784520380555.txt` | `Pasted--1-Executive-Summary-I-scanned-the-whole-extracted-tree_1784520380555.txt` | `.txt` | historical analysis / export / evidence | text/doc/config | مقروء بالكامل
- `EngineeringOS-main/attached_assets/Pasted--1-Executive-Summary-I-scanned-the-whole-extracted-tree_1784565784400.txt` | `Pasted--1-Executive-Summary-I-scanned-the-whole-extracted-tree_1784565784400.txt` | `.txt` | historical analysis / export / evidence | text/doc/config | مقروء بالكامل
- `EngineeringOS-main/attached_assets/Pasted--1-Executive-Summary-ID-Path-Scope--1784588898200_1784588898209.txt` | `Pasted--1-Executive-Summary-ID-Path-Scope--1784588898200_1784588898209.txt` | `.txt` | historical analysis / export / evidence | text/doc/config | مقروء بالكامل
- `EngineeringOS-main/attached_assets/Pasted--1-Executive-Summary-ID-Path-Scope--1784588976178_1784588976181.txt` | `Pasted--1-Executive-Summary-ID-Path-Scope--1784588976178_1784588976181.txt` | `.txt` | historical analysis / export / evidence | text/doc/config | مقروء بالكامل
- `EngineeringOS-main/attached_assets/Pasted--1-Set-up-the-imported-project-What-Why-The-user-just-i_1784600640416.txt` | `Pasted--1-Set-up-the-imported-project-What-Why-The-user-just-i_1784600640416.txt` | `.txt` | historical analysis / export / evidence | text/doc/config | مقروء بالكامل
- `EngineeringOS-main/attached_assets/Pasted--8-minutes-ago-Replacing-in-process-upload-store-The-us_1784600039567.txt` | `Pasted--8-minutes-ago-Replacing-in-process-upload-store-The-us_1784600039567.txt` | `.txt` | historical analysis / export / evidence | text/doc/config | مقروء بالكامل
- `EngineeringOS-main/attached_assets/Pasted--Backlog-Execution-Backlog-v1-0--1783975284276_1783975284279.txt` | `Pasted--Backlog-Execution-Backlog-v1-0--1783975284276_1783975284279.txt` | `.txt` | historical analysis / export / evidence | text/doc/config | مقروء بالكامل
- `EngineeringOS-main/attached_assets/Pasted--Code-Review-Plan-Groq-Scope-Save-API--1784175594438_1784175594440.txt` | `Pasted--Code-Review-Plan-Groq-Scope-Save-API--1784175594438_1784175594440.txt` | `.txt` | historical analysis / export / evidence | text/doc/config | مقروء بالكامل
- `EngineeringOS-main/attached_assets/Pasted--Discovery-Layer--1783988471815_1783988471818.txt` | `Pasted--Discovery-Layer--1783988471815_1783988471818.txt` | `.txt` | historical analysis / export / evidence | text/doc/config | مقروء بالكامل
- `EngineeringOS-main/attached_assets/Pasted--EngineeringOS--1784145653787_1784145653789.txt` | `Pasted--EngineeringOS--1784145653787_1784145653789.txt` | `.txt` | historical analysis / export / evidence | text/doc/config | مقروء بالكامل
- `EngineeringOS-main/attached_assets/Pasted--EngineeringOS-Autonomous-Project-Discovery-Onboarding-_1783565505918.txt` | `Pasted--EngineeringOS-Autonomous-Project-Discovery-Onboarding-_1783565505918.txt` | `.txt` | historical analysis / export / evidence | text/doc/config | مقروء بالكامل
- `EngineeringOS-main/attached_assets/Pasted--EngineeringOS-Autonomous-Project-Discovery-Onboarding-_1783566150077.txt` | `Pasted--EngineeringOS-Autonomous-Project-Discovery-Onboarding-_1783566150077.txt` | `.txt` | historical analysis / export / evidence | text/doc/config | مقروء بالكامل
- `EngineeringOS-main/attached_assets/Pasted--EngineeringOS-PR-Backlog-File-by-File-backlog--1784168_1784168977036.txt` | `Pasted--EngineeringOS-PR-Backlog-File-by-File-backlog--1784168_1784168977036.txt` | `.txt` | historical analysis / export / evidence | text/doc/config | مقروء بالكامل
- `EngineeringOS-main/attached_assets/Pasted--EngineeringOS-PR-Backlog-File-by-File-backlog--1784169_1784169315352.txt` | `Pasted--EngineeringOS-PR-Backlog-File-by-File-backlog--1784169_1784169315352.txt` | `.txt` | historical analysis / export / evidence | text/doc/config | مقروء بالكامل
- `EngineeringOS-main/attached_assets/Pasted--EngineeringOS-PR-by-PR-Execution-Pack-for-Replit-AI-PR_1784154335102.txt` | `Pasted--EngineeringOS-PR-by-PR-Execution-Pack-for-Replit-AI-PR_1784154335102.txt` | `.txt` | historical analysis / export / evidence | text/doc/config | مقروء بالكامل
- `EngineeringOS-main/attached_assets/Pasted--EngineeringOS-PR-by-PR-Execution-Pack-for-Replit-AI-PR_1784155079326.txt` | `Pasted--EngineeringOS-PR-by-PR-Execution-Pack-for-Replit-AI-PR_1784155079326.txt` | `.txt` | historical analysis / export / evidence | text/doc/config | مقروء بالكامل
- `EngineeringOS-main/attached_assets/Pasted--Forensic-Software-Engineering-Audit-1-Executive-Summar_1784515285022.txt` | `Pasted--Forensic-Software-Engineering-Audit-1-Executive-Summar_1784515285022.txt` | `.txt` | historical analysis / export / evidence | text/doc/config | مقروء بالكامل
- `EngineeringOS-main/attached_assets/Pasted--Forensic-Software-Engineering-Audit-1-Executive-Summar_1784515636472.txt` | `Pasted--Forensic-Software-Engineering-Audit-1-Executive-Summar_1784515636472.txt` | `.txt` | historical analysis / export / evidence | text/doc/config | مقروء بالكامل
- `EngineeringOS-main/attached_assets/Pasted--GROQ-API-KEY-JavaScript-Groq--1784088277237_1784088277243.txt` | `Pasted--GROQ-API-KEY-JavaScript-Groq--1784088277237_1784088277243.txt` | `.txt` | historical analysis / export / evidence | text/doc/config | مقروء بالكامل
- `EngineeringOS-main/attached_assets/Pasted--Git-AI-Orchestrator-lib-ai-orchestrator-src-tools-git-_1784347517831.txt` | `Pasted--Git-AI-Orchestrator-lib-ai-orchestrator-src-tools-git-_1784347517831.txt` | `.txt` | historical analysis / export / evidence | text/doc/config | مقروء بالكامل
- `EngineeringOS-main/attached_assets/Pasted--Knowledge-Graph-2-0--1784165514922_1784165514926.txt` | `Pasted--Knowledge-Graph-2-0--1784165514922_1784165514926.txt` | `.txt` | historical analysis / export / evidence | text/doc/config | مقروء بالكامل
- `EngineeringOS-main/attached_assets/Pasted--Knowledge-Graph-2-0-Checklist-File--1784165546932_1784165546935.txt` | `Pasted--Knowledge-Graph-2-0-Checklist-File--1784165546932_1784165546935.txt` | `.txt` | historical analysis / export / evidence | text/doc/config | مقروء بالكامل
- `EngineeringOS-main/attached_assets/Pasted--PR--1784040954263_1784040954267.txt` | `Pasted--PR--1784040954263_1784040954267.txt` | `.txt` | historical analysis / export / evidence | text/doc/config | مقروء بالكامل
- `EngineeringOS-main/attached_assets/Pasted--PR-01-Sync-OpenAPI-with-runtime-graph-surface-files-li_1784234215782.txt` | `Pasted--PR-01-Sync-OpenAPI-with-runtime-graph-surface-files-li_1784234215782.txt` | `.txt` | historical analysis / export / evidence | text/doc/config | مقروء بالكامل
- `EngineeringOS-main/attached_assets/Pasted--PR-03-Micro-Backlog-Contract-Layer-Stabilization-1-3--_1784158287520.txt` | `Pasted--PR-03-Micro-Backlog-Contract-Layer-Stabilization-1-3--_1784158287520.txt` | `.txt` | historical analysis / export / evidence | text/doc/config | مقروء بالكامل
- `EngineeringOS-main/attached_assets/Pasted--PR-1-Hardening-Contract-Alignment-for-projects-ts-proj_1784052905584.txt` | `Pasted--PR-1-Hardening-Contract-Alignment-for-projects-ts-proj_1784052905584.txt` | `.txt` | historical analysis / export / evidence | text/doc/config | مقروء بالكامل
- `EngineeringOS-main/attached_assets/Pasted--PR-Backlog-EngineeringOS-1-Scoping-ownership-integrity_1784154359481.txt` | `Pasted--PR-Backlog-EngineeringOS-1-Scoping-ownership-integrity_1784154359481.txt` | `.txt` | historical analysis / export / evidence | text/doc/config | مقروء بالكامل
- `EngineeringOS-main/attached_assets/Pasted--PR-Backlog-EngineeringOS-Execution-Alignment--17841474_1784147452495.txt` | `Pasted--PR-Backlog-EngineeringOS-Execution-Alignment--17841474_1784147452495.txt` | `.txt` | historical analysis / export / evidence | text/doc/config | مقروء بالكامل
- `EngineeringOS-main/attached_assets/Pasted--PR-Title-fix-ai-chat-surface-AI-request-failures-and-r_1784130154946.txt` | `Pasted--PR-Title-fix-ai-chat-surface-AI-request-failures-and-r_1784130154946.txt` | `.txt` | historical analysis / export / evidence | text/doc/config | مقروء بالكامل
- `EngineeringOS-main/attached_assets/Pasted--PR-Title-fix-discovery-Classify-Project-Loading-Failur_1784086246178.txt` | `Pasted--PR-Title-fix-discovery-Classify-Project-Loading-Failur_1784086246178.txt` | `.txt` | historical analysis / export / evidence | text/doc/config | مقروء بالكامل
- `EngineeringOS-main/attached_assets/Pasted--PR-app-ts--1784047027177_1784047027183.txt` | `Pasted--PR-app-ts--1784047027177_1784047027183.txt` | `.txt` | historical analysis / export / evidence | text/doc/config | مقروء بالكامل
- `EngineeringOS-main/attached_assets/Pasted--PR-app-ts--1784047927706_1784047927710.txt` | `Pasted--PR-app-ts--1784047927706_1784047927710.txt` | `.txt` | historical analysis / export / evidence | text/doc/config | مقروء بالكامل
- `EngineeringOS-main/attached_assets/Pasted--PR-backlog-PR--1784509953092_1784509953095.txt` | `Pasted--PR-backlog-PR--1784509953092_1784509953095.txt` | `.txt` | historical analysis / export / evidence | text/doc/config | مقروء بالكامل
- `EngineeringOS-main/attached_assets/Pasted--PR-discovery-ts-PR-1-Discovery--1783996178319_1783996178325.txt` | `Pasted--PR-discovery-ts-PR-1-Discovery--1783996178319_1783996178325.txt` | `.txt` | historical analysis / export / evidence | text/doc/config | مقروء بالكامل
- `EngineeringOS-main/attached_assets/Pasted--PR-lib-ai-orchestrator-PR-1-Prompt-Templates--17839939_1783993953832.txt` | `Pasted--PR-lib-ai-orchestrator-PR-1-Prompt-Templates--17839939_1783993953832.txt` | `.txt` | historical analysis / export / evidence | text/doc/config | مقروء بالكامل
- `EngineeringOS-main/attached_assets/Pasted--PR-lib-ai-orchestrator-PR-1-Prompt-Templates--17839939_1783993967887.txt` | `Pasted--PR-lib-ai-orchestrator-PR-1-Prompt-Templates--17839939_1783993967887.txt` | `.txt` | historical analysis / export / evidence | text/doc/config | مقروء بالكامل
- `EngineeringOS-main/attached_assets/Pasted--PR-lib-ai-orchestrator-PR-1-Prompt-Templates--17839950_1783995013203.txt` | `Pasted--PR-lib-ai-orchestrator-PR-1-Prompt-Templates--17839950_1783995013203.txt` | `.txt` | historical analysis / export / evidence | text/doc/config | مقروء بالكامل
- `EngineeringOS-main/attached_assets/Pasted--PR-title-Harden-auth-context-and-prepare-project-scope_1784044908893.txt` | `Pasted--PR-title-Harden-auth-context-and-prepare-project-scope_1784044908893.txt` | `.txt` | historical analysis / export / evidence | text/doc/config | مقروء بالكامل
- `EngineeringOS-main/attached_assets/Pasted--PR-title-Hardening-discovery-ts-into-a-deterministic-o_1784053152915.txt` | `Pasted--PR-title-Hardening-discovery-ts-into-a-deterministic-o_1784053152915.txt` | `.txt` | historical analysis / export / evidence | text/doc/config | مقروء بالكامل
- `EngineeringOS-main/attached_assets/Pasted--Plan-3-Sync-fact-record-architecture-docs-3-Sync-Fact-_1783733496072.txt` | `Pasted--Plan-3-Sync-fact-record-architecture-docs-3-Sync-Fact-_1783733496072.txt` | `.txt` | historical analysis / export / evidence | text/doc/config | مقروء بالكامل
- `EngineeringOS-main/attached_assets/Pasted--Plan-3-Sync-fact-record-architecture-docs-3-Sync-Fact-_1783790285219.txt` | `Pasted--Plan-3-Sync-fact-record-architecture-docs-3-Sync-Fact-_1783790285219.txt` | `.txt` | historical analysis / export / evidence | text/doc/config | مقروء بالكامل
- `EngineeringOS-main/attached_assets/Pasted--Today-5-05-AM-EngineeringOS-main-66-zip-Zip-Archive-Fo_1784430667443.txt` | `Pasted--Today-5-05-AM-EngineeringOS-main-66-zip-Zip-Archive-Fo_1784430667443.txt` | `.txt` | historical analysis / export / evidence | text/doc/config | مقروء بالكامل
- `EngineeringOS-main/attached_assets/Pasted--artifacts-api-server-src-lib-scan-runner-ts--178460388_1784603885654.txt` | `Pasted--artifacts-api-server-src-lib-scan-runner-ts--178460388_1784603885654.txt` | `.txt` | historical analysis / export / evidence | text/doc/config | مقروء بالكامل
- `EngineeringOS-main/attached_assets/Pasted--artifacts-api-server-src-routes-ai-ts-lib-ai-orchestra_1784388540189.txt` | `Pasted--artifacts-api-server-src-routes-ai-ts-lib-ai-orchestra_1784388540189.txt` | `.txt` | historical analysis / export / evidence | text/doc/config | مقروء بالكامل
- `EngineeringOS-main/attached_assets/Pasted--artifacts-api-server-src-routes-discovery-ts--17839967_1783996711676.txt` | `Pasted--artifacts-api-server-src-routes-discovery-ts--17839967_1783996711676.txt` | `.txt` | historical analysis / export / evidence | text/doc/config | مقروء بالكامل
- `EngineeringOS-main/attached_assets/Pasted--artifacts-api-server-src-routes-discovery-ts--17839967_1783997082105.txt` | `Pasted--artifacts-api-server-src-routes-discovery-ts--17839967_1783997082105.txt` | `.txt` | historical analysis / export / evidence | text/doc/config | مقروء بالكامل
- `EngineeringOS-main/attached_assets/Pasted--lib-ai-orchestrator--1783993997216_1783993997218.txt` | `Pasted--lib-ai-orchestrator--1783993997216_1783993997218.txt` | `.txt` | historical analysis / export / evidence | text/doc/config | مقروء بالكامل
- `EngineeringOS-main/attached_assets/Pasted--lib-db-test-script--1784159470823_1784159470827.txt` | `Pasted--lib-db-test-script--1784159470823_1784159470827.txt` | `.txt` | historical analysis / export / evidence | text/doc/config | مقروء بالكامل
- `EngineeringOS-main/attached_assets/Pasted--onboarding-o-1783988399961_1783988399964.txt` | `Pasted--onboarding-o-1783988399961_1783988399964.txt` | `.txt` | historical analysis / export / evidence | text/doc/config | مقروء بالكامل
- `EngineeringOS-main/attached_assets/Pasted--src-context-builder-ts-src-schemas-context-schema-1784_1784305372706.txt` | `Pasted--src-context-builder-ts-src-schemas-context-schema-1784_1784305372706.txt` | `.txt` | historical analysis / export / evidence | text/doc/config | مقروء بالكامل
- `EngineeringOS-main/attached_assets/Pasted--test--1784245726594_1784245726598.txt` | `Pasted--test--1784245726594_1784245726598.txt` | `.txt` | historical analysis / export / evidence | text/doc/config | مقروء بالكامل
- `EngineeringOS-main/attached_assets/Pasted--test--1784245803493_1784245803497.txt` | `Pasted--test--1784245803493_1784245803497.txt` | `.txt` | historical analysis / export / evidence | text/doc/config | مقروء بالكامل
- `EngineeringOS-main/attached_assets/Pasted-7-Upgrade-Dashboard-to-Operational-UI-What-Why-Current-_1783734748019.txt` | `Pasted-7-Upgrade-Dashboard-to-Operational-UI-What-Why-Current-_1783734748019.txt` | `.txt` | historical analysis / export / evidence | text/doc/config | مقروء بالكامل
- `EngineeringOS-main/attached_assets/Pasted-7-Upgrade-Dashboard-to-Operational-UI-What-Why-Current-_1783798897613.txt` | `Pasted-7-Upgrade-Dashboard-to-Operational-UI-What-Why-Current-_1783798897613.txt` | `.txt` | historical analysis / export / evidence | text/doc/config | مقروء بالكامل
- `EngineeringOS-main/attached_assets/Pasted-Continuing-with-the-appendices-and-the-remaining-large-_1784588937982.txt` | `Pasted-Continuing-with-the-appendices-and-the-remaining-large-_1784588937982.txt` | `.txt` | historical analysis / export / evidence | text/doc/config | مقروء بالكامل
- `EngineeringOS-main/attached_assets/Pasted-Continuing-with-the-appendices-and-the-remaining-large-_1784588957924.txt` | `Pasted-Continuing-with-the-appendices-and-the-remaining-large-_1784588957924.txt` | `.txt` | historical analysis / export / evidence | text/doc/config | مقروء بالكامل
- `EngineeringOS-main/attached_assets/Pasted-PR-Title-security-ai-Harden-User-Scoped-Groq-Credential_1784127290653.txt` | `Pasted-PR-Title-security-ai-Harden-User-Scoped-Groq-Credential_1784127290653.txt` | `.txt` | historical analysis / export / evidence | text/doc/config | مقروء بالكامل
- `EngineeringOS-main/attached_assets/Pasted-Plan-6-Deepen-graph-scanner-discovery-6-Deepen-Graph-Sc_1783734658300.txt` | `Pasted-Plan-6-Deepen-graph-scanner-discovery-6-Deepen-Graph-Sc_1783734658300.txt` | `.txt` | historical analysis / export / evidence | text/doc/config | مقروء بالكامل
- `EngineeringOS-main/attached_assets/Pasted-We-are-CONTINUING-an-interrupted-implementation-session_1784565760215.txt` | `Pasted-We-are-CONTINUING-an-interrupted-implementation-session_1784565760215.txt` | `.txt` | historical analysis / export / evidence | text/doc/config | مقروء بالكامل
- `EngineeringOS-main/attached_assets/Pasted-We-are-CONTINUING-an-interrupted-implementation-session_1784565840455.txt` | `Pasted-We-are-CONTINUING-an-interrupted-implementation-session_1784565840455.txt` | `.txt` | historical analysis / export / evidence | text/doc/config | مقروء بالكامل
- `EngineeringOS-main/attached_assets/Screenshot_٢٠٢٦٠٧٠٩-٠٦١٦٢٥_1783567039006.png` | `Screenshot_٢٠٢٦٠٧٠٩-٠٦١٦٢٥_1783567039006.png` | `.png` | historical evidence or archive | binary artifact | بيانات/فهرسة فقط
- `EngineeringOS-main/attached_assets/Screenshot_٢٠٢٦٠٧٠٩-٠٦٢٠٣٨_1783610776566.png` | `Screenshot_٢٠٢٦٠٧٠٩-٠٦٢٠٣٨_1783610776566.png` | `.png` | historical evidence or archive | binary artifact | بيانات/فهرسة فقط
- `EngineeringOS-main/attached_assets/Screenshot_٢٠٢٦٠٧١٣-٠٣٥٣١٨_1783904118069.png` | `Screenshot_٢٠٢٦٠٧١٣-٠٣٥٣١٨_1783904118069.png` | `.png` | historical evidence or archive | binary artifact | بيانات/فهرسة فقط
- `EngineeringOS-main/attached_assets/Screenshot_٢٠٢٦٠٧١٣-٠٤٠٥١١_1783904724118.png` | `Screenshot_٢٠٢٦٠٧١٣-٠٤٠٥١١_1783904724118.png` | `.png` | historical evidence or archive | binary artifact | بيانات/فهرسة فقط
- `EngineeringOS-main/attached_assets/Screenshot_٢٠٢٦٠٧١٣-٠٤٤٤٢٨_1783907108840.png` | `Screenshot_٢٠٢٦٠٧١٣-٠٤٤٤٢٨_1783907108840.png` | `.png` | historical evidence or archive | binary artifact | بيانات/فهرسة فقط
- `EngineeringOS-main/attached_assets/Screenshot_٢٠٢٦٠٧١٣-٠٥٠١٣٨_1783908128704.png` | `Screenshot_٢٠٢٦٠٧١٣-٠٥٠١٣٨_1783908128704.png` | `.png` | historical evidence or archive | binary artifact | بيانات/فهرسة فقط
- `EngineeringOS-main/attached_assets/Screenshot_٢٠٢٦٠٧١٣-٠٥١٤٥٤_1783908924873.png` | `Screenshot_٢٠٢٦٠٧١٣-٠٥١٤٥٤_1783908924873.png` | `.png` | historical evidence or archive | binary artifact | بيانات/فهرسة فقط
- `EngineeringOS-main/attached_assets/Screenshot_٢٠٢٦٠٧١٣-٠٥١٩٤٨_1783909201747.png` | `Screenshot_٢٠٢٦٠٧١٣-٠٥١٩٤٨_1783909201747.png` | `.png` | historical evidence or archive | binary artifact | بيانات/فهرسة فقط
- `EngineeringOS-main/attached_assets/Screenshot_٢٠٢٦٠٧١٦-٠٧٣٧٤٤_1784176683628.png` | `Screenshot_٢٠٢٦٠٧١٦-٠٧٣٧٤٤_1784176683628.png` | `.png` | historical evidence or archive | binary artifact | بيانات/فهرسة فقط
- `EngineeringOS-main/attached_assets/Screenshot_٢٠٢٦٠٧١٦-١٨٣٠٤١_1784216000977.png` | `Screenshot_٢٠٢٦٠٧١٦-١٨٣٠٤١_1784216000977.png` | `.png` | historical evidence or archive | binary artifact | بيانات/فهرسة فقط
- `EngineeringOS-main/attached_assets/Screenshot_٢٠٢٦٠٧١٦-١٨٣٠٤٦_1784216000942.png` | `Screenshot_٢٠٢٦٠٧١٦-١٨٣٠٤٦_1784216000942.png` | `.png` | historical evidence or archive | binary artifact | بيانات/فهرسة فقط
- `EngineeringOS-main/attached_assets/Screenshot_٢٠٢٦٠٧١٨-٠١٠٨١٠_1784326132441.png` | `Screenshot_٢٠٢٦٠٧١٨-٠١٠٨١٠_1784326132441.png` | `.png` | historical evidence or archive | binary artifact | بيانات/فهرسة فقط
- `EngineeringOS-main/attached_assets/Screenshot_٢٠٢٦٠٧١٨-٠٦١٢٠٢_1784344398002.png` | `Screenshot_٢٠٢٦٠٧١٨-٠٦١٢٠٢_1784344398002.png` | `.png` | historical evidence or archive | binary artifact | بيانات/فهرسة فقط
- `EngineeringOS-main/attached_assets/Screenshot_٢٠٢٦٠٧١٨-٠٦١٢٤٢_1784344397966.png` | `Screenshot_٢٠٢٦٠٧١٨-٠٦١٢٤٢_1784344397966.png` | `.png` | historical evidence or archive | binary artifact | بيانات/فهرسة فقط
- `EngineeringOS-main/attached_assets/Screenshot_٢٠٢٦٠٧١٨-٠٦١٢٤٦_1784344397931.png` | `Screenshot_٢٠٢٦٠٧١٨-٠٦١٢٤٦_1784344397931.png` | `.png` | historical evidence or archive | binary artifact | بيانات/فهرسة فقط
- `EngineeringOS-main/attached_assets/Screenshot_٢٠٢٦٠٧١٨-٠٦١٩١٠_1784344762476.png` | `Screenshot_٢٠٢٦٠٧١٨-٠٦١٩١٠_1784344762476.png` | `.png` | historical evidence or archive | binary artifact | بيانات/فهرسة فقط
- `EngineeringOS-main/attached_assets/Screenshot_٢٠٢٦٠٧١٩-٠٤٣٥١٧_1784424954601.png` | `Screenshot_٢٠٢٦٠٧١٩-٠٤٣٥١٧_1784424954601.png` | `.png` | historical evidence or archive | binary artifact | بيانات/فهرسة فقط
- `EngineeringOS-main/attached_assets/Screenshot_٢٠٢٦٠٧١٩-٠٤٣٥٢١_1784424954559.png` | `Screenshot_٢٠٢٦٠٧١٩-٠٤٣٥٢١_1784424954559.png` | `.png` | historical evidence or archive | binary artifact | بيانات/فهرسة فقط
- `EngineeringOS-main/attached_assets/Screenshot_٢٠٢٦٠٧٢٠-٠٢٠٢٥١_1784502211806.png` | `Screenshot_٢٠٢٦٠٧٢٠-٠٢٠٢٥١_1784502211806.png` | `.png` | historical evidence or archive | binary artifact | بيانات/فهرسة فقط
- `EngineeringOS-main/attached_assets/Screenshot_٢٠٢٦٠٧٢٠-٠٢٠٣٠٤_1784502211776.png` | `Screenshot_٢٠٢٦٠٧٢٠-٠٢٠٣٠٤_1784502211776.png` | `.png` | historical evidence or archive | binary artifact | بيانات/فهرسة فقط
- `EngineeringOS-main/attached_assets/Screenshot_٢٠٢٦٠٧٢٠-٠٢٢٤٤٨_1784504071817.png` | `Screenshot_٢٠٢٦٠٧٢٠-٠٢٢٤٤٨_1784504071817.png` | `.png` | historical evidence or archive | binary artifact | بيانات/فهرسة فقط
- `EngineeringOS-main/attached_assets/Screenshot_٢٠٢٦٠٧٢٠-٠٢٢٤٥١_1784504071787.png` | `Screenshot_٢٠٢٦٠٧٢٠-٠٢٢٤٥١_1784504071787.png` | `.png` | historical evidence or archive | binary artifact | بيانات/فهرسة فقط
- `EngineeringOS-main/attached_assets/Screenshot_٢٠٢٦٠٧٢٠-٠٢٢٤٥٥_1784504071737.png` | `Screenshot_٢٠٢٦٠٧٢٠-٠٢٢٤٥٥_1784504071737.png` | `.png` | historical evidence or archive | binary artifact | بيانات/فهرسة فقط
- `EngineeringOS-main/attached_assets/Screenshot_٢٠٢٦٠٧٢٠-٠٣٢٣٤٤_1784507048475.png` | `Screenshot_٢٠٢٦٠٧٢٠-٠٣٢٣٤٤_1784507048475.png` | `.png` | historical evidence or archive | binary artifact | بيانات/فهرسة فقط
- `EngineeringOS-main/attached_assets/Screenshot_٢٠٢٦٠٧٢٠-٠٤٤٥٣٥_1784512160900.png` | `Screenshot_٢٠٢٦٠٧٢٠-٠٤٤٥٣٥_1784512160900.png` | `.png` | historical evidence or archive | binary artifact | بيانات/فهرسة فقط
- `EngineeringOS-main/attached_assets/Screenshot_٢٠٢٦٠٧٢٠-٠٦١٠٤٦_1784517131306.png` | `Screenshot_٢٠٢٦٠٧٢٠-٠٦١٠٤٦_1784517131306.png` | `.png` | historical evidence or archive | binary artifact | بيانات/فهرسة فقط
- `EngineeringOS-main/attached_assets/Screenshot_٢٠٢٦٠٧٢٠-٠٦١٠٥٢_1784517131269.png` | `Screenshot_٢٠٢٦٠٧٢٠-٠٦١٠٥٢_1784517131269.png` | `.png` | historical evidence or archive | binary artifact | بيانات/فهرسة فقط
- `EngineeringOS-main/attached_assets/Screenshot_٢٠٢٦٠٧٢١-١٨٠٩٠٦_1784646632784.png` | `Screenshot_٢٠٢٦٠٧٢١-١٨٠٩٠٦_1784646632784.png` | `.png` | historical evidence or archive | binary artifact | بيانات/فهرسة فقط
- `EngineeringOS-main/attached_assets/Screenshot_٢٠٢٦٠٧٢٢-٠٣١٠٢٣_1784679051607.png` | `Screenshot_٢٠٢٦٠٧٢٢-٠٣١٠٢٣_1784679051607.png` | `.png` | historical evidence or archive | binary artifact | بيانات/فهرسة فقط
- `EngineeringOS-main/attached_assets/Screenshot_٢٠٢٦٠٧٢٢-٠٤١٩٠٩_1784683176768.png` | `Screenshot_٢٠٢٦٠٧٢٢-٠٤١٩٠٩_1784683176768.png` | `.png` | historical evidence or archive | binary artifact | بيانات/فهرسة فقط
- `EngineeringOS-main/attached_assets/agents_(1)_1783564013722.zip` | `agents_(1)_1783564013722.zip` | `.zip` | historical evidence or archive | binary artifact | بيانات/فهرسة فقط
- `EngineeringOS-main/attached_assets/ai_orchestrator_deep_dive_(1)_1783994021466.md` | `ai_orchestrator_deep_dive_(1)_1783994021466.md` | `.md` | historical analysis / export / evidence | text/doc/config | مقروء بالكامل
- `EngineeringOS-main/attached_assets/artifacts_(7)_(1)_1783564013761.zip` | `artifacts_(7)_(1)_1783564013761.zip` | `.zip` | historical evidence or archive | binary artifact | بيانات/فهرسة فقط
- `EngineeringOS-main/attached_assets/engineeringos_forensic_analysis_1784431635464.md` | `engineeringos_forensic_analysis_1784431635464.md` | `.md` | historical analysis / export / evidence | text/doc/config | مقروء بالكامل
- `EngineeringOS-main/attached_assets/engineeringos_forensic_analysis_complete_1784431954519.md` | `engineeringos_forensic_analysis_complete_1784431954519.md` | `.md` | historical analysis / export / evidence | text/doc/config | مقروء بالكامل
- `EngineeringOS-main/attached_assets/engineeringos_forensic_analysis_complete_1784476328406.md` | `engineeringos_forensic_analysis_complete_1784476328406.md` | `.md` | historical analysis / export / evidence | text/doc/config | مقروء بالكامل
- `EngineeringOS-main/attached_assets/engineeringos_forensic_audit_report_(2)_1784594296592_1784597203240.md` | `engineeringos_forensic_audit_report_(2)_1784594296592_1784597203240.md` | `.md` | historical analysis / export / evidence | text/doc/config | مقروء بالكامل
- `EngineeringOS-main/attached_assets/engineeringos_forensic_audit_report_(2)_1784594296592_1784600036061.md` | `engineeringos_forensic_audit_report_(2)_1784594296592_1784600036061.md` | `.md` | historical analysis / export / evidence | text/doc/config | مقروء بالكامل
- `EngineeringOS-main/attached_assets/engineeringos_forensic_audit_report_(2)_1784594296592_1784601251287.md` | `engineeringos_forensic_audit_report_(2)_1784594296592_1784601251287.md` | `.md` | historical analysis / export / evidence | text/doc/config | مقروء بالكامل
- `EngineeringOS-main/attached_assets/engineeringos_forensic_audit_report_1784498370433.md` | `engineeringos_forensic_audit_report_1784498370433.md` | `.md` | historical analysis / export / evidence | text/doc/config | مقروء بالكامل
- `EngineeringOS-main/attached_assets/engineeringos_forensic_audit_report_1784499793978.md` | `engineeringos_forensic_audit_report_1784499793978.md` | `.md` | historical analysis / export / evidence | text/doc/config | مقروء بالكامل
- `EngineeringOS-main/attached_assets/engineeringos_forensic_audit_report_1784500814802.md` | `engineeringos_forensic_audit_report_1784500814802.md` | `.md` | historical analysis / export / evidence | text/doc/config | مقروء بالكامل
- `EngineeringOS-main/attached_assets/engineeringos_master_inventory_(3)_1784597203313.csv` | `engineeringos_master_inventory_(3)_1784597203313.csv` | `.csv` | historical analysis / export / evidence | text/doc/config | مقروء بالكامل
- `EngineeringOS-main/attached_assets/engineeringos_master_inventory_(3)_1784600036116.csv` | `engineeringos_master_inventory_(3)_1784600036116.csv` | `.csv` | historical analysis / export / evidence | text/doc/config | مقروء بالكامل
- `EngineeringOS-main/attached_assets/engineeringos_master_inventory_(3)_1784601251241.csv` | `engineeringos_master_inventory_(3)_1784601251241.csv` | `.csv` | historical analysis / export / evidence | text/doc/config | مقروء بالكامل
- `EngineeringOS-main/attached_assets/engineeringos_master_inventory_1784498370483.csv` | `engineeringos_master_inventory_1784498370483.csv` | `.csv` | historical analysis / export / evidence | text/doc/config | مقروء بالكامل
- `EngineeringOS-main/attached_assets/engineeringos_master_inventory_1784499794029.csv` | `engineeringos_master_inventory_1784499794029.csv` | `.csv` | historical analysis / export / evidence | text/doc/config | مقروء بالكامل
- `EngineeringOS-main/attached_assets/engineeringos_master_inventory_1784500814907.csv` | `engineeringos_master_inventory_1784500814907.csv` | `.csv` | historical analysis / export / evidence | text/doc/config | مقروء بالكامل
- `EngineeringOS-main/attached_assets/git_(2)_1783564013691.zip` | `git_(2)_1783564013691.zip` | `.zip` | historical evidence or archive | binary artifact | بيانات/فهرسة فقط
- `EngineeringOS-main/attached_assets/gitattributes_1783564013915.txt` | `gitattributes_1783564013915.txt` | `.txt` | historical analysis / export / evidence | text/doc/config | مقروء بالكامل
- `EngineeringOS-main/attached_assets/gitignore_(1)_1783564013965.txt` | `gitignore_(1)_1783564013965.txt` | `.txt` | historical analysis / export / evidence | text/doc/config | مقروء بالكامل
- `EngineeringOS-main/attached_assets/lib_(7)_(1)_1783564013810.zip` | `lib_(7)_(1)_1783564013810.zip` | `.zip` | historical evidence or archive | binary artifact | بيانات/فهرسة فقط
- `EngineeringOS-main/attached_assets/node_modules_(2)_1783564014266.zip` | `node_modules_(2)_1783564014266.zip` | `.zip` | historical evidence or archive | binary artifact | بيانات/فهرسة فقط
- `EngineeringOS-main/attached_assets/npmrc_(2)_1783564014024.txt` | `npmrc_(2)_1783564014024.txt` | `.txt` | historical analysis / export / evidence | text/doc/config | مقروء بالكامل
- `EngineeringOS-main/attached_assets/package_(1)_(7)_1783564014328.json` | `package_(1)_(7)_1783564014328.json` | `.json` | historical analysis / export / evidence | text/doc/config | مقروء بالكامل
- `EngineeringOS-main/attached_assets/pnpm-lock.yaml_(3)_1783564014392.txt` | `pnpm-lock.yaml_(3)_1783564014392.txt` | `.txt` | historical analysis / export / evidence | text/doc/config | مقروء بالكامل
- `EngineeringOS-main/attached_assets/pnpm-workspace.yaml_(3)_1783564014449.txt` | `pnpm-workspace.yaml_(3)_1783564014449.txt` | `.txt` | historical analysis / export / evidence | text/doc/config | مقروء بالكامل
- `EngineeringOS-main/attached_assets/pr-backlog-ai-orchestrator_1784306020062.md` | `pr-backlog-ai-orchestrator_1784306020062.md` | `.md` | historical analysis / export / evidence | text/doc/config | مقروء بالكامل
- `EngineeringOS-main/attached_assets/replit_(13)_1783564014085.md` | `replit_(13)_1783564014085.md` | `.md` | historical analysis / export / evidence | text/doc/config | مقروء بالكامل
- `EngineeringOS-main/attached_assets/replit_(2)_1783564014509.txt` | `replit_(2)_1783564014509.txt` | `.txt` | historical analysis / export / evidence | text/doc/config | مقروء بالكامل
- `EngineeringOS-main/attached_assets/replitignore_1783564014569.txt` | `replitignore_1783564014569.txt` | `.txt` | historical analysis / export / evidence | text/doc/config | مقروء بالكامل
- `EngineeringOS-main/attached_assets/scripts_(8)_1783564013865.zip` | `scripts_(8)_1783564013865.zip` | `.zip` | historical evidence or archive | binary artifact | بيانات/فهرسة فقط
- `EngineeringOS-main/attached_assets/tsconfig.base_(2)_(1)_1783564014142.json` | `tsconfig.base_(2)_(1)_1783564014142.json` | `.json` | historical analysis / export / evidence | text/doc/config | مقروء بالكامل
- `EngineeringOS-main/attached_assets/tsconfig_(7)_1783564014202.json` | `tsconfig_(7)_1783564014202.json` | `.json` | historical analysis / export / evidence | text/doc/config | مقروء بالكامل
- `EngineeringOS-main/attached_assets/تحليل_EngineeringOS_1783804577785.docx` | `تحليل_EngineeringOS_1783804577785.docx` | `.docx` | historical evidence or archive | binary artifact | بيانات/فهرسة فقط
- `EngineeringOS-main/attached_assets/خطة_العمل_التنفيذية_لمشروع_EngineeringOS_1783729892699.docx` | `خطة_العمل_التنفيذية_لمشروع_EngineeringOS_1783729892699.docx` | `.docx` | historical evidence or archive | binary artifact | بيانات/فهرسة فقط

#### `docs` (15)

- `EngineeringOS-main/docs/ENGINEERINGOS_MASTER_EXECUTION_CONSTITUTION.md` | `ENGINEERINGOS_MASTER_EXECUTION_CONSTITUTION.md` | `.md` | project documentation / governance | text/doc/config | مقروء بالكامل
- `EngineeringOS-main/docs/EXECUTION_ALIGNMENT_REPORT.md` | `EXECUTION_ALIGNMENT_REPORT.md` | `.md` | project documentation / governance | text/doc/config | مقروء بالكامل
- `EngineeringOS-main/docs/PLACEHOLDER_REGISTER.md` | `PLACEHOLDER_REGISTER.md` | `.md` | project documentation / governance | text/doc/config | مقروء بالكامل
- `EngineeringOS-main/docs/PR_BACKLOG.md` | `PR_BACKLOG.md` | `.md` | project documentation / governance | text/doc/config | مقروء بالكامل
- `EngineeringOS-main/docs/RUNTIME_EXECUTION_MATRIX.md` | `RUNTIME_EXECUTION_MATRIX.md` | `.md` | project documentation / governance | text/doc/config | مقروء بالكامل
- `EngineeringOS-main/docs/ai-orchestrator-executive-table.md` | `ai-orchestrator-executive-table.md` | `.md` | project documentation / governance | text/doc/config | مقروء بالكامل
- `EngineeringOS-main/docs/ai-orchestrator-forensic-analysis.md` | `ai-orchestrator-forensic-analysis.md` | `.md` | project documentation / governance | text/doc/config | مقروء بالكامل
- `EngineeringOS-main/docs/ai-orchestrator-gap-analysis.md` | `ai-orchestrator-gap-analysis.md` | `.md` | project documentation / governance | text/doc/config | مقروء بالكامل
- `EngineeringOS-main/docs/ai-orchestrator-trace-analysis.md` | `ai-orchestrator-trace-analysis.md` | `.md` | project documentation / governance | text/doc/config | مقروء بالكامل
- `EngineeringOS-main/docs/architecture.md` | `architecture.md` | `.md` | project documentation / governance | text/doc/config | مقروء بالكامل
- `EngineeringOS-main/docs/completion-plan.md` | `completion-plan.md` | `.md` | project documentation / governance | text/doc/config | مقروء بالكامل
- `EngineeringOS-main/docs/fact-record.md` | `fact-record.md` | `.md` | project documentation / governance | text/doc/config | مقروء بالكامل
- `EngineeringOS-main/docs/pr-backlog-ai-orchestrator.md` | `pr-backlog-ai-orchestrator.md` | `.md` | project documentation / governance | text/doc/config | مقروء بالكامل
- `EngineeringOS-main/docs/truth-flow-pr-checklist.md` | `truth-flow-pr-checklist.md` | `.md` | project documentation / governance | text/doc/config | مقروء بالكامل
- `EngineeringOS-main/docs/truth-flow-pr-review-plan.md` | `truth-flow-pr-review-plan.md` | `.md` | project documentation / governance | text/doc/config | مقروء بالكامل

#### `lib` (261)

- `EngineeringOS-main/lib/ai-orchestrator/package.json` | `package.json` | `.json` | workspace configuration / repo governance | config/text | مقروء بالكامل
- `EngineeringOS-main/lib/ai-orchestrator/src/__tests__/chat-agent.test.ts` | `chat-agent.test.ts` | `.ts` | LLM orchestration layer | code | مقروء بالكامل
- `EngineeringOS-main/lib/ai-orchestrator/src/__tests__/file-tools.test.ts` | `file-tools.test.ts` | `.ts` | LLM orchestration layer | code | مقروء بالكامل
- `EngineeringOS-main/lib/ai-orchestrator/src/__tests__/groq-client.test.ts` | `groq-client.test.ts` | `.ts` | LLM orchestration layer | code | مقروء بالكامل
- `EngineeringOS-main/lib/ai-orchestrator/src/__tests__/parsing.test.ts` | `parsing.test.ts` | `.ts` | LLM orchestration layer | code | مقروء بالكامل
- `EngineeringOS-main/lib/ai-orchestrator/src/__tests__/schemas.test.ts` | `schemas.test.ts` | `.ts` | LLM orchestration layer | code | مقروء بالكامل
- `EngineeringOS-main/lib/ai-orchestrator/src/__tests__/workflow-orchestrator.test.ts` | `workflow-orchestrator.test.ts` | `.ts` | LLM orchestration layer | code | مقروء بالكامل
- `EngineeringOS-main/lib/ai-orchestrator/src/agents/chat-agent.ts` | `chat-agent.ts` | `.ts` | LLM orchestration layer | code | مقروء بالكامل
- `EngineeringOS-main/lib/ai-orchestrator/src/agents/code-reviewer.ts` | `code-reviewer.ts` | `.ts` | LLM orchestration layer | code | مقروء بالكامل
- `EngineeringOS-main/lib/ai-orchestrator/src/agents/scan-analyst.ts` | `scan-analyst.ts` | `.ts` | LLM orchestration layer | code | مقروء بالكامل
- `EngineeringOS-main/lib/ai-orchestrator/src/agents/task-agent.ts` | `task-agent.ts` | `.ts` | LLM orchestration layer | code | مقروء بالكامل
- `EngineeringOS-main/lib/ai-orchestrator/src/agents/workflow-orchestrator.ts` | `workflow-orchestrator.ts` | `.ts` | LLM orchestration layer | code | مقروء بالكامل
- `EngineeringOS-main/lib/ai-orchestrator/src/context-builder.test.ts` | `context-builder.test.ts` | `.ts` | LLM orchestration layer | code | مقروء بالكامل
- `EngineeringOS-main/lib/ai-orchestrator/src/context-builder.ts` | `context-builder.ts` | `.ts` | LLM orchestration layer | code | مقروء بالكامل
- `EngineeringOS-main/lib/ai-orchestrator/src/deepseek-client.ts` | `deepseek-client.ts` | `.ts` | LLM orchestration layer | code | مقروء بالكامل
- `EngineeringOS-main/lib/ai-orchestrator/src/errors.ts` | `errors.ts` | `.ts` | LLM orchestration layer | code | مقروء بالكامل
- `EngineeringOS-main/lib/ai-orchestrator/src/groq-client.ts` | `groq-client.ts` | `.ts` | LLM orchestration layer | code | مقروء بالكامل
- `EngineeringOS-main/lib/ai-orchestrator/src/index.ts` | `index.ts` | `.ts` | LLM orchestration layer | code | مقروء بالكامل
- `EngineeringOS-main/lib/ai-orchestrator/src/parsing.ts` | `parsing.ts` | `.ts` | LLM orchestration layer | code | مقروء بالكامل
- `EngineeringOS-main/lib/ai-orchestrator/src/prompts/chat.prompt.ts` | `chat.prompt.ts` | `.ts` | LLM orchestration layer | code | مقروء بالكامل
- `EngineeringOS-main/lib/ai-orchestrator/src/prompts/index.ts` | `index.ts` | `.ts` | LLM orchestration layer | code | مقروء بالكامل
- `EngineeringOS-main/lib/ai-orchestrator/src/prompts/review.prompt.ts` | `review.prompt.ts` | `.ts` | LLM orchestration layer | code | مقروء بالكامل
- `EngineeringOS-main/lib/ai-orchestrator/src/prompts/scan.prompt.ts` | `scan.prompt.ts` | `.ts` | LLM orchestration layer | code | مقروء بالكامل
- `EngineeringOS-main/lib/ai-orchestrator/src/prompts/task.prompt.ts` | `task.prompt.ts` | `.ts` | LLM orchestration layer | code | مقروء بالكامل
- `EngineeringOS-main/lib/ai-orchestrator/src/prompts/workflow.prompt.ts` | `workflow.prompt.ts` | `.ts` | LLM orchestration layer | code | مقروء بالكامل
- `EngineeringOS-main/lib/ai-orchestrator/src/schemas/chat.schema.ts` | `chat.schema.ts` | `.ts` | LLM orchestration layer | code | مقروء بالكامل
- `EngineeringOS-main/lib/ai-orchestrator/src/schemas/code-review.schema.ts` | `code-review.schema.ts` | `.ts` | LLM orchestration layer | code | مقروء بالكامل
- `EngineeringOS-main/lib/ai-orchestrator/src/schemas/context.schema.ts` | `context.schema.ts` | `.ts` | LLM orchestration layer | code | مقروء بالكامل
- `EngineeringOS-main/lib/ai-orchestrator/src/schemas/index.ts` | `index.ts` | `.ts` | LLM orchestration layer | code | مقروء بالكامل
- `EngineeringOS-main/lib/ai-orchestrator/src/schemas/scan.schema.ts` | `scan.schema.ts` | `.ts` | LLM orchestration layer | code | مقروء بالكامل
- `EngineeringOS-main/lib/ai-orchestrator/src/schemas/task.schema.ts` | `task.schema.ts` | `.ts` | LLM orchestration layer | code | مقروء بالكامل
- `EngineeringOS-main/lib/ai-orchestrator/src/schemas/workflow.schema.ts` | `workflow.schema.ts` | `.ts` | LLM orchestration layer | code | مقروء بالكامل
- `EngineeringOS-main/lib/ai-orchestrator/src/tools/file-tools.ts` | `file-tools.ts` | `.ts` | LLM orchestration layer | code | مقروء بالكامل
- `EngineeringOS-main/lib/ai-orchestrator/src/tools/git-tools.ts` | `git-tools.ts` | `.ts` | LLM orchestration layer | code | مقروء بالكامل
- `EngineeringOS-main/lib/ai-orchestrator/tsconfig.json` | `tsconfig.json` | `.json` | workspace configuration / repo governance | config/text | مقروء بالكامل
- `EngineeringOS-main/lib/ai-orchestrator/vitest.config.ts` | `vitest.config.ts` | `.ts` | LLM orchestration layer | code | مقروء بالكامل
- `EngineeringOS-main/lib/api-client-react/package.json` | `package.json` | `.json` | workspace configuration / repo governance | config/text | مقروء بالكامل
- `EngineeringOS-main/lib/api-client-react/src/custom-fetch.ts` | `custom-fetch.ts` | `.ts` | generated React client surface | code | مقروء بالكامل
- `EngineeringOS-main/lib/api-client-react/src/generated/api.schemas.ts` | `api.schemas.ts` | `.ts` | generated React client surface | code | مقروء بالكامل
- `EngineeringOS-main/lib/api-client-react/src/generated/api.ts` | `api.ts` | `.ts` | generated React client surface | code | مقروء بالكامل
- `EngineeringOS-main/lib/api-client-react/src/index.ts` | `index.ts` | `.ts` | generated React client surface | code | مقروء بالكامل
- `EngineeringOS-main/lib/api-client-react/src/project-error.ts` | `project-error.ts` | `.ts` | generated React client surface | code | مقروء بالكامل
- `EngineeringOS-main/lib/api-client-react/src/use-ai-chat-stream.ts` | `use-ai-chat-stream.ts` | `.ts` | generated React client surface | code | مقروء بالكامل
- `EngineeringOS-main/lib/api-client-react/tsconfig.json` | `tsconfig.json` | `.json` | workspace configuration / repo governance | config/text | مقروء بالكامل
- `EngineeringOS-main/lib/api-spec/openapi.yaml` | `openapi.yaml` | `.yaml` | API contract source and code generation | text/doc/config | مقروء بالكامل
- `EngineeringOS-main/lib/api-spec/orval.config.ts` | `orval.config.ts` | `.ts` | API contract source and code generation | code | مقروء بالكامل
- `EngineeringOS-main/lib/api-spec/package.json` | `package.json` | `.json` | workspace configuration / repo governance | config/text | مقروء بالكامل
- `EngineeringOS-main/lib/api-zod/package.json` | `package.json` | `.json` | workspace configuration / repo governance | config/text | مقروء بالكامل
- `EngineeringOS-main/lib/api-zod/src/generated/api.ts` | `api.ts` | `.ts` | generated schema contracts | code | مقروء بالكامل
- `EngineeringOS-main/lib/api-zod/src/generated/types/activeProviderStatus.ts` | `activeProviderStatus.ts` | `.ts` | generated schema contracts | code | مقروء بالكامل
- `EngineeringOS-main/lib/api-zod/src/generated/types/activeProviderStatusProvider.ts` | `activeProviderStatusProvider.ts` | `.ts` | generated schema contracts | code | مقروء بالكامل
- `EngineeringOS-main/lib/api-zod/src/generated/types/aiApplyChangesRequest.ts` | `aiApplyChangesRequest.ts` | `.ts` | generated schema contracts | code | مقروء بالكامل
- `EngineeringOS-main/lib/api-zod/src/generated/types/aiApplyChangesRequestChangesItem.ts` | `aiApplyChangesRequestChangesItem.ts` | `.ts` | generated schema contracts | code | مقروء بالكامل
- `EngineeringOS-main/lib/api-zod/src/generated/types/aiApplyChangesResult.ts` | `aiApplyChangesResult.ts` | `.ts` | generated schema contracts | code | مقروء بالكامل
- `EngineeringOS-main/lib/api-zod/src/generated/types/aiApplyChangesResultResultsItem.ts` | `aiApplyChangesResultResultsItem.ts` | `.ts` | generated schema contracts | code | مقروء بالكامل
- `EngineeringOS-main/lib/api-zod/src/generated/types/aiChatMessage.ts` | `aiChatMessage.ts` | `.ts` | generated schema contracts | code | مقروء بالكامل
- `EngineeringOS-main/lib/api-zod/src/generated/types/aiChatMessageRole.ts` | `aiChatMessageRole.ts` | `.ts` | generated schema contracts | code | مقروء بالكامل
- `EngineeringOS-main/lib/api-zod/src/generated/types/aiChatOutput.ts` | `aiChatOutput.ts` | `.ts` | generated schema contracts | code | مقروء بالكامل
- `EngineeringOS-main/lib/api-zod/src/generated/types/aiChatRequest.ts` | `aiChatRequest.ts` | `.ts` | generated schema contracts | code | مقروء بالكامل
- `EngineeringOS-main/lib/api-zod/src/generated/types/aiChatSession.ts` | `aiChatSession.ts` | `.ts` | generated schema contracts | code | مقروء بالكامل
- `EngineeringOS-main/lib/api-zod/src/generated/types/aiCodeIssue.ts` | `aiCodeIssue.ts` | `.ts` | generated schema contracts | code | مقروء بالكامل
- `EngineeringOS-main/lib/api-zod/src/generated/types/aiCodeIssueSeverity.ts` | `aiCodeIssueSeverity.ts` | `.ts` | generated schema contracts | code | مقروء بالكامل
- `EngineeringOS-main/lib/api-zod/src/generated/types/aiCodeIssueType.ts` | `aiCodeIssueType.ts` | `.ts` | generated schema contracts | code | مقروء بالكامل
- `EngineeringOS-main/lib/api-zod/src/generated/types/aiCodeReview.ts` | `aiCodeReview.ts` | `.ts` | generated schema contracts | code | مقروء بالكامل
- `EngineeringOS-main/lib/api-zod/src/generated/types/aiCodeReviewVerdict.ts` | `aiCodeReviewVerdict.ts` | `.ts` | generated schema contracts | code | مقروء بالكامل
- `EngineeringOS-main/lib/api-zod/src/generated/types/aiOrchestrateRequest.ts` | `aiOrchestrateRequest.ts` | `.ts` | generated schema contracts | code | مقروء بالكامل
- `EngineeringOS-main/lib/api-zod/src/generated/types/aiOrchestrationDecision.ts` | `aiOrchestrationDecision.ts` | `.ts` | generated schema contracts | code | مقروء بالكامل
- `EngineeringOS-main/lib/api-zod/src/generated/types/aiOrchestrationDecisionAction.ts` | `aiOrchestrationDecisionAction.ts` | `.ts` | generated schema contracts | code | مقروء بالكامل
- `EngineeringOS-main/lib/api-zod/src/generated/types/aiPendingChange.ts` | `aiPendingChange.ts` | `.ts` | generated schema contracts | code | مقروء بالكامل
- `EngineeringOS-main/lib/api-zod/src/generated/types/aiReviewRequest.ts` | `aiReviewRequest.ts` | `.ts` | generated schema contracts | code | مقروء بالكامل
- `EngineeringOS-main/lib/api-zod/src/generated/types/aiReviewRequestFileContents.ts` | `aiReviewRequestFileContents.ts` | `.ts` | generated schema contracts | code | مقروء بالكامل
- `EngineeringOS-main/lib/api-zod/src/generated/types/aiScanAnalysis.ts` | `aiScanAnalysis.ts` | `.ts` | generated schema contracts | code | مقروء بالكامل
- `EngineeringOS-main/lib/api-zod/src/generated/types/aiScanInsight.ts` | `aiScanInsight.ts` | `.ts` | generated schema contracts | code | مقروء بالكامل
- `EngineeringOS-main/lib/api-zod/src/generated/types/aiScanInsightCategory.ts` | `aiScanInsightCategory.ts` | `.ts` | generated schema contracts | code | مقروء بالكامل
- `EngineeringOS-main/lib/api-zod/src/generated/types/aiScanInsightSeverity.ts` | `aiScanInsightSeverity.ts` | `.ts` | generated schema contracts | code | مقروء بالكامل
- `EngineeringOS-main/lib/api-zod/src/generated/types/apiError.ts` | `apiError.ts` | `.ts` | generated schema contracts | code | مقروء بالكامل
- `EngineeringOS-main/lib/api-zod/src/generated/types/archiveUploadInput.ts` | `archiveUploadInput.ts` | `.ts` | generated schema contracts | code | مقروء بالكامل
- `EngineeringOS-main/lib/api-zod/src/generated/types/archiveUploadOutput.ts` | `archiveUploadOutput.ts` | `.ts` | generated schema contracts | code | مقروء بالكامل
- `EngineeringOS-main/lib/api-zod/src/generated/types/createProjectInput.ts` | `createProjectInput.ts` | `.ts` | generated schema contracts | code | مقروء بالكامل
- `EngineeringOS-main/lib/api-zod/src/generated/types/createRuleInput.ts` | `createRuleInput.ts` | `.ts` | generated schema contracts | code | مقروء بالكامل
- `EngineeringOS-main/lib/api-zod/src/generated/types/createTaskInput.ts` | `createTaskInput.ts` | `.ts` | generated schema contracts | code | مقروء بالكامل
- `EngineeringOS-main/lib/api-zod/src/generated/types/createWorkflowInput.ts` | `createWorkflowInput.ts` | `.ts` | generated schema contracts | code | مقروء بالكامل
- `EngineeringOS-main/lib/api-zod/src/generated/types/dashboardOverview.ts` | `dashboardOverview.ts` | `.ts` | generated schema contracts | code | مقروء بالكامل
- `EngineeringOS-main/lib/api-zod/src/generated/types/dashboardOverviewProjectScoresItem.ts` | `dashboardOverviewProjectScoresItem.ts` | `.ts` | generated schema contracts | code | مقروء بالكامل
- `EngineeringOS-main/lib/api-zod/src/generated/types/dashboardOverviewProjectScoresItemTrend.ts` | `dashboardOverviewProjectScoresItemTrend.ts` | `.ts` | generated schema contracts | code | مقروء بالكامل
- `EngineeringOS-main/lib/api-zod/src/generated/types/dashboardOverviewTaskStatusBreakdown.ts` | `dashboardOverviewTaskStatusBreakdown.ts` | `.ts` | generated schema contracts | code | مقروء بالكامل
- `EngineeringOS-main/lib/api-zod/src/generated/types/dashboardOverviewTopRulesItem.ts` | `dashboardOverviewTopRulesItem.ts` | `.ts` | generated schema contracts | code | مقروء بالكامل
- `EngineeringOS-main/lib/api-zod/src/generated/types/deepSeekKeyStatus.ts` | `deepSeekKeyStatus.ts` | `.ts` | generated schema contracts | code | مقروء بالكامل
- `EngineeringOS-main/lib/api-zod/src/generated/types/deleteDeepSeekKey200.ts` | `deleteDeepSeekKey200.ts` | `.ts` | generated schema contracts | code | مقروء بالكامل
- `EngineeringOS-main/lib/api-zod/src/generated/types/deleteGroqKey200.ts` | `deleteGroqKey200.ts` | `.ts` | generated schema contracts | code | مقروء بالكامل
- `EngineeringOS-main/lib/api-zod/src/generated/types/discoveryGraphSummaryData.ts` | `discoveryGraphSummaryData.ts` | `.ts` | generated schema contracts | code | مقروء بالكامل
- `EngineeringOS-main/lib/api-zod/src/generated/types/discoveryGraphSummaryDataEntitiesByType.ts` | `discoveryGraphSummaryDataEntitiesByType.ts` | `.ts` | generated schema contracts | code | مقروء بالكامل
- `EngineeringOS-main/lib/api-zod/src/generated/types/discoveryGraphSummaryDataFilesByLanguage.ts` | `discoveryGraphSummaryDataFilesByLanguage.ts` | `.ts` | generated schema contracts | code | مقروء بالكامل
- `EngineeringOS-main/lib/api-zod/src/generated/types/discoveryOptions.ts` | `discoveryOptions.ts` | `.ts` | generated schema contracts | code | مقروء بالكامل
- `EngineeringOS-main/lib/api-zod/src/generated/types/discoveryReport.ts` | `discoveryReport.ts` | `.ts` | generated schema contracts | code | مقروء بالكامل
- `EngineeringOS-main/lib/api-zod/src/generated/types/discoveryRuleViolationItem.ts` | `discoveryRuleViolationItem.ts` | `.ts` | generated schema contracts | code | مقروء بالكامل
- `EngineeringOS-main/lib/api-zod/src/generated/types/discoverySessionStatus.ts` | `discoverySessionStatus.ts` | `.ts` | generated schema contracts | code | مقروء بالكامل
- `EngineeringOS-main/lib/api-zod/src/generated/types/discoverySessionStatusStatus.ts` | `discoverySessionStatusStatus.ts` | `.ts` | generated schema contracts | code | مقروء بالكامل
- `EngineeringOS-main/lib/api-zod/src/generated/types/discoverySourceCapability.ts` | `discoverySourceCapability.ts` | `.ts` | generated schema contracts | code | مقروء بالكامل
- `EngineeringOS-main/lib/api-zod/src/generated/types/discoverySourceConfig.ts` | `discoverySourceConfig.ts` | `.ts` | generated schema contracts | code | مقروء بالكامل
- `EngineeringOS-main/lib/api-zod/src/generated/types/discoverySourceConfigCredentials.ts` | `discoverySourceConfigCredentials.ts` | `.ts` | generated schema contracts | code | مقروء بالكامل
- `EngineeringOS-main/lib/api-zod/src/generated/types/discoveryStepItem.ts` | `discoveryStepItem.ts` | `.ts` | generated schema contracts | code | مقروء بالكامل
- `EngineeringOS-main/lib/api-zod/src/generated/types/discoveryStepItemStatus.ts` | `discoveryStepItemStatus.ts` | `.ts` | generated schema contracts | code | مقروء بالكامل
- `EngineeringOS-main/lib/api-zod/src/generated/types/entityType.ts` | `entityType.ts` | `.ts` | generated schema contracts | code | مقروء بالكامل
- `EngineeringOS-main/lib/api-zod/src/generated/types/evaluateRuleRequest.ts` | `evaluateRuleRequest.ts` | `.ts` | generated schema contracts | code | مقروء بالكامل
- `EngineeringOS-main/lib/api-zod/src/generated/types/event.ts` | `event.ts` | `.ts` | generated schema contracts | code | مقروء بالكامل
- `EngineeringOS-main/lib/api-zod/src/generated/types/eventPayload.ts` | `eventPayload.ts` | `.ts` | generated schema contracts | code | مقروء بالكامل
- `EngineeringOS-main/lib/api-zod/src/generated/types/eventSeverity.ts` | `eventSeverity.ts` | `.ts` | generated schema contracts | code | مقروء بالكامل
- `EngineeringOS-main/lib/api-zod/src/generated/types/failWorkflowPhaseInput.ts` | `failWorkflowPhaseInput.ts` | `.ts` | generated schema contracts | code | مقروء بالكامل
- `EngineeringOS-main/lib/api-zod/src/generated/types/getGraphEntityImpact404.ts` | `getGraphEntityImpact404.ts` | `.ts` | generated schema contracts | code | مقروء بالكامل
- `EngineeringOS-main/lib/api-zod/src/generated/types/getGraphEntityImpactParams.ts` | `getGraphEntityImpactParams.ts` | `.ts` | generated schema contracts | code | مقروء بالكامل
- `EngineeringOS-main/lib/api-zod/src/generated/types/getGraphEntityNeighbors200.ts` | `getGraphEntityNeighbors200.ts` | `.ts` | generated schema contracts | code | مقروء بالكامل
- `EngineeringOS-main/lib/api-zod/src/generated/types/getGraphEntityNeighbors404.ts` | `getGraphEntityNeighbors404.ts` | `.ts` | generated schema contracts | code | مقروء بالكامل
- `EngineeringOS-main/lib/api-zod/src/generated/types/getGraphEvidence403.ts` | `getGraphEvidence403.ts` | `.ts` | generated schema contracts | code | مقروء بالكامل
- `EngineeringOS-main/lib/api-zod/src/generated/types/getGraphEvidence404.ts` | `getGraphEvidence404.ts` | `.ts` | generated schema contracts | code | مقروء بالكامل
- `EngineeringOS-main/lib/api-zod/src/generated/types/getGraphPathParams.ts` | `getGraphPathParams.ts` | `.ts` | generated schema contracts | code | مقروء بالكامل
- `EngineeringOS-main/lib/api-zod/src/generated/types/getGraphRuntimeSubgraph403.ts` | `getGraphRuntimeSubgraph403.ts` | `.ts` | generated schema contracts | code | مقروء بالكامل
- `EngineeringOS-main/lib/api-zod/src/generated/types/getGraphRuntimeSubgraph404.ts` | `getGraphRuntimeSubgraph404.ts` | `.ts` | generated schema contracts | code | مقروء بالكامل
- `EngineeringOS-main/lib/api-zod/src/generated/types/getGraphSemanticNeighborhood400.ts` | `getGraphSemanticNeighborhood400.ts` | `.ts` | generated schema contracts | code | مقروء بالكامل
- `EngineeringOS-main/lib/api-zod/src/generated/types/getGraphSemanticNeighborhood403.ts` | `getGraphSemanticNeighborhood403.ts` | `.ts` | generated schema contracts | code | مقروء بالكامل
- `EngineeringOS-main/lib/api-zod/src/generated/types/getGraphSemanticNeighborhood404.ts` | `getGraphSemanticNeighborhood404.ts` | `.ts` | generated schema contracts | code | مقروء بالكامل
- `EngineeringOS-main/lib/api-zod/src/generated/types/getGraphSemanticNeighborhoodParams.ts` | `getGraphSemanticNeighborhoodParams.ts` | `.ts` | generated schema contracts | code | مقروء بالكامل
- `EngineeringOS-main/lib/api-zod/src/generated/types/getGraphSubgraph400.ts` | `getGraphSubgraph400.ts` | `.ts` | generated schema contracts | code | مقروء بالكامل
- `EngineeringOS-main/lib/api-zod/src/generated/types/getGraphSubgraph403.ts` | `getGraphSubgraph403.ts` | `.ts` | generated schema contracts | code | مقروء بالكامل
- `EngineeringOS-main/lib/api-zod/src/generated/types/getGraphSubgraph404.ts` | `getGraphSubgraph404.ts` | `.ts` | generated schema contracts | code | مقروء بالكامل
- `EngineeringOS-main/lib/api-zod/src/generated/types/getGraphSubgraphParams.ts` | `getGraphSubgraphParams.ts` | `.ts` | generated schema contracts | code | مقروء بالكامل
- `EngineeringOS-main/lib/api-zod/src/generated/types/getLatestMetricsParams.ts` | `getLatestMetricsParams.ts` | `.ts` | generated schema contracts | code | مقروء بالكامل
- `EngineeringOS-main/lib/api-zod/src/generated/types/gitCommitEntry.ts` | `gitCommitEntry.ts` | `.ts` | generated schema contracts | code | مقروء بالكامل
- `EngineeringOS-main/lib/api-zod/src/generated/types/gitCommitInput.ts` | `gitCommitInput.ts` | `.ts` | generated schema contracts | code | مقروء بالكامل
- `EngineeringOS-main/lib/api-zod/src/generated/types/gitConfig.ts` | `gitConfig.ts` | `.ts` | generated schema contracts | code | مقروء بالكامل
- `EngineeringOS-main/lib/api-zod/src/generated/types/gitHubTokenStatus.ts` | `gitHubTokenStatus.ts` | `.ts` | generated schema contracts | code | مقروء بالكامل
- `EngineeringOS-main/lib/api-zod/src/generated/types/gitLog.ts` | `gitLog.ts` | `.ts` | generated schema contracts | code | مقروء بالكامل
- `EngineeringOS-main/lib/api-zod/src/generated/types/gitOperationResult.ts` | `gitOperationResult.ts` | `.ts` | generated schema contracts | code | مقروء بالكامل
- `EngineeringOS-main/lib/api-zod/src/generated/types/gitPushResult.ts` | `gitPushResult.ts` | `.ts` | generated schema contracts | code | مقروء بالكامل
- `EngineeringOS-main/lib/api-zod/src/generated/types/gitStatus.ts` | `gitStatus.ts` | `.ts` | generated schema contracts | code | مقروء بالكامل
- `EngineeringOS-main/lib/api-zod/src/generated/types/gitStatusFile.ts` | `gitStatusFile.ts` | `.ts` | generated schema contracts | code | مقروء بالكامل
- `EngineeringOS-main/lib/api-zod/src/generated/types/graphCentralityScore.ts` | `graphCentralityScore.ts` | `.ts` | generated schema contracts | code | مقروء بالكامل
- `EngineeringOS-main/lib/api-zod/src/generated/types/graphEdgeType.ts` | `graphEdgeType.ts` | `.ts` | generated schema contracts | code | مقروء بالكامل
- `EngineeringOS-main/lib/api-zod/src/generated/types/graphEntity.ts` | `graphEntity.ts` | `.ts` | generated schema contracts | code | مقروء بالكامل
- `EngineeringOS-main/lib/api-zod/src/generated/types/graphEntityMetadata.ts` | `graphEntityMetadata.ts` | `.ts` | generated schema contracts | code | مقروء بالكامل
- `EngineeringOS-main/lib/api-zod/src/generated/types/graphEvidence.ts` | `graphEvidence.ts` | `.ts` | generated schema contracts | code | مقروء بالكامل
- `EngineeringOS-main/lib/api-zod/src/generated/types/graphEvidenceBundle.ts` | `graphEvidenceBundle.ts` | `.ts` | generated schema contracts | code | مقروء بالكامل
- `EngineeringOS-main/lib/api-zod/src/generated/types/graphEvidenceKind.ts` | `graphEvidenceKind.ts` | `.ts` | generated schema contracts | code | مقروء بالكامل
- `EngineeringOS-main/lib/api-zod/src/generated/types/graphEvidenceResponse.ts` | `graphEvidenceResponse.ts` | `.ts` | generated schema contracts | code | مقروء بالكامل
- `EngineeringOS-main/lib/api-zod/src/generated/types/graphImpactHop.ts` | `graphImpactHop.ts` | `.ts` | generated schema contracts | code | مقروء بالكامل
- `EngineeringOS-main/lib/api-zod/src/generated/types/graphImpactResult.ts` | `graphImpactResult.ts` | `.ts` | generated schema contracts | code | مقروء بالكامل
- `EngineeringOS-main/lib/api-zod/src/generated/types/graphLayerCounts.ts` | `graphLayerCounts.ts` | `.ts` | generated schema contracts | code | مقروء بالكامل
- `EngineeringOS-main/lib/api-zod/src/generated/types/graphPathResult.ts` | `graphPathResult.ts` | `.ts` | generated schema contracts | code | مقروء بالكامل
- `EngineeringOS-main/lib/api-zod/src/generated/types/graphPathStep.ts` | `graphPathStep.ts` | `.ts` | generated schema contracts | code | مقروء بالكامل
- `EngineeringOS-main/lib/api-zod/src/generated/types/graphProvenance.ts` | `graphProvenance.ts` | `.ts` | generated schema contracts | code | مقروء بالكامل
- `EngineeringOS-main/lib/api-zod/src/generated/types/graphRelationship.ts` | `graphRelationship.ts` | `.ts` | generated schema contracts | code | مقروء بالكامل
- `EngineeringOS-main/lib/api-zod/src/generated/types/graphRelationshipMetadata.ts` | `graphRelationshipMetadata.ts` | `.ts` | generated schema contracts | code | مقروء بالكامل
- `EngineeringOS-main/lib/api-zod/src/generated/types/graphRuntimeSubgraph.ts` | `graphRuntimeSubgraph.ts` | `.ts` | generated schema contracts | code | مقروء بالكامل
- `EngineeringOS-main/lib/api-zod/src/generated/types/graphSemanticNeighborhood.ts` | `graphSemanticNeighborhood.ts` | `.ts` | generated schema contracts | code | مقروء بالكامل
- `EngineeringOS-main/lib/api-zod/src/generated/types/graphSubgraph.ts` | `graphSubgraph.ts` | `.ts` | generated schema contracts | code | مقروء بالكامل
- `EngineeringOS-main/lib/api-zod/src/generated/types/graphSubgraphFilters.ts` | `graphSubgraphFilters.ts` | `.ts` | generated schema contracts | code | مقروء بالكامل
- `EngineeringOS-main/lib/api-zod/src/generated/types/graphSubgraphLayered.ts` | `graphSubgraphLayered.ts` | `.ts` | generated schema contracts | code | مقروء بالكامل
- `EngineeringOS-main/lib/api-zod/src/generated/types/graphSummary.ts` | `graphSummary.ts` | `.ts` | generated schema contracts | code | مقروء بالكامل
- `EngineeringOS-main/lib/api-zod/src/generated/types/graphSummaryEntitiesByType.ts` | `graphSummaryEntitiesByType.ts` | `.ts` | generated schema contracts | code | مقروء بالكامل
- `EngineeringOS-main/lib/api-zod/src/generated/types/graphSummaryRelationsByType.ts` | `graphSummaryRelationsByType.ts` | `.ts` | generated schema contracts | code | مقروء بالكامل
- `EngineeringOS-main/lib/api-zod/src/generated/types/groqKeyStatus.ts` | `groqKeyStatus.ts` | `.ts` | generated schema contracts | code | مقروء بالكامل
- `EngineeringOS-main/lib/api-zod/src/generated/types/healthStatus.ts` | `healthStatus.ts` | `.ts` | generated schema contracts | code | مقروء بالكامل
- `EngineeringOS-main/lib/api-zod/src/generated/types/healthStatusStatus.ts` | `healthStatusStatus.ts` | `.ts` | generated schema contracts | code | مقروء بالكامل
- `EngineeringOS-main/lib/api-zod/src/generated/types/importProjectInput.ts` | `importProjectInput.ts` | `.ts` | generated schema contracts | code | مقروء بالكامل
- `EngineeringOS-main/lib/api-zod/src/generated/types/importProjectInputOverrides.ts` | `importProjectInputOverrides.ts` | `.ts` | generated schema contracts | code | مقروء بالكامل
- `EngineeringOS-main/lib/api-zod/src/generated/types/index.ts` | `index.ts` | `.ts` | generated schema contracts | code | مقروء بالكامل
- `EngineeringOS-main/lib/api-zod/src/generated/types/jobQueueStats.ts` | `jobQueueStats.ts` | `.ts` | generated schema contracts | code | مقروء بالكامل
- `EngineeringOS-main/lib/api-zod/src/generated/types/listAiChatSessionsParams.ts` | `listAiChatSessionsParams.ts` | `.ts` | generated schema contracts | code | مقروء بالكامل
- `EngineeringOS-main/lib/api-zod/src/generated/types/listEventsParams.ts` | `listEventsParams.ts` | `.ts` | generated schema contracts | code | مقروء بالكامل
- `EngineeringOS-main/lib/api-zod/src/generated/types/listGraphEntitiesParams.ts` | `listGraphEntitiesParams.ts` | `.ts` | generated schema contracts | code | مقروء بالكامل
- `EngineeringOS-main/lib/api-zod/src/generated/types/listGraphRelationshipsParams.ts` | `listGraphRelationshipsParams.ts` | `.ts` | generated schema contracts | code | مقروء بالكامل
- `EngineeringOS-main/lib/api-zod/src/generated/types/listMetricsParams.ts` | `listMetricsParams.ts` | `.ts` | generated schema contracts | code | مقروء بالكامل
- `EngineeringOS-main/lib/api-zod/src/generated/types/listRulesParams.ts` | `listRulesParams.ts` | `.ts` | generated schema contracts | code | مقروء بالكامل
- `EngineeringOS-main/lib/api-zod/src/generated/types/listTasksParams.ts` | `listTasksParams.ts` | `.ts` | generated schema contracts | code | مقروء بالكامل
- `EngineeringOS-main/lib/api-zod/src/generated/types/listWorkflowsParams.ts` | `listWorkflowsParams.ts` | `.ts` | generated schema contracts | code | مقروء بالكامل
- `EngineeringOS-main/lib/api-zod/src/generated/types/metricRecord.ts` | `metricRecord.ts` | `.ts` | generated schema contracts | code | مقروء بالكامل
- `EngineeringOS-main/lib/api-zod/src/generated/types/metricRecordBuildStatus.ts` | `metricRecordBuildStatus.ts` | `.ts` | generated schema contracts | code | مقروء بالكامل
- `EngineeringOS-main/lib/api-zod/src/generated/types/operationalCounters.ts` | `operationalCounters.ts` | `.ts` | generated schema contracts | code | مقروء بالكامل
- `EngineeringOS-main/lib/api-zod/src/generated/types/plugin.ts` | `plugin.ts` | `.ts` | generated schema contracts | code | مقروء بالكامل
- `EngineeringOS-main/lib/api-zod/src/generated/types/pluginCapabilitiesItem.ts` | `pluginCapabilitiesItem.ts` | `.ts` | generated schema contracts | code | مقروء بالكامل
- `EngineeringOS-main/lib/api-zod/src/generated/types/pluginProjectRequest.ts` | `pluginProjectRequest.ts` | `.ts` | generated schema contracts | code | مقروء بالكامل
- `EngineeringOS-main/lib/api-zod/src/generated/types/project.ts` | `project.ts` | `.ts` | generated schema contracts | code | مقروء بالكامل
- `EngineeringOS-main/lib/api-zod/src/generated/types/projectStatus.ts` | `projectStatus.ts` | `.ts` | generated schema contracts | code | مقروء بالكامل
- `EngineeringOS-main/lib/api-zod/src/generated/types/projectSummary.ts` | `projectSummary.ts` | `.ts` | generated schema contracts | code | مقروء بالكامل
- `EngineeringOS-main/lib/api-zod/src/generated/types/projectSummaryTaskCounts.ts` | `projectSummaryTaskCounts.ts` | `.ts` | generated schema contracts | code | مقروء بالكامل
- `EngineeringOS-main/lib/api-zod/src/generated/types/rule.ts` | `rule.ts` | `.ts` | generated schema contracts | code | مقروء بالكامل
- `EngineeringOS-main/lib/api-zod/src/generated/types/ruleEvaluationResult.ts` | `ruleEvaluationResult.ts` | `.ts` | generated schema contracts | code | مقروء بالكامل
- `EngineeringOS-main/lib/api-zod/src/generated/types/ruleEvaluationResultMatchesItem.ts` | `ruleEvaluationResultMatchesItem.ts` | `.ts` | generated schema contracts | code | مقروء بالكامل
- `EngineeringOS-main/lib/api-zod/src/generated/types/ruleSeverity.ts` | `ruleSeverity.ts` | `.ts` | generated schema contracts | code | مقروء بالكامل
- `EngineeringOS-main/lib/api-zod/src/generated/types/saveDeepSeekKeyInput.ts` | `saveDeepSeekKeyInput.ts` | `.ts` | generated schema contracts | code | مقروء بالكامل
- `EngineeringOS-main/lib/api-zod/src/generated/types/saveGitHubTokenInput.ts` | `saveGitHubTokenInput.ts` | `.ts` | generated schema contracts | code | مقروء بالكامل
- `EngineeringOS-main/lib/api-zod/src/generated/types/saveGroqKeyInput.ts` | `saveGroqKeyInput.ts` | `.ts` | generated schema contracts | code | مقروء بالكامل
- `EngineeringOS-main/lib/api-zod/src/generated/types/scanJob.ts` | `scanJob.ts` | `.ts` | generated schema contracts | code | مقروء بالكامل
- `EngineeringOS-main/lib/api-zod/src/generated/types/scanJobStatus.ts` | `scanJobStatus.ts` | `.ts` | generated schema contracts | code | مقروء بالكامل
- `EngineeringOS-main/lib/api-zod/src/generated/types/scanResult.ts` | `scanResult.ts` | `.ts` | generated schema contracts | code | مقروء بالكامل
- `EngineeringOS-main/lib/api-zod/src/generated/types/sourceType.ts` | `sourceType.ts` | `.ts` | generated schema contracts | code | مقروء بالكامل
- `EngineeringOS-main/lib/api-zod/src/generated/types/startDiscoveryInput.ts` | `startDiscoveryInput.ts` | `.ts` | generated schema contracts | code | مقروء بالكامل
- `EngineeringOS-main/lib/api-zod/src/generated/types/task.ts` | `task.ts` | `.ts` | generated schema contracts | code | مقروء بالكامل
- `EngineeringOS-main/lib/api-zod/src/generated/types/taskLog.ts` | `taskLog.ts` | `.ts` | generated schema contracts | code | مقروء بالكامل
- `EngineeringOS-main/lib/api-zod/src/generated/types/taskLogLevel.ts` | `taskLogLevel.ts` | `.ts` | generated schema contracts | code | مقروء بالكامل
- `EngineeringOS-main/lib/api-zod/src/generated/types/taskLogMetadata.ts` | `taskLogMetadata.ts` | `.ts` | generated schema contracts | code | مقروء بالكامل
- `EngineeringOS-main/lib/api-zod/src/generated/types/taskPriority.ts` | `taskPriority.ts` | `.ts` | generated schema contracts | code | مقروء بالكامل
- `EngineeringOS-main/lib/api-zod/src/generated/types/taskStatus.ts` | `taskStatus.ts` | `.ts` | generated schema contracts | code | مقروء بالكامل
- `EngineeringOS-main/lib/api-zod/src/generated/types/updateGitConfigInput.ts` | `updateGitConfigInput.ts` | `.ts` | generated schema contracts | code | مقروء بالكامل
- `EngineeringOS-main/lib/api-zod/src/generated/types/updateProjectInput.ts` | `updateProjectInput.ts` | `.ts` | generated schema contracts | code | مقروء بالكامل
- `EngineeringOS-main/lib/api-zod/src/generated/types/updateProjectInputStatus.ts` | `updateProjectInputStatus.ts` | `.ts` | generated schema contracts | code | مقروء بالكامل
- `EngineeringOS-main/lib/api-zod/src/generated/types/updateRuleInput.ts` | `updateRuleInput.ts` | `.ts` | generated schema contracts | code | مقروء بالكامل
- `EngineeringOS-main/lib/api-zod/src/generated/types/updateTaskInput.ts` | `updateTaskInput.ts` | `.ts` | generated schema contracts | code | مقروء بالكامل
- `EngineeringOS-main/lib/api-zod/src/generated/types/verificationResult.ts` | `verificationResult.ts` | `.ts` | generated schema contracts | code | مقروء بالكامل
- `EngineeringOS-main/lib/api-zod/src/generated/types/verificationResultStepsItem.ts` | `verificationResultStepsItem.ts` | `.ts` | generated schema contracts | code | مقروء بالكامل
- `EngineeringOS-main/lib/api-zod/src/generated/types/workflow.ts` | `workflow.ts` | `.ts` | generated schema contracts | code | مقروء بالكامل
- `EngineeringOS-main/lib/api-zod/src/generated/types/workflowExecution.ts` | `workflowExecution.ts` | `.ts` | generated schema contracts | code | مقروء بالكامل
- `EngineeringOS-main/lib/api-zod/src/generated/types/workflowPhase.ts` | `workflowPhase.ts` | `.ts` | generated schema contracts | code | مقروء بالكامل
- `EngineeringOS-main/lib/api-zod/src/generated/types/workflowStatus.ts` | `workflowStatus.ts` | `.ts` | generated schema contracts | code | مقروء بالكامل
- `EngineeringOS-main/lib/api-zod/src/index.ts` | `index.ts` | `.ts` | generated schema contracts | code | مقروء بالكامل
- `EngineeringOS-main/lib/api-zod/src/truth-flow-matrix.schema.ts` | `truth-flow-matrix.schema.ts` | `.ts` | generated schema contracts | code | مقروء بالكامل
- `EngineeringOS-main/lib/api-zod/tsconfig.json` | `tsconfig.json` | `.json` | workspace configuration / repo governance | config/text | مقروء بالكامل
- `EngineeringOS-main/lib/db/drizzle.config.ts` | `drizzle.config.ts` | `.ts` | database schema / shared data model | code | مقروء بالكامل
- `EngineeringOS-main/lib/db/package.json` | `package.json` | `.json` | workspace configuration / repo governance | config/text | مقروء بالكامل
- `EngineeringOS-main/lib/db/src/index.ts` | `index.ts` | `.ts` | database schema / shared data model | code | مقروء بالكامل
- `EngineeringOS-main/lib/db/src/schema/ai_chats.ts` | `ai_chats.ts` | `.ts` | database schema / shared data model | code | مقروء بالكامل
- `EngineeringOS-main/lib/db/src/schema/ai_provider_credentials.ts` | `ai_provider_credentials.ts` | `.ts` | database schema / shared data model | code | مقروء بالكامل
- `EngineeringOS-main/lib/db/src/schema/audit_logs.ts` | `audit_logs.ts` | `.ts` | database schema / shared data model | code | مقروء بالكامل
- `EngineeringOS-main/lib/db/src/schema/discovery.ts` | `discovery.ts` | `.ts` | database schema / shared data model | code | مقروء بالكامل
- `EngineeringOS-main/lib/db/src/schema/events.ts` | `events.ts` | `.ts` | database schema / shared data model | code | مقروء بالكامل
- `EngineeringOS-main/lib/db/src/schema/graph.ts` | `graph.ts` | `.ts` | database schema / shared data model | code | مقروء بالكامل
- `EngineeringOS-main/lib/db/src/schema/index.ts` | `index.ts` | `.ts` | database schema / shared data model | code | مقروء بالكامل
- `EngineeringOS-main/lib/db/src/schema/metrics.ts` | `metrics.ts` | `.ts` | database schema / shared data model | code | مقروء بالكامل
- `EngineeringOS-main/lib/db/src/schema/plugins.ts` | `plugins.ts` | `.ts` | database schema / shared data model | code | مقروء بالكامل
- `EngineeringOS-main/lib/db/src/schema/projects.ts` | `projects.ts` | `.ts` | database schema / shared data model | code | مقروء بالكامل
- `EngineeringOS-main/lib/db/src/schema/rate_limits.ts` | `rate_limits.ts` | `.ts` | database schema / shared data model | code | مقروء بالكامل
- `EngineeringOS-main/lib/db/src/schema/rules.ts` | `rules.ts` | `.ts` | database schema / shared data model | code | مقروء بالكامل
- `EngineeringOS-main/lib/db/src/schema/scan_jobs.ts` | `scan_jobs.ts` | `.ts` | database schema / shared data model | code | مقروء بالكامل
- `EngineeringOS-main/lib/db/src/schema/task_logs.ts` | `task_logs.ts` | `.ts` | database schema / shared data model | code | مقروء بالكامل
- `EngineeringOS-main/lib/db/src/schema/tasks.ts` | `tasks.ts` | `.ts` | database schema / shared data model | code | مقروء بالكامل
- `EngineeringOS-main/lib/db/src/schema/uploads.ts` | `uploads.ts` | `.ts` | database schema / shared data model | code | مقروء بالكامل
- `EngineeringOS-main/lib/db/src/schema/workflows.ts` | `workflows.ts` | `.ts` | database schema / shared data model | code | مقروء بالكامل
- `EngineeringOS-main/lib/db/tsconfig.json` | `tsconfig.json` | `.json` | workspace configuration / repo governance | config/text | مقروء بالكامل
- `EngineeringOS-main/lib/knowledge-engine/package.json` | `package.json` | `.json` | workspace configuration / repo governance | config/text | مقروء بالكامل
- `EngineeringOS-main/lib/knowledge-engine/src/__tests__/inference.test.ts` | `inference.test.ts` | `.ts` | graph query and inference engine | code | مقروء بالكامل
- `EngineeringOS-main/lib/knowledge-engine/src/__tests__/queries.test.ts` | `queries.test.ts` | `.ts` | graph query and inference engine | code | مقروء بالكامل
- `EngineeringOS-main/lib/knowledge-engine/src/index.ts` | `index.ts` | `.ts` | graph query and inference engine | code | مقروء بالكامل
- `EngineeringOS-main/lib/knowledge-engine/src/inference.ts` | `inference.ts` | `.ts` | graph query and inference engine | code | مقروء بالكامل
- `EngineeringOS-main/lib/knowledge-engine/src/queries.ts` | `queries.ts` | `.ts` | graph query and inference engine | code | مقروء بالكامل
- `EngineeringOS-main/lib/knowledge-engine/src/types.ts` | `types.ts` | `.ts` | graph query and inference engine | code | مقروء بالكامل
- `EngineeringOS-main/lib/knowledge-engine/tsconfig.json` | `tsconfig.json` | `.json` | workspace configuration / repo governance | config/text | مقروء بالكامل
- `EngineeringOS-main/lib/scanner/package.json` | `package.json` | `.json` | workspace configuration / repo governance | config/text | مقروء بالكامل
- `EngineeringOS-main/lib/scanner/src/__tests__/file-walker.test.ts` | `file-walker.test.ts` | `.ts` | source scanner and graph extraction | code | مقروء بالكامل
- `EngineeringOS-main/lib/scanner/src/__tests__/graph-extractor.test.ts` | `graph-extractor.test.ts` | `.ts` | source scanner and graph extraction | code | مقروء بالكامل
- `EngineeringOS-main/lib/scanner/src/__tests__/metrics-calc.test.ts` | `metrics-calc.test.ts` | `.ts` | source scanner and graph extraction | code | مقروء بالكامل
- `EngineeringOS-main/lib/scanner/src/__tests__/rule-matcher.test.ts` | `rule-matcher.test.ts` | `.ts` | source scanner and graph extraction | code | مقروء بالكامل
- `EngineeringOS-main/lib/scanner/src/file-walker.ts` | `file-walker.ts` | `.ts` | source scanner and graph extraction | code | مقروء بالكامل
- `EngineeringOS-main/lib/scanner/src/graph-extractor.ts` | `graph-extractor.ts` | `.ts` | source scanner and graph extraction | code | مقروء بالكامل
- `EngineeringOS-main/lib/scanner/src/index.ts` | `index.ts` | `.ts` | source scanner and graph extraction | code | مقروء بالكامل
- `EngineeringOS-main/lib/scanner/src/metrics-calc.ts` | `metrics-calc.ts` | `.ts` | source scanner and graph extraction | code | مقروء بالكامل
- `EngineeringOS-main/lib/scanner/src/python-ast-script.py` | `python-ast-script.py` | `.py` | source scanner and graph extraction | code | مقروء بالكامل
- `EngineeringOS-main/lib/scanner/src/python-ast-script.ts` | `python-ast-script.ts` | `.ts` | source scanner and graph extraction | code | مقروء بالكامل
- `EngineeringOS-main/lib/scanner/src/python-extractor.ts` | `python-extractor.ts` | `.ts` | source scanner and graph extraction | code | مقروء بالكامل
- `EngineeringOS-main/lib/scanner/src/rule-matcher.ts` | `rule-matcher.ts` | `.ts` | source scanner and graph extraction | code | مقروء بالكامل
- `EngineeringOS-main/lib/scanner/tsconfig.json` | `tsconfig.json` | `.json` | workspace configuration / repo governance | config/text | مقروء بالكامل
- `EngineeringOS-main/lib/scanner/vitest.config.ts` | `vitest.config.ts` | `.ts` | source scanner and graph extraction | code | مقروء بالكامل

#### `scripts` (8)

- `EngineeringOS-main/scripts/check-codegen-drift.ts` | `check-codegen-drift.ts` | `.ts` | build / validation / operational utility | code | مقروء بالكامل
- `EngineeringOS-main/scripts/package.json` | `package.json` | `.json` | workspace configuration / repo governance | config/text | مقروء بالكامل
- `EngineeringOS-main/scripts/post-merge.sh` | `post-merge.sh` | `.sh` | build / validation / operational utility | code | مقروء بالكامل
- `EngineeringOS-main/scripts/src/hello.ts` | `hello.ts` | `.ts` | build / validation / operational utility | code | مقروء بالكامل
- `EngineeringOS-main/scripts/trigger-scan.mts` | `trigger-scan.mts` | `.mts` | build / validation / operational utility | code | مقروء بالكامل
- `EngineeringOS-main/scripts/tsconfig.json` | `tsconfig.json` | `.json` | workspace configuration / repo governance | config/text | مقروء بالكامل
- `EngineeringOS-main/scripts/validate-truth-flow.ts` | `validate-truth-flow.ts` | `.ts` | build / validation / operational utility | code | مقروء بالكامل
- `EngineeringOS-main/scripts/verify-setup.sh` | `verify-setup.sh` | `.sh` | build / validation / operational utility | code | مقروء بالكامل

#### `.gitattributes` (1)

- `EngineeringOS-main/.gitattributes` | `.gitattributes` | `[noext]` | workspace configuration / repo governance | config/text | مقروء بالكامل

#### `.github` (1)

- `EngineeringOS-main/.github/workflows/ci.yml` | `ci.yml` | `.yml` | other | text/doc/config | مقروء بالكامل

#### `.gitignore` (1)

- `EngineeringOS-main/.gitignore` | `.gitignore` | `[noext]` | workspace configuration / repo governance | config/text | مقروء بالكامل

#### `.npmrc` (1)

- `EngineeringOS-main/.npmrc` | `.npmrc` | `[noext]` | workspace configuration / repo governance | config/text | مقروء بالكامل

#### `.replit` (1)

- `EngineeringOS-main/.replit` | `.replit` | `[noext]` | workspace configuration / repo governance | config/text | مقروء بالكامل

#### `.replitignore` (1)

- `EngineeringOS-main/.replitignore` | `.replitignore` | `[noext]` | workspace configuration / repo governance | config/text | مقروء بالكامل

#### `package.json` (1)

- `EngineeringOS-main/package.json` | `package.json` | `.json` | workspace configuration / repo governance | config/text | مقروء بالكامل

#### `pnpm-lock.yaml` (1)

- `EngineeringOS-main/pnpm-lock.yaml` | `pnpm-lock.yaml` | `.yaml` | workspace configuration / repo governance | config/text | مقروء بالكامل

#### `pnpm-workspace.yaml` (1)

- `EngineeringOS-main/pnpm-workspace.yaml` | `pnpm-workspace.yaml` | `.yaml` | workspace configuration / repo governance | config/text | مقروء بالكامل

#### `replit.md` (1)

- `EngineeringOS-main/replit.md` | `replit.md` | `.md` | workspace configuration / repo governance | config/text | مقروء بالكامل

#### `tsconfig.base.json` (1)

- `EngineeringOS-main/tsconfig.base.json` | `tsconfig.base.json` | `.json` | workspace configuration / repo governance | config/text | مقروء بالكامل

#### `tsconfig.base.json.bak` (1)

- `EngineeringOS-main/tsconfig.base.json.bak` | `tsconfig.base.json.bak` | `.bak` | workspace configuration / repo governance | config/text | مقروء بالكامل

#### `tsconfig.json` (1)

- `EngineeringOS-main/tsconfig.json` | `tsconfig.json` | `.json` | workspace configuration / repo governance | config/text | مقروء بالكامل


## 14.1 تصحيحات لاحقة بعد فحص الكود الفعلي

أثناء المراجعة اللاحقة للكود نفسه، ظهرت ثلاث نقاط مهمة لتصحيح القراءة السابقة:

1. **AI auto-trigger على حالة `verifying` موجود فعليًا**
   - الدليل: `artifacts/api-server/src/routes/tasks.ts` يستدعي `scheduleAiTaskExecution(taskId, req.userId)` عندما يصبح `body.status === "verifying"` وتكون `task.prompt` موجودة.
   - التنفيذ الفعلي موجود أيضًا في `artifacts/api-server/src/routes/ai/tasks.ts` عبر `heavyJobQueue.enqueueWithId(...)` مع event `TaskAutoTriggered`.
   - النتيجة: هذا البند لا ينبغي أن يُصنَّف "لم يبدأ" في القراءة الحالية؛ الأدق أنه **مكتمل جزئيًا/مكتمل وظيفيًا** من زاوية التوصيل، مع بقاء الاعتماد على `heavyJobQueue` غير دائم.

2. **Workflow phase conditions ليست غائبة**
   - الدليل: `artifacts/api-server/src/services/workflow-service.ts` يضم `checkAdvanceCondition()` و`computePhaseAdvancement()`.
   - `routes/workflows.ts` يستخدم `checkAdvanceCondition()` مع `condition-evaluator` الآمن بدل `new Function`.
   - النتيجة: بند "فشل دعم الشروط" غير دقيق؛ الموجود هو **دعم للشروط على خطوة التقدم**، لكن **الانتقال المتشعب/الاختيار بين مسارات متعددة** ما يزال محدودًا لأن `computePhaseAdvancement()` يظل خطيًا.

3. **بعض وثائق الإكمال قديمة مقارنة بالكود**
   - ملفات مثل `docs/completion-plan.md` ونسخ PDF/DOCX المصدّرة داخل `attached_assets/` تعكس لقطات زمنية أقدم.
   - أمثلة على ذلك: أعداد الملفات في بعض الملخصات القديمة (559/595/722) لا تطابق الحزمة الحالية التي فُحصت هنا (825 ملفًا).
   - النتيجة: في أي تعارض بين هذه اللقطات والكود الحالي، **الكود الحالي هو المرجع العملي**، والوثائق تُعامل كسجل تاريخي أو كمخرج من جلسة سابقة.


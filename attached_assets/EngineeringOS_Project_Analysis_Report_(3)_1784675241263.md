# تحليل هندسي شامل لمشروع EngineeringOS

## 1) الملخص التنفيذي
المستودع منصة هندسية متعددة الطبقات على pnpm monorepo: OpenAPI → Zod/React Query → Express API → Drizzle/Postgres → scanner/knowledge-engine → AI orchestrator → Dashboard/Mockup sandbox.
المسح الحالي وجد 822 ملفًا: 472 كود/سكريبت، 137 توثيق، 137 نص/إعدادات، 45 ثنائي، و2 مادة أمنية حساسة في الجذر.
الأرقام البنيوية الحالية: 65 مسار OpenAPI، 83 route runtime، 19 جدول/كيان Drizzle، 15 صفحة Dashboard، 34 ملف اختبار.
الخلاصة العملية: المعمارية جيدة جدًا، لكن توجد فجوة أمنية حرجة (مفتاح SSH خاص في الجذر) مع baseline وثائقي متشعب يحتاج توحيدًا.

## 2) فهرس الملفات التي تمت قراءتها
### 2.1 ملخص العدّ
| البند | القيمة |
|---|---:|
| إجمالي الملفات | 822 |
| ملفات الكود/السكريبت | 472 |
| ملفات التوثيق | 137 |
| ملفات النص/الإعدادات | 137 |
| الملفات الثنائية | 45 |
| المواد الأمنية الحساسة | 2 |
| عدد مسارات OpenAPI | 65 |
| عدد تعريفات route في runtime | 83 |
| عدد جداول Drizzle/pgTable | 19 |
| عدد صفحات Dashboard | 15 |
| عدد ملفات الاختبار | 34 |

### 2.2 توزيع الجذور الأعلى
| الجذر الأعلى | العدد | الوصف |
|---|---:|---|
| `lib` | 261 | Shared libraries |
| `attached_assets` | 246 | Evidence archive / historical attachments |
| `artifacts` | 237 | Runtime apps / UIs |
| `.agents` | 40 | Agent memory and execution notes |
| `docs` | 15 | Canonical docs / governance |
| `scripts` | 8 | Validation and setup scripts |
| `
` | 1 | Root-level file |
| `
.pub` | 1 | Root-level file |
| `.gitattributes` | 1 | Repo metadata / configuration |
| `.github` | 1 | Repo metadata / configuration |
| `.gitignore` | 1 | Repo metadata / configuration |
| `.npmrc` | 1 | Repo metadata / configuration |
| `.replit` | 1 | Repo metadata / configuration |
| `.replitignore` | 1 | Repo metadata / configuration |
| `package.json` | 1 | Root-level file |
| `pnpm-lock.yaml` | 1 | Root-level file |
| `pnpm-workspace.yaml` | 1 | Root-level file |
| `replit.md` | 1 | Root-level file |
| `tsconfig.base.json` | 1 | Root-level file |
| `tsconfig.base.json.bak` | 1 | Root-level file |
| `tsconfig.json` | 1 | Root-level file |

### 2.3 ملاحظة على القراءة
الملفات النصية/الشفرة قُرئت بالكامل برمجيًا. الملفات الثنائية عولجت بحسب نوعها: PDFs/DOCX/XLSX عبر استخراج النص/البيانات الوصفية، الصور عبر المعاينة الانتقائية، وzip عبر المحتوى/الفهرس أو كـ pointers.

## 3) تحليل المشروع
الهدف: تحويل المشروع إلى منصة ذكاء هندسي قادرة على فهم المستودع من الداخل: المسح، العلاقات، graph، المهام، القواعد، الأحداث، المقاييس، ثم التشغيل الذكي.
المستخدمون: مطوّرون، مراجِعون، قادة هندسة، ووكيل AI.
القيمة: تفسير المشروع ذاتيًا بدل لوحة عرض سطحية.

## 4) تحليل المعمارية
```
┌──────────────────────────────────────────┐
│ Dashboard / Mockup Sandbox              │
│ React + Vite + Clerk + React Query      │
└───────────────┬──────────────────────────┘
                │ HTTP / cookie auth
┌───────────────▼──────────────────────────┐
│ API Server (Express 5)                   │
│ auth + ownership + audit + queue + CI    │
└───────┬──────────────┬──────────────┬────┘
        │              │              │
        ▼              ▼              ▼
┌─────────────┐ ┌──────────────┐ ┌────────────────────┐
│ DB / Drizzle│ │ Scanner      │ │ AI Orchestrator    │
│ Postgres    │ │ walk/rules/  │ │ Groq/DeepSeek,     │
│ 19 tables   │ │ graph/metrics│ │ 5 agents, parsing  │
└──────┬──────┘ └──────┬───────┘ └─────────┬──────────┘
       │               │                   │
       └───────────────▼───────────────────┘
               Knowledge Engine
        BFS / path / neighborhood / centrality

Contract-first surfaces:
OpenAPI -> Zod -> React Query client -> API routes

```
تدفق البيانات: OpenAPI → generated client/schema → routes → DB → scanner → knowledge engine → AI orchestrator → dashboard.

## 5) تحليل الطبقات
| الطبقة | الغرض | الملفات/المكونات | الحالة |
|---|---|---|---|
| العقد والمواصفات | مصدر الحقيقة للعقود | `lib/api-spec/openapi.yaml`, `lib/api-zod/src/generated/*`, `lib/api-client-react/src/generated/*` | مكتمل تقريبًا |
| قاعدة البيانات | النمذجة والتخزين | `lib/db/src/schema/*` | مكتمل جيدًا |
| API server | التنفيذ، الحوكمة، التوجيه | `artifacts/api-server/src/*` | مكتمل جزئيًا إلى جيد جدًا |
| Scanner | تحليل الملفات واستخراج graph | `lib/scanner/src/*` | مكتمل |
| Knowledge engine | الاستدلال البياني | `lib/knowledge-engine/src/*` | مكتمل |
| AI orchestrator | الوكلاء والربط مع Groq/DeepSeek | `lib/ai-orchestrator/src/*` | مكتمل جزئيًا إلى جيد جدًا |
| Dashboard | العرض والتفاعل | `artifacts/dashboard/src/*` | مكتمل جزئيًا |
| Mockup sandbox | بيئة تصميم/عرض | `artifacts/mockup-sandbox/*` | تصميم/عرض |
| الحوكمة والعمليات | التحقق، drift، التوثيق، الـ memory | `docs/*`, `.agents/memory/*`, `scripts/*`, `.github/workflows/ci.yml` | مكتمل جيدًا |

## 6) تحليل المكونات
| المكوّن | المسؤولية | الملفات | الحالة | اكتمال |
|---|---|---|---|---:|
| API Server bootstrap | تشغيل Express + security hardening + startup reconciliation | `artifacts/api-server/src/index.ts`, `app.ts`, `config.ts` | مكتمل | 90% |
| Projects/Tasks/Rules/Workflows routes | CRUD وعمليات التنفيذ | `artifacts/api-server/src/routes/*` | مكتمل جزئيًا | 85% |
| Discovery pipeline | اكتشاف المشاريع/المصادر والبناء المرحلي للحالة | `routes/discovery.ts`, `lib/discovery-adapters.ts`, `lib/discovery-runner.ts` | مكتمل جزئيًا | 80% |
| Scan pipeline | المسح الخلفي للمشاريع وتعبئة الجداول | `lib/scan-runner.ts`, `lib/job-queue.ts`, `lib/job-reconciliation.ts` | مكتمل | 90% |
| AI chat/review/task/workflow agents | توليد قرارات وملخصات AI | `lib/ai-orchestrator/src/agents/*` | مكتمل جزئيًا | 85% |
| DB schema | الكيانات والعلاقات | `lib/db/src/schema/*` | مكتمل | 90% |
| Knowledge engine | queries/inference على graph | `lib/knowledge-engine/src/*` | مكتمل | 90% |
| Dashboard app | عرض المشاريع والمهام والAI والgraph | `artifacts/dashboard/src/pages/*` | مكتمل جزئيًا | 80% |
| Mockup sandbox | بيئة UI مستقلة للعرض | `artifacts/mockup-sandbox/*` | تصميم فقط/مكتمل جزئيًا | 75% |
| Governance scripts | drift checks, truth validation, setup | `scripts/*`, `.github/workflows/ci.yml` | مكتمل | 90% |

## 7) تحليل الكود
نقاط الدخول: `artifacts/api-server/src/index.ts`, `artifacts/api-server/src/app.ts`, `artifacts/dashboard/src/App.tsx`, `artifacts/mockup-sandbox/src/main.tsx`, `scripts/check-codegen-drift.ts`, `scripts/validate-truth-flow.ts`.
المصادقة/التفويض: Clerk + `requireAuth` + `requireProjectAccess`/`requireProjectWriteAccess`.
الـ jobs: `heavyJobQueue` مع bounded concurrency، reconciliation عند الإقلاع، وadvisory locks.
الأحداث/التدقيق: `events`, `audit_logs`, `task_logs`, و`recordAudit` في routes متعددة.
الاختبارات: 34 ملف اختبار موزعة على scanner/knowledge-engine/AI/api-server.
CI/CD: `.github/workflows/ci.yml` يفرض codegen drift + typecheck + tests.

## 8) تحليل الوثائق
| المستند | التصنيف | الحالة | ملاحظة |
|---|---|---|---|
| `docs/architecture.md` | Current truth baseline | متاح | آخر تحقق مذكور: 2026-07-20; aligns strongly with current code, but not every count in older reports matches current scan. |
| `docs/completion-plan.md` | Historical phase log | متاح | Explicitly marked historical; useful for sequencing, not as current truth. |
| `docs/fact-record.md` | Historical phase log | متاح | Explicitly marked historical; useful for provenance and file-by-file notes, but dated 2026-07-14. |
| `docs/PR_BACKLOG.md` | Current backlog / roadmap | متاح | Contains closed PR items and the current sequencing logic; useful as a work queue, not as code truth. |
| `docs/EXECUTION_ALIGNMENT_REPORT.md` | Generated historical report | متاح | Useful snapshot, but its metrics are stale relative to this archive. |
| `docs/ENGINEERINGOS_MASTER_EXECUTION_CONSTITUTION.md` | Reference constitution | متاح | Strong high-level reference; overlaps with current code, but should still be cross-checked against source. |
فروق مهمة: `docs/EXECUTION_ALIGNMENT_REPORT.md` يذكر 595 ملفًا و17 جدولًا و49 path و62 route، بينما المسح الحالي وجد 822 ملفًا و19 جدولًا و65 path و83 route.

## 9) تحليل الجودة
| المجال | التقييم | السبب |
|---|---|---|
| المعمارية | جيدة جدًا | الطبقات مفصولة بوضوح: عقد API، runtime، DB، scanner، knowledge-engine، orchestrator، dashboard. |
| التنظيم | جيد جدًا | مونو-ريبوزيتوري pnpm مع حدود package واضحة وتوليد آلي للعقود. |
| التوثيق | جيد مع ملاحظة drift | الوثائق الأساسية موجودة، لكن توجد نسخ تاريخية كثيرة وتفاوتات في الأرقام. |
| الكود | جيد جدًا | وجود اختبارات، طبقة أخطاء، حوكمة auth/ownership، وبنية queue/advisory-locks. |
| سهولة الصيانة | جيدة | المسارات مقسمة بوضوح لكن كثرة النسخ التاريخية والمخرجات المولدة تحتاج حوكمة مستمرة. |
| القابلية للتوسع | جيدة | قابلية جيدة ضمن حدود in-process queue وPostgres؛ لكن التوسع الأفقي يتطلب تشغيلًا أدق للـ queue والـ cache. |
| الأمان | متوسط/جيد مع خطر حرج | تطبيق auth/ownership قوي، لكن توجد مادة سرية حرجة في الأرشيف الجذري يجب إزالتها فورًا. |
| الاختبارات | جيدة | 34 ملف اختبار موزعة على المكتبات، الـ API server، والروابط المولدة. |
| جاهزية الإنتاج | متوسطة إلى جيدة | المنصة قريبة من الإنتاج تقنيًا، لكن لا ينبغي اعتبارها جاهزة بالكامل قبل تنظيف الأسرار وتثبيت baseline الوثائق. |

## 10) تحليل الفجوات
| العنصر | الموجود فعليًا | المتوقع | الفجوة | الخطورة | الأولوية |
|---|---|---|---|---|---|
| مادة سرية عند الجذر | ملف مفتاح SSH خاص موجود في الجذر (`\r`) مع public key مطابق (`\r.pub`) | لا يجب أن توجد أسرار في الأرشيف | حرج | P0 |
| إدارة الأسرار الخارجية | وفق `replit.md` ما يزال `GROQ_API_KEY` مطلوبًا لتفعيل ميزات AI | تفعيل كامل للـ AI دون عوائق إعداد | عالية | P1 |
| تفاوت baseline الوثائق | `docs/EXECUTION_ALIGNMENT_REPORT.md` يذكر 595 ملفًا/17 جدولًا/49 path، بينما المسح الحالي وجد 822 ملفًا/19 جدولًا/65 path | Baseline واحد متزامن مع الشفرة | عالية | P1 |
| تعدد النسخ التاريخية | وجود عدد كبير من تقارير التحليل والنسخ المتكررة في `attached_assets/` | مرجع واحد واضح + أرشيف مضبوط | متوسطة | P2 |
| ملفات snapshot كبيرة | توجد أرشيفات zip/مخرجات build/dists داخل `attached_assets/` | أرشيف أخف وأكثر اختيارًا | متوسطة | P2 |
| مخاطر التشغيل المتوازي | الاعتماد على queue داخل العملية + reconciliation + advisory locks | توسّع أفقي موثق بدقة أكبر | متوسطة | P2 |
| حزمة الوثائق التاريخية | بعض الوثائق العربية/الإنجليزية تعكس مراحل مختلفة وقد تحمل أرقامًا قديمة | وثيقة تشغيلية واحدة أصلية + سجل تاريخي منفصل | متوسطة | P2 |

## 11) إطار متابعة المشروع
بطاقة الحالة: الاسم، الطبقة، الحالة، نسبة الإنجاز، الأولوية، المسؤول، آخر تحديث، المخاطر، الاعتماديات، الملفات المرجعية.
مصفوفة الربط: متطلبات ↔ تصميم ↔ كود ↔ اختبارات ↔ مهام ↔ ملفات.
دورة العمل: مراجعة الوثائق → مراجعة الكود → تحديث الحالة → اكتشاف الفجوات → إنشاء المهام → التنفيذ → التحقق → تحديث التوثيق.
قالب المهمة: العنوان، الوصف، السبب، الملفات، الاعتماديات، معايير القبول، الأولوية، تقدير الجهد.

## 12) خطة الاستكمال
| المدى | الهدف | السبب | المخرجات | الاعتماديات | المخاطر | التحقق | المهارات | الزمن |
|---|---|---|---|---|---|---|---|---|
| قصير المدى | إغلاق أي فجوات أمان/تسريب، وتثبيت baseline المرجع الحالي | إزالة الأسرار، توحيد الوثيقة المرجعية، ومزامنة الأرقام الأساسية | تنظيف الجذر، مراجعة `attached_assets/`, تحديث `docs/architecture.md` أو `docs/EXECUTION_ALIGNMENT_REPORT.md` بحسب الحاجة | لا شيء جوهري؛ فقط وصول للملفات | خطر تسرب أسرار/التباس المرجع | مراجعة inventory + إعادة مسح counts + فحص secrets | هندسة أمن، توثيق، مراجعة repo | أيام قليلة |
| متوسط المدى | تحسين الحوكمة التشغيلية للـ AI/queue/metadata | ضبط secrets flow، تحسين تتبع المهمات والأحداث، وتخفيف الاعتماد على backlog تاريخي | تحسين مراقبة queue/reconciliation، وتنسيق docs/backlog، وتثبيت اختبارات drift | قصير المدى | انحدار وظيفي بسبب تعدد الأسطح | اختبارات route parity + drift checks + smoke checks | Backend، DevOps، QA | أسبوعان إلى عدة أسابيع |
| طويل المدى | توسيع المنصة إلى تشغيل أكثر صلابة ووضوحًا | فصل أوضح بين runtime والـ archival، وتحسين قابلية التوسع والتدقيق | حوكمة للأرشيف، تقليل checked-in artifacts، وتوسيع الاستنتاج/graph/AI workstreams | متوسط المدى | تعقيد تشغيلي إذا استمر تكدس النسخ | أهداف قياس: drift = 0، secrets = 0، queue consistency = stable | معمارية، بنية خلفية، UX | عدة أسابيع إلى أشهر |

## 13) سجل المخاطر
| الخطر | الشدة | الأثر | المعالجة |
|---|---|---|---|
| مفتاح SSH خاص مكشوف في الجذر | حرج | قد يعرّض بيئة/حسابًا خارجيًا للخطر إذا كان صالحًا | إزالة فورية + تدوير المفاتيح إن لزم |
| اعتماد AI على أسرار غير مكتملة | عالي | ميزات AI قد تتوقف أو تعود لسلوك بديل | تثبيت secret provisioning ومراجعة startup checks |
| وثائق تاريخية كثيرة قد توجّه العمل خطأ | متوسط | خطر تنفيذ على baseline قديم | اعتماد وثيقة baseline واحدة وإسناد البقية كسجل تاريخي |
| أرشيفات ومخرجات build داخل المستودع | متوسط | يزيد الضوضاء ويصعّب المراجعة | فصل الأرشيفات غير الضرورية عن المصدر |
| تشغيل queue داخل العملية | متوسط | ضغط تشغيل/تعقيد أعلى عند التوسع | تعزيز الاختبارات والتوثيق وربما خارطة نقل مستقبلية |

## 14) قائمة الافتراضات غير المؤكدة
- لم أُشغّل الاختبارات أو البناء داخل هذه الجلسة.
- الصور الثنائية جرى التعامل معها جزئيًا عبر المعاينة/البيانات الوصفية.
- بعض وثائق `attached_assets/` تاريخية أو مكررة.
- لا توجد أدلة كافية في الملفات لتأكيد توافر جميع الأسرار الخارجية في بيئة التشغيل الحالية.

## 15) ملحق: جميع الملفات التي تم تحليلها
مفتاح الأسطر: `المسار | الاسم | النوع | الغرض المتوقع | المحتوى/القراءة`.
### `
` (1 ملفًا)

 | 
 | secret/credential | SSH key material at repository root | Partially (content redacted in report)

### `
.pub` (1 ملفًا)

.pub | 
.pub | secret/credential | SSH key material at repository root | Partially (content redacted in report)

### `.agents` (40 ملفًا)
.agents/agent_assets_metadata.toml | agent_assets_metadata.toml | config/text | Workspace config or root metadata | Read fully
.agents/memory/MEMORY.md | MEMORY.md | documentation | Execution memory / prior decisions | Read fully
.agents/memory/ai-orchestrator-gap-closure.md | ai-orchestrator-gap-closure.md | documentation | Execution memory / prior decisions | Read fully
.agents/memory/ai-orchestrator-hardening.md | ai-orchestrator-hardening.md | documentation | Execution memory / prior decisions | Read fully
.agents/memory/ai-orchestrator-layer.md | ai-orchestrator-layer.md | documentation | Execution memory / prior decisions | Read fully
.agents/memory/ai-tool-calling.md | ai-tool-calling.md | documentation | Execution memory / prior decisions | Read fully
.agents/memory/audit-fixes.md | audit-fixes.md | documentation | Execution memory / prior decisions | Read fully
.agents/memory/clerk-401-race-cookie-vs-bearer.md | clerk-401-race-cookie-vs-bearer.md | documentation | Execution memory / prior decisions | Read fully
.agents/memory/clerk-auth-testing.md | clerk-auth-testing.md | documentation | Execution memory / prior decisions | Read fully
.agents/memory/completion-plan-stale-backlog.md | completion-plan-stale-backlog.md | documentation | Execution memory / prior decisions | Read fully
.agents/memory/context-cache-invalidation-rule.md | context-cache-invalidation-rule.md | documentation | Execution memory / prior decisions | Read fully
.agents/memory/dashboard-scoping-pr01.md | dashboard-scoping-pr01.md | documentation | Execution memory / prior decisions | Read fully
.agents/memory/discovery-adapter-registry.md | discovery-adapter-registry.md | documentation | Execution memory / prior decisions | Read fully
.agents/memory/discovery-feature.md | discovery-feature.md | documentation | Execution memory / prior decisions | Read fully
.agents/memory/discovery-multi-source.md | discovery-multi-source.md | documentation | Execution memory / prior decisions | Read fully
.agents/memory/drizzle-error-wrapping.md | drizzle-error-wrapping.md | documentation | Execution memory / prior decisions | Read fully
.agents/memory/engineeringos-completion-plan.md | engineeringos-completion-plan.md | documentation | Execution memory / prior decisions | Read fully
.agents/memory/fk-atomic-claim-ordering.md | fk-atomic-claim-ordering.md | documentation | Execution memory / prior decisions | Read fully
.agents/memory/forensic-audit-batch.md | forensic-audit-batch.md | documentation | Execution memory / prior decisions | Read fully
.agents/memory/forensic-audit-pr01-06.md | forensic-audit-pr01-06.md | documentation | Execution memory / prior decisions | Read fully
.agents/memory/gap-analysis-fixes-batch1.md | gap-analysis-fixes-batch1.md | documentation | Execution memory / prior decisions | Read fully
.agents/memory/gap-analysis-fixes-batch2.md | gap-analysis-fixes-batch2.md | documentation | Execution memory / prior decisions | Read fully
.agents/memory/git-ai-orchestrator-fixes.md | git-ai-orchestrator-fixes.md | documentation | Execution memory / prior decisions | Read fully
.agents/memory/imported-project-clerk-secrets.md | imported-project-clerk-secrets.md | documentation | Execution memory / prior decisions | Read fully
.agents/memory/imported-project-workflow-failures.md | imported-project-workflow-failures.md | documentation | Execution memory / prior decisions | Read fully
.agents/memory/knowledge-engine-bfs-depth.md | knowledge-engine-bfs-depth.md | documentation | Execution memory / prior decisions | Read fully
.agents/memory/knowledge-engine.md | knowledge-engine.md | documentation | Execution memory / prior decisions | Read fully
.agents/memory/orval-openapi-codegen.md | orval-openapi-codegen.md | documentation | Execution memory / prior decisions | Read fully
.agents/memory/pr-c-ai-autotrigger.md | pr-c-ai-autotrigger.md | documentation | Execution memory / prior decisions | Read fully
.agents/memory/pr-d-workflow-conditions.md | pr-d-workflow-conditions.md | documentation | Execution memory / prior decisions | Read fully
.agents/memory/pr-d1-job-queue-durability.md | pr-d1-job-queue-durability.md | documentation | Execution memory / prior decisions | Read fully
.agents/memory/pr-h-i-completion.md | pr-h-i-completion.md | documentation | Execution memory / prior decisions | Read fully
.agents/memory/pr01-job-durability.md | pr01-job-durability.md | documentation | Execution memory / prior decisions | Read fully
.agents/memory/pr02-provenance-layer.md | pr02-provenance-layer.md | documentation | Execution memory / prior decisions | Read fully
.agents/memory/pr04-discovery-hardening.md | pr04-discovery-hardening.md | documentation | Execution memory / prior decisions | Read fully
.agents/memory/project-bootstrap.md | project-bootstrap.md | documentation | Execution memory / prior decisions | Read fully
.agents/memory/project-ownership-scoping.md | project-ownership-scoping.md | documentation | Execution memory / prior decisions | Read fully
.agents/memory/scanner-ast-extraction.md | scanner-ast-extraction.md | documentation | Execution memory / prior decisions | Read fully
.agents/memory/testing-drift-checks.md | testing-drift-checks.md | documentation | Execution memory / prior decisions | Read fully
.agents/memory/trace-analysis.md | trace-analysis.md | documentation | Execution memory / prior decisions | Read fully

### `.gitattributes` (1 ملفًا)
.gitattributes | .gitattributes | config/text | Workspace config or root metadata | Read fully

### `.github` (1 ملفًا)
.github/workflows/ci.yml | ci.yml | config/text | Workspace config or root metadata | Read fully

### `.gitignore` (1 ملفًا)
.gitignore | .gitignore | config/text | Workspace config or root metadata | Read fully

### `.npmrc` (1 ملفًا)
.npmrc | .npmrc | config/text | Workspace config or root metadata | Read fully

### `.replit` (1 ملفًا)
.replit | .replit | config/text | Workspace config or root metadata | Read fully

### `.replitignore` (1 ملفًا)
.replitignore | .replitignore | config/text | Workspace config or root metadata | Read fully

### `artifacts` (237 ملفًا)
artifacts/api-server/.replit-artifact/artifact.toml | artifact.toml | config/text | Workspace config or root metadata | Read fully
artifacts/api-server/build.mjs | build.mjs | code | Workspace config or root metadata | Read fully
artifacts/api-server/package.json | package.json | config/text | Workspace config or root metadata | Read fully
artifacts/api-server/src/app.ts | app.ts | code | API server entry / bootstrap | Read fully
artifacts/api-server/src/config.ts | config.ts | code | API server entry / bootstrap | Read fully
artifacts/api-server/src/index.ts | index.ts | code | API server entry / bootstrap | Read fully
artifacts/api-server/src/lib/.gitkeep | .gitkeep | config/text | API server helper / runtime service | Read fully
artifacts/api-server/src/lib/advisory-lock.ts | advisory-lock.ts | code | API server helper / runtime service | Read fully
artifacts/api-server/src/lib/ai-route-helpers.ts | ai-route-helpers.ts | code | API server helper / runtime service | Read fully
artifacts/api-server/src/lib/audit.ts | audit.ts | code | API server helper / runtime service | Read fully
artifacts/api-server/src/lib/condition-evaluator.ts | condition-evaluator.ts | code | API server helper / runtime service | Read fully
artifacts/api-server/src/lib/credentials-crypto.ts | credentials-crypto.ts | code | API server helper / runtime service | Read fully
artifacts/api-server/src/lib/db-rate-limiter.ts | db-rate-limiter.ts | code | API server helper / runtime service | Read fully
artifacts/api-server/src/lib/discovery-adapters.test.ts | discovery-adapters.test.ts | code | API server helper / runtime service | Read fully
artifacts/api-server/src/lib/discovery-adapters.ts | discovery-adapters.ts | code | API server helper / runtime service | Read fully
artifacts/api-server/src/lib/discovery-runner.ts | discovery-runner.ts | code | API server helper / runtime service | Read fully
artifacts/api-server/src/lib/graph-provenance.ts | graph-provenance.ts | code | API server helper / runtime service | Read fully
artifacts/api-server/src/lib/job-queue.test.ts | job-queue.test.ts | code | API server helper / runtime service | Read fully
artifacts/api-server/src/lib/job-queue.ts | job-queue.ts | code | API server helper / runtime service | Read fully
artifacts/api-server/src/lib/job-reconciliation.test.ts | job-reconciliation.test.ts | code | API server helper / runtime service | Read fully
artifacts/api-server/src/lib/job-reconciliation.ts | job-reconciliation.ts | code | API server helper / runtime service | Read fully
artifacts/api-server/src/lib/logger.ts | logger.ts | code | API server helper / runtime service | Read fully
artifacts/api-server/src/lib/operational-counters.ts | operational-counters.ts | code | API server helper / runtime service | Read fully
artifacts/api-server/src/lib/path-validation.test.ts | path-validation.test.ts | code | API server helper / runtime service | Read fully
artifacts/api-server/src/lib/path-validation.ts | path-validation.ts | code | API server helper / runtime service | Read fully
artifacts/api-server/src/lib/plugin-runtime.test.ts | plugin-runtime.test.ts | code | API server helper / runtime service | Read fully
artifacts/api-server/src/lib/plugin-runtime.ts | plugin-runtime.ts | code | API server helper / runtime service | Read fully
artifacts/api-server/src/lib/project-error.test.ts | project-error.test.ts | code | API server helper / runtime service | Read fully
artifacts/api-server/src/lib/rootpath-validator.ts | rootpath-validator.ts | code | API server helper / runtime service | Read fully
artifacts/api-server/src/lib/scan-runner.ts | scan-runner.ts | code | API server helper / runtime service | Read fully
artifacts/api-server/src/lib/startup-migrations.ts | startup-migrations.ts | code | API server helper / runtime service | Read fully
artifacts/api-server/src/lib/upload-store.test.ts | upload-store.test.ts | code | API server helper / runtime service | Read fully
artifacts/api-server/src/lib/upload-store.ts | upload-store.ts | code | API server helper / runtime service | Read fully
artifacts/api-server/src/middlewares/.gitkeep | .gitkeep | config/text | Express middleware | Read fully
artifacts/api-server/src/middlewares/clerkProxyMiddleware.ts | clerkProxyMiddleware.ts | code | Express middleware | Read fully
artifacts/api-server/src/middlewares/requireAuth.test.ts | requireAuth.test.ts | code | Express middleware | Read fully
artifacts/api-server/src/middlewares/requireAuth.ts | requireAuth.ts | code | Express middleware | Read fully
artifacts/api-server/src/middlewares/requireProjectAccess.ts | requireProjectAccess.ts | code | Express middleware | Read fully
artifacts/api-server/src/routes/ai-route-parity.test.ts | ai-route-parity.test.ts | code | HTTP route handler | Read fully
artifacts/api-server/src/routes/ai.test.ts | ai.test.ts | code | HTTP route handler | Read fully
artifacts/api-server/src/routes/ai.ts | ai.ts | code | HTTP route handler | Read fully
artifacts/api-server/src/routes/ai/analysis.ts | analysis.ts | code | HTTP route handler | Read fully
artifacts/api-server/src/routes/ai/chat.ts | chat.ts | code | HTTP route handler | Read fully
artifacts/api-server/src/routes/ai/index.ts | index.ts | code | HTTP route handler | Read fully
artifacts/api-server/src/routes/ai/providers.ts | providers.ts | code | HTTP route handler | Read fully
artifacts/api-server/src/routes/ai/tasks.ts | tasks.ts | code | HTTP route handler | Read fully
artifacts/api-server/src/routes/ai/workflows.ts | workflows.ts | code | HTTP route handler | Read fully
artifacts/api-server/src/routes/dashboard.test.ts | dashboard.test.ts | code | HTTP route handler | Read fully
artifacts/api-server/src/routes/dashboard.ts | dashboard.ts | code | HTTP route handler | Read fully
artifacts/api-server/src/routes/discovery.test.ts | discovery.test.ts | code | HTTP route handler | Read fully
artifacts/api-server/src/routes/discovery.ts | discovery.ts | code | HTTP route handler | Read fully
artifacts/api-server/src/routes/events.test.ts | events.test.ts | code | HTTP route handler | Read fully
artifacts/api-server/src/routes/events.ts | events.ts | code | HTTP route handler | Read fully
artifacts/api-server/src/routes/git.ts | git.ts | code | HTTP route handler | Read fully
artifacts/api-server/src/routes/graph.test.ts | graph.test.ts | code | HTTP route handler | Read fully
artifacts/api-server/src/routes/graph.ts | graph.ts | code | HTTP route handler | Read fully
artifacts/api-server/src/routes/health.test.ts | health.test.ts | code | HTTP route handler | Read fully
artifacts/api-server/src/routes/health.ts | health.ts | code | HTTP route handler | Read fully
artifacts/api-server/src/routes/index.ts | index.ts | code | HTTP route handler | Read fully
artifacts/api-server/src/routes/metrics.test.ts | metrics.test.ts | code | HTTP route handler | Read fully
artifacts/api-server/src/routes/metrics.ts | metrics.ts | code | HTTP route handler | Read fully
artifacts/api-server/src/routes/plugins.test.ts | plugins.test.ts | code | HTTP route handler | Read fully
artifacts/api-server/src/routes/plugins.ts | plugins.ts | code | HTTP route handler | Read fully
artifacts/api-server/src/routes/projects.test.ts | projects.test.ts | code | HTTP route handler | Read fully
artifacts/api-server/src/routes/projects.ts | projects.ts | code | HTTP route handler | Read fully
artifacts/api-server/src/routes/rules.test.ts | rules.test.ts | code | HTTP route handler | Read fully
artifacts/api-server/src/routes/rules.ts | rules.ts | code | HTTP route handler | Read fully
artifacts/api-server/src/routes/tasks.test.ts | tasks.test.ts | code | HTTP route handler | Read fully
artifacts/api-server/src/routes/tasks.ts | tasks.ts | code | HTTP route handler | Read fully
artifacts/api-server/src/routes/upload.ts | upload.ts | code | HTTP route handler | Read fully
artifacts/api-server/src/routes/workflows.test.ts | workflows.test.ts | code | HTTP route handler | Read fully
artifacts/api-server/src/routes/workflows.ts | workflows.ts | code | HTTP route handler | Read fully
artifacts/api-server/src/scripts/seed-provenance.ts | seed-provenance.ts | code | API server entry / bootstrap | Read fully
artifacts/api-server/src/services/task-service.ts | task-service.ts | code | API server entry / bootstrap | Read fully
artifacts/api-server/src/services/workflow-service.ts | workflow-service.ts | code | API server entry / bootstrap | Read fully
artifacts/api-server/src/types/express.d.ts | express.d.ts | code | API server entry / bootstrap | Read fully
artifacts/api-server/tsconfig.json | tsconfig.json | config/text | Workspace config or root metadata | Read fully
artifacts/api-server/vitest.config.ts | vitest.config.ts | code | Workspace config or root metadata | Read fully
artifacts/dashboard/.replit-artifact/artifact.toml | artifact.toml | config/text | Workspace config or root metadata | Read fully
artifacts/dashboard/components.json | components.json | config/text | Workspace config or root metadata | Read fully
artifacts/dashboard/index.html | index.html | config/text | Workspace config or root metadata | Read fully
artifacts/dashboard/package.json | package.json | config/text | Workspace config or root metadata | Read fully
artifacts/dashboard/public/favicon.svg | favicon.svg | binary asset | Dashboard static asset | Text read
artifacts/dashboard/public/logo.svg | logo.svg | binary asset | Dashboard static asset | Text read
artifacts/dashboard/public/robots.txt | robots.txt | config/text | Dashboard static asset | Read fully
artifacts/dashboard/src/App.tsx | App.tsx | code | Workspace config or root metadata | Read fully
artifacts/dashboard/src/components/GitPanel.tsx | GitPanel.tsx | code | Dashboard component | Read fully
artifacts/dashboard/src/components/layout/Shell.tsx | Shell.tsx | code | Dashboard component | Read fully
artifacts/dashboard/src/components/layout/Sidebar.tsx | Sidebar.tsx | code | Dashboard component | Read fully
artifacts/dashboard/src/components/ui/accordion.tsx | accordion.tsx | code | Dashboard component | Read fully
artifacts/dashboard/src/components/ui/alert-dialog.tsx | alert-dialog.tsx | code | Dashboard component | Read fully
artifacts/dashboard/src/components/ui/alert.tsx | alert.tsx | code | Dashboard component | Read fully
artifacts/dashboard/src/components/ui/aspect-ratio.tsx | aspect-ratio.tsx | code | Dashboard component | Read fully
artifacts/dashboard/src/components/ui/avatar.tsx | avatar.tsx | code | Dashboard component | Read fully
artifacts/dashboard/src/components/ui/badge.tsx | badge.tsx | code | Dashboard component | Read fully
artifacts/dashboard/src/components/ui/breadcrumb.tsx | breadcrumb.tsx | code | Dashboard component | Read fully
artifacts/dashboard/src/components/ui/button-group.tsx | button-group.tsx | code | Dashboard component | Read fully
artifacts/dashboard/src/components/ui/button.tsx | button.tsx | code | Dashboard component | Read fully
artifacts/dashboard/src/components/ui/calendar.tsx | calendar.tsx | code | Dashboard component | Read fully
artifacts/dashboard/src/components/ui/card.tsx | card.tsx | code | Dashboard component | Read fully
artifacts/dashboard/src/components/ui/carousel.tsx | carousel.tsx | code | Dashboard component | Read fully
artifacts/dashboard/src/components/ui/chart.tsx | chart.tsx | code | Dashboard component | Read fully
artifacts/dashboard/src/components/ui/checkbox.tsx | checkbox.tsx | code | Dashboard component | Read fully
artifacts/dashboard/src/components/ui/collapsible.tsx | collapsible.tsx | code | Dashboard component | Read fully
artifacts/dashboard/src/components/ui/command.tsx | command.tsx | code | Dashboard component | Read fully
artifacts/dashboard/src/components/ui/context-menu.tsx | context-menu.tsx | code | Dashboard component | Read fully
artifacts/dashboard/src/components/ui/dialog.tsx | dialog.tsx | code | Dashboard component | Read fully
artifacts/dashboard/src/components/ui/drawer.tsx | drawer.tsx | code | Dashboard component | Read fully
artifacts/dashboard/src/components/ui/dropdown-menu.tsx | dropdown-menu.tsx | code | Dashboard component | Read fully
artifacts/dashboard/src/components/ui/empty.tsx | empty.tsx | code | Dashboard component | Read fully
artifacts/dashboard/src/components/ui/field.tsx | field.tsx | code | Dashboard component | Read fully
artifacts/dashboard/src/components/ui/form.tsx | form.tsx | code | Dashboard component | Read fully
artifacts/dashboard/src/components/ui/hover-card.tsx | hover-card.tsx | code | Dashboard component | Read fully
artifacts/dashboard/src/components/ui/input-group.tsx | input-group.tsx | code | Dashboard component | Read fully
artifacts/dashboard/src/components/ui/input-otp.tsx | input-otp.tsx | code | Dashboard component | Read fully
artifacts/dashboard/src/components/ui/input.tsx | input.tsx | code | Dashboard component | Read fully
artifacts/dashboard/src/components/ui/item.tsx | item.tsx | code | Dashboard component | Read fully
artifacts/dashboard/src/components/ui/kbd.tsx | kbd.tsx | code | Dashboard component | Read fully
artifacts/dashboard/src/components/ui/label.tsx | label.tsx | code | Dashboard component | Read fully
artifacts/dashboard/src/components/ui/menubar.tsx | menubar.tsx | code | Dashboard component | Read fully
artifacts/dashboard/src/components/ui/navigation-menu.tsx | navigation-menu.tsx | code | Dashboard component | Read fully
artifacts/dashboard/src/components/ui/pagination.tsx | pagination.tsx | code | Dashboard component | Read fully
artifacts/dashboard/src/components/ui/popover.tsx | popover.tsx | code | Dashboard component | Read fully
artifacts/dashboard/src/components/ui/progress.tsx | progress.tsx | code | Dashboard component | Read fully
artifacts/dashboard/src/components/ui/radio-group.tsx | radio-group.tsx | code | Dashboard component | Read fully
artifacts/dashboard/src/components/ui/resizable.tsx | resizable.tsx | code | Dashboard component | Read fully
artifacts/dashboard/src/components/ui/scroll-area.tsx | scroll-area.tsx | code | Dashboard component | Read fully
artifacts/dashboard/src/components/ui/select.tsx | select.tsx | code | Dashboard component | Read fully
artifacts/dashboard/src/components/ui/separator.tsx | separator.tsx | code | Dashboard component | Read fully
artifacts/dashboard/src/components/ui/sheet.tsx | sheet.tsx | code | Dashboard component | Read fully
artifacts/dashboard/src/components/ui/sidebar.tsx | sidebar.tsx | code | Dashboard component | Read fully
artifacts/dashboard/src/components/ui/skeleton.tsx | skeleton.tsx | code | Dashboard component | Read fully
artifacts/dashboard/src/components/ui/slider.tsx | slider.tsx | code | Dashboard component | Read fully
artifacts/dashboard/src/components/ui/sonner.tsx | sonner.tsx | code | Dashboard component | Read fully
artifacts/dashboard/src/components/ui/spinner.tsx | spinner.tsx | code | Dashboard component | Read fully
artifacts/dashboard/src/components/ui/switch.tsx | switch.tsx | code | Dashboard component | Read fully
artifacts/dashboard/src/components/ui/table.tsx | table.tsx | code | Dashboard component | Read fully
artifacts/dashboard/src/components/ui/tabs.tsx | tabs.tsx | code | Dashboard component | Read fully
artifacts/dashboard/src/components/ui/textarea.tsx | textarea.tsx | code | Dashboard component | Read fully
artifacts/dashboard/src/components/ui/toast.tsx | toast.tsx | code | Dashboard component | Read fully
artifacts/dashboard/src/components/ui/toaster.tsx | toaster.tsx | code | Dashboard component | Read fully
artifacts/dashboard/src/components/ui/toggle-group.tsx | toggle-group.tsx | code | Dashboard component | Read fully
artifacts/dashboard/src/components/ui/toggle.tsx | toggle.tsx | code | Dashboard component | Read fully
artifacts/dashboard/src/components/ui/tooltip.tsx | tooltip.tsx | code | Dashboard component | Read fully
artifacts/dashboard/src/hooks/use-mobile.tsx | use-mobile.tsx | code | Workspace config or root metadata | Read fully
artifacts/dashboard/src/hooks/use-toast.ts | use-toast.ts | code | Workspace config or root metadata | Read fully
artifacts/dashboard/src/index.css | index.css | config/text | Workspace config or root metadata | Read fully
artifacts/dashboard/src/lib/api-fetch.ts | api-fetch.ts | code | Workspace config or root metadata | Read fully
artifacts/dashboard/src/lib/clerk.ts | clerk.ts | code | Workspace config or root metadata | Read fully
artifacts/dashboard/src/lib/utils.ts | utils.ts | code | Workspace config or root metadata | Read fully
artifacts/dashboard/src/main.tsx | main.tsx | code | Workspace config or root metadata | Read fully
artifacts/dashboard/src/pages/AiChat.tsx | AiChat.tsx | code | Dashboard page | Read fully
artifacts/dashboard/src/pages/Dashboard.tsx | Dashboard.tsx | code | Dashboard page | Read fully
artifacts/dashboard/src/pages/DiscoverProjectWizard.tsx | DiscoverProjectWizard.tsx | code | Dashboard page | Read fully
artifacts/dashboard/src/pages/Events.tsx | Events.tsx | code | Dashboard page | Read fully
artifacts/dashboard/src/pages/Graph.tsx | Graph.tsx | code | Dashboard page | Read fully
artifacts/dashboard/src/pages/Landing.tsx | Landing.tsx | code | Dashboard page | Read fully
artifacts/dashboard/src/pages/Metrics.tsx | Metrics.tsx | code | Dashboard page | Read fully
artifacts/dashboard/src/pages/ProjectDetail.tsx | ProjectDetail.tsx | code | Dashboard page | Read fully
artifacts/dashboard/src/pages/Projects.tsx | Projects.tsx | code | Dashboard page | Read fully
artifacts/dashboard/src/pages/Rules.tsx | Rules.tsx | code | Dashboard page | Read fully
artifacts/dashboard/src/pages/SignIn.tsx | SignIn.tsx | code | Dashboard page | Read fully
artifacts/dashboard/src/pages/SignUp.tsx | SignUp.tsx | code | Dashboard page | Read fully
artifacts/dashboard/src/pages/Tasks.tsx | Tasks.tsx | code | Dashboard page | Read fully
artifacts/dashboard/src/pages/Workflows.tsx | Workflows.tsx | code | Dashboard page | Read fully
artifacts/dashboard/src/pages/not-found.tsx | not-found.tsx | code | Dashboard page | Read fully
artifacts/dashboard/tsconfig.json | tsconfig.json | config/text | Workspace config or root metadata | Read fully
artifacts/dashboard/vite.config.ts | vite.config.ts | code | Workspace config or root metadata | Read fully
artifacts/mockup-sandbox/.replit-artifact/artifact.toml | artifact.toml | config/text | Mockup sandbox config/build file | Read fully
artifacts/mockup-sandbox/components.json | components.json | config/text | Mockup sandbox config/build file | Read fully
artifacts/mockup-sandbox/index.html | index.html | config/text | Mockup sandbox config/build file | Read fully
artifacts/mockup-sandbox/mockupPreviewPlugin.ts | mockupPreviewPlugin.ts | code | Mockup sandbox config/build file | Read fully
artifacts/mockup-sandbox/package.json | package.json | config/text | Mockup sandbox config/build file | Read fully
artifacts/mockup-sandbox/src/.generated/mockup-components.ts | mockup-components.ts | code | Mockup sandbox app code | Read fully
artifacts/mockup-sandbox/src/App.tsx | App.tsx | code | Mockup sandbox app code | Read fully
artifacts/mockup-sandbox/src/components/ui/accordion.tsx | accordion.tsx | code | Mockup sandbox UI component | Read fully
artifacts/mockup-sandbox/src/components/ui/alert-dialog.tsx | alert-dialog.tsx | code | Mockup sandbox UI component | Read fully
artifacts/mockup-sandbox/src/components/ui/alert.tsx | alert.tsx | code | Mockup sandbox UI component | Read fully
artifacts/mockup-sandbox/src/components/ui/aspect-ratio.tsx | aspect-ratio.tsx | code | Mockup sandbox UI component | Read fully
artifacts/mockup-sandbox/src/components/ui/avatar.tsx | avatar.tsx | code | Mockup sandbox UI component | Read fully
artifacts/mockup-sandbox/src/components/ui/badge.tsx | badge.tsx | code | Mockup sandbox UI component | Read fully
artifacts/mockup-sandbox/src/components/ui/breadcrumb.tsx | breadcrumb.tsx | code | Mockup sandbox UI component | Read fully
artifacts/mockup-sandbox/src/components/ui/button-group.tsx | button-group.tsx | code | Mockup sandbox UI component | Read fully
artifacts/mockup-sandbox/src/components/ui/button.tsx | button.tsx | code | Mockup sandbox UI component | Read fully
artifacts/mockup-sandbox/src/components/ui/calendar.tsx | calendar.tsx | code | Mockup sandbox UI component | Read fully
artifacts/mockup-sandbox/src/components/ui/card.tsx | card.tsx | code | Mockup sandbox UI component | Read fully
artifacts/mockup-sandbox/src/components/ui/carousel.tsx | carousel.tsx | code | Mockup sandbox UI component | Read fully
artifacts/mockup-sandbox/src/components/ui/chart.tsx | chart.tsx | code | Mockup sandbox UI component | Read fully
artifacts/mockup-sandbox/src/components/ui/checkbox.tsx | checkbox.tsx | code | Mockup sandbox UI component | Read fully
artifacts/mockup-sandbox/src/components/ui/collapsible.tsx | collapsible.tsx | code | Mockup sandbox UI component | Read fully
artifacts/mockup-sandbox/src/components/ui/command.tsx | command.tsx | code | Mockup sandbox UI component | Read fully
artifacts/mockup-sandbox/src/components/ui/context-menu.tsx | context-menu.tsx | code | Mockup sandbox UI component | Read fully
artifacts/mockup-sandbox/src/components/ui/dialog.tsx | dialog.tsx | code | Mockup sandbox UI component | Read fully
artifacts/mockup-sandbox/src/components/ui/drawer.tsx | drawer.tsx | code | Mockup sandbox UI component | Read fully
artifacts/mockup-sandbox/src/components/ui/dropdown-menu.tsx | dropdown-menu.tsx | code | Mockup sandbox UI component | Read fully
artifacts/mockup-sandbox/src/components/ui/empty.tsx | empty.tsx | code | Mockup sandbox UI component | Read fully
artifacts/mockup-sandbox/src/components/ui/field.tsx | field.tsx | code | Mockup sandbox UI component | Read fully
artifacts/mockup-sandbox/src/components/ui/form.tsx | form.tsx | code | Mockup sandbox UI component | Read fully
artifacts/mockup-sandbox/src/components/ui/hover-card.tsx | hover-card.tsx | code | Mockup sandbox UI component | Read fully
artifacts/mockup-sandbox/src/components/ui/input-group.tsx | input-group.tsx | code | Mockup sandbox UI component | Read fully
artifacts/mockup-sandbox/src/components/ui/input-otp.tsx | input-otp.tsx | code | Mockup sandbox UI component | Read fully
artifacts/mockup-sandbox/src/components/ui/input.tsx | input.tsx | code | Mockup sandbox UI component | Read fully
artifacts/mockup-sandbox/src/components/ui/item.tsx | item.tsx | code | Mockup sandbox UI component | Read fully
artifacts/mockup-sandbox/src/components/ui/kbd.tsx | kbd.tsx | code | Mockup sandbox UI component | Read fully
artifacts/mockup-sandbox/src/components/ui/label.tsx | label.tsx | code | Mockup sandbox UI component | Read fully
artifacts/mockup-sandbox/src/components/ui/menubar.tsx | menubar.tsx | code | Mockup sandbox UI component | Read fully
artifacts/mockup-sandbox/src/components/ui/navigation-menu.tsx | navigation-menu.tsx | code | Mockup sandbox UI component | Read fully
artifacts/mockup-sandbox/src/components/ui/pagination.tsx | pagination.tsx | code | Mockup sandbox UI component | Read fully
artifacts/mockup-sandbox/src/components/ui/popover.tsx | popover.tsx | code | Mockup sandbox UI component | Read fully
artifacts/mockup-sandbox/src/components/ui/progress.tsx | progress.tsx | code | Mockup sandbox UI component | Read fully
artifacts/mockup-sandbox/src/components/ui/radio-group.tsx | radio-group.tsx | code | Mockup sandbox UI component | Read fully
artifacts/mockup-sandbox/src/components/ui/resizable.tsx | resizable.tsx | code | Mockup sandbox UI component | Read fully
artifacts/mockup-sandbox/src/components/ui/scroll-area.tsx | scroll-area.tsx | code | Mockup sandbox UI component | Read fully
artifacts/mockup-sandbox/src/components/ui/select.tsx | select.tsx | code | Mockup sandbox UI component | Read fully
artifacts/mockup-sandbox/src/components/ui/separator.tsx | separator.tsx | code | Mockup sandbox UI component | Read fully
artifacts/mockup-sandbox/src/components/ui/sheet.tsx | sheet.tsx | code | Mockup sandbox UI component | Read fully
artifacts/mockup-sandbox/src/components/ui/sidebar.tsx | sidebar.tsx | code | Mockup sandbox UI component | Read fully
artifacts/mockup-sandbox/src/components/ui/skeleton.tsx | skeleton.tsx | code | Mockup sandbox UI component | Read fully
artifacts/mockup-sandbox/src/components/ui/slider.tsx | slider.tsx | code | Mockup sandbox UI component | Read fully
artifacts/mockup-sandbox/src/components/ui/sonner.tsx | sonner.tsx | code | Mockup sandbox UI component | Read fully
artifacts/mockup-sandbox/src/components/ui/spinner.tsx | spinner.tsx | code | Mockup sandbox UI component | Read fully
artifacts/mockup-sandbox/src/components/ui/switch.tsx | switch.tsx | code | Mockup sandbox UI component | Read fully
artifacts/mockup-sandbox/src/components/ui/table.tsx | table.tsx | code | Mockup sandbox UI component | Read fully
artifacts/mockup-sandbox/src/components/ui/tabs.tsx | tabs.tsx | code | Mockup sandbox UI component | Read fully
artifacts/mockup-sandbox/src/components/ui/textarea.tsx | textarea.tsx | code | Mockup sandbox UI component | Read fully
artifacts/mockup-sandbox/src/components/ui/toast.tsx | toast.tsx | code | Mockup sandbox UI component | Read fully
artifacts/mockup-sandbox/src/components/ui/toaster.tsx | toaster.tsx | code | Mockup sandbox UI component | Read fully
artifacts/mockup-sandbox/src/components/ui/toggle-group.tsx | toggle-group.tsx | code | Mockup sandbox UI component | Read fully
artifacts/mockup-sandbox/src/components/ui/toggle.tsx | toggle.tsx | code | Mockup sandbox UI component | Read fully
artifacts/mockup-sandbox/src/components/ui/tooltip.tsx | tooltip.tsx | code | Mockup sandbox UI component | Read fully
artifacts/mockup-sandbox/src/hooks/use-mobile.tsx | use-mobile.tsx | code | Mockup sandbox app code | Read fully
artifacts/mockup-sandbox/src/hooks/use-toast.ts | use-toast.ts | code | Mockup sandbox app code | Read fully
artifacts/mockup-sandbox/src/index.css | index.css | config/text | Mockup sandbox app code | Read fully
artifacts/mockup-sandbox/src/lib/utils.ts | utils.ts | code | Mockup sandbox app code | Read fully
artifacts/mockup-sandbox/src/main.tsx | main.tsx | code | Mockup sandbox app code | Read fully
artifacts/mockup-sandbox/tsconfig.json | tsconfig.json | config/text | Mockup sandbox config/build file | Read fully
artifacts/mockup-sandbox/vite.config.ts | vite.config.ts | code | Mockup sandbox config/build file | Read fully

### `attached_assets` (246 ملفًا)
attached_assets/ENGINEERINGOS_EXECUTION_ALIGNMENT_REPORT_1784147505317.md | ENGINEERINGOS_EXECUTION_ALIGNMENT_REPORT_1784147505317.md | documentation | Attached evidence artifact | Read fully
attached_assets/ENGINEERINGOS_MASTER_EXECUTION_CONSTITUTION(2)_(2)_1784143389784.md | ENGINEERINGOS_MASTER_EXECUTION_CONSTITUTION(2)_(2)_1784143389784.md | documentation | Attached evidence artifact | Read fully
attached_assets/ENGINEERINGOS_PLACEHOLDER_REGISTER_1784147505353.md | ENGINEERINGOS_PLACEHOLDER_REGISTER_1784147505353.md | documentation | Attached evidence artifact | Read fully
attached_assets/ENGINEERINGOS_RUNTIME_EXECUTION_MATRIX_1784147505400.md | ENGINEERINGOS_RUNTIME_EXECUTION_MATRIX_1784147505400.md | documentation | Attached evidence artifact | Read fully
attached_assets/EngineeringOS_Audit_Report_1783641389270.md | EngineeringOS_Audit_Report_1783641389270.md | documentation | Attached evidence artifact | Read fully
attached_assets/EngineeringOS_Audit_Report_Expanded_1783642792349.md | EngineeringOS_Audit_Report_Expanded_1783642792349.md | documentation | Attached evidence artifact | Read fully
attached_assets/EngineeringOS_Combined_Deep_Analysis_(1)_1783706911895.md | EngineeringOS_Combined_Deep_Analysis_(1)_1783706911895.md | documentation | Attached evidence artifact | Read fully
attached_assets/EngineeringOS_Engineering_Truth_Verification_1784082430324.csv | EngineeringOS_Engineering_Truth_Verification_1784082430324.csv | other | Attached evidence artifact | Read fully
attached_assets/EngineeringOS_Engineering_Truth_Verification_1784082430371.md | EngineeringOS_Engineering_Truth_Verification_1784082430371.md | documentation | Attached evidence artifact | Read fully
attached_assets/EngineeringOS_Execution_Plan_1783831261195.pdf | EngineeringOS_Execution_Plan_1783831261195.pdf | binary asset | Attached report / plan | Text extracted / metadata read
attached_assets/EngineeringOS_Executive_Build_Directive_v1_1783912619169.md | EngineeringOS_Executive_Build_Directive_v1_1783912619169.md | documentation | Attached evidence artifact | Read fully
attached_assets/EngineeringOS_File_Inventory_Complete(1)_1783706911845.md | EngineeringOS_File_Inventory_Complete(1)_1783706911845.md | documentation | Attached evidence artifact | Read fully
attached_assets/EngineeringOS_File_by_File_Fact_Record_1783725698283.md | EngineeringOS_File_by_File_Fact_Record_1783725698283.md | documentation | Attached evidence artifact | Read fully
attached_assets/EngineeringOS_Implementation_Document_1783726156016.md | EngineeringOS_Implementation_Document_1783726156016.md | documentation | Attached evidence artifact | Read fully
attached_assets/EngineeringOS_Master_Truth_Register_(1)_1784077194501.xlsx | EngineeringOS_Master_Truth_Register_(1)_1784077194501.xlsx | binary asset | Attached truth register | Text extracted / metadata read
attached_assets/EngineeringOS_Plan_1783818095882.pdf | EngineeringOS_Plan_1783818095882.pdf | binary asset | Attached report / plan | Text extracted / metadata read
attached_assets/EngineeringOS_Project_1783718452179.pdf | EngineeringOS_Project_1783718452179.pdf | binary asset | Attached report / plan | Text extracted / metadata read
attached_assets/EngineeringOS_Truth_Flow_Matrix.schema_1784143389669.ts | EngineeringOS_Truth_Flow_Matrix.schema_1784143389669.ts | code | Attached evidence artifact | Read fully
attached_assets/EngineeringOS_Truth_Flow_Matrix_1784143389833.json | EngineeringOS_Truth_Flow_Matrix_1784143389833.json | config/text | Attached evidence artifact | Read fully
attached_assets/EngineeringOS_Truth_Flow_Matrix_1784143389882.ts | EngineeringOS_Truth_Flow_Matrix_1784143389882.ts | code | Attached evidence artifact | Read fully
attached_assets/EngineeringOS_Truth_Flow_PR_Checklist_1784143389929.md | EngineeringOS_Truth_Flow_PR_Checklist_1784143389929.md | documentation | Attached evidence artifact | Read fully
attached_assets/EngineeringOS_Truth_Register_Full_(1)_1784081699025.csv | EngineeringOS_Truth_Register_Full_(1)_1784081699025.csv | other | Attached evidence artifact | Read fully
attached_assets/EngineeringOS_Truth_Register_Full_1784081611461.csv | EngineeringOS_Truth_Register_Full_1784081611461.csv | other | Attached evidence artifact | Read fully
attached_assets/EngineeringOS_Truth_Register_and_PR_Roadmap_(1)_1784081698974.md | EngineeringOS_Truth_Register_and_PR_Roadmap_(1)_1784081698974.md | documentation | Attached evidence artifact | Read fully
attached_assets/EngineeringOS_Truth_Register_and_PR_Roadmap_1784081611536.md | EngineeringOS_Truth_Register_and_PR_Roadmap_1784081611536.md | documentation | Attached evidence artifact | Read fully
attached_assets/EngineeringOS_analysis_report(2)_(1)_1784047036210.md | EngineeringOS_analysis_report(2)_(1)_1784047036210.md | documentation | Attached evidence artifact | Read fully
attached_assets/EngineeringOS_analysis_summary_1784485047967.json | EngineeringOS_analysis_summary_1784485047967.json | config/text | Attached evidence artifact | Read fully
attached_assets/EngineeringOS_analysis_summary_1784487574320.json | EngineeringOS_analysis_summary_1784487574320.json | config/text | Attached evidence artifact | Read fully
attached_assets/EngineeringOS_analysis_summary_1784488259980.json | EngineeringOS_analysis_summary_1784488259980.json | config/text | Attached evidence artifact | Read fully
attached_assets/EngineeringOS_analysis_summary_1784489456836.json | EngineeringOS_analysis_summary_1784489456836.json | config/text | Attached evidence artifact | Read fully
attached_assets/EngineeringOS_api_zod_index_export_diff_1784143389744.txt | EngineeringOS_api_zod_index_export_diff_1784143389744.txt | config/text | Attached evidence artifact | Read fully
attached_assets/EngineeringOS_architecture_analysis_report_1784040976647.md | EngineeringOS_architecture_analysis_report_1784040976647.md | documentation | Attached evidence artifact | Read fully
attached_assets/EngineeringOS_archive_entries_1784040976692.csv | EngineeringOS_archive_entries_1784040976692.csv | other | Attached evidence artifact | Read fully
attached_assets/EngineeringOS_archive_entries_1784041152876.csv | EngineeringOS_archive_entries_1784041152876.csv | other | Attached evidence artifact | Read fully
attached_assets/EngineeringOS_code_deep_analysis_1784052671648.md | EngineeringOS_code_deep_analysis_1784052671648.md | documentation | Attached evidence artifact | Read fully
attached_assets/EngineeringOS_code_deep_analysis_1784052762652.md | EngineeringOS_code_deep_analysis_1784052762652.md | documentation | Attached evidence artifact | Read fully
attached_assets/EngineeringOS_current_analysis_report_1784052671601.md | EngineeringOS_current_analysis_report_1784052671601.md | documentation | Attached evidence artifact | Read fully
attached_assets/EngineeringOS_current_analysis_report_1784052762572.md | EngineeringOS_current_analysis_report_1784052762572.md | documentation | Attached evidence artifact | Read fully
attached_assets/EngineeringOS_deep_analysis_report_1783800987828.md | EngineeringOS_deep_analysis_report_1783800987828.md | documentation | Attached evidence artifact | Read fully
attached_assets/EngineeringOS_deep_dive_analysis_v2_1784152351310.md | EngineeringOS_deep_dive_analysis_v2_1784152351310.md | documentation | Attached evidence artifact | Read fully
attached_assets/EngineeringOS_deepest_analysis_report(1)_(2)_1784154247108.md | EngineeringOS_deepest_analysis_report(1)_(2)_1784154247108.md | documentation | Attached evidence artifact | Read fully
attached_assets/EngineeringOS_deepest_analysis_report_(1)_1784081611576.md | EngineeringOS_deepest_analysis_report_(1)_1784081611576.md | documentation | Attached evidence artifact | Read fully
attached_assets/EngineeringOS_deepest_analysis_report_(1)_1784081699061.md | EngineeringOS_deepest_analysis_report_(1)_1784081699061.md | documentation | Attached evidence artifact | Read fully
attached_assets/EngineeringOS_file_inventory_(1)_1783729892809.csv | EngineeringOS_file_inventory_(1)_1783729892809.csv | other | Attached evidence artifact | Read fully
attached_assets/EngineeringOS_file_inventory_current_1784052671527.csv | EngineeringOS_file_inventory_current_1784052671527.csv | other | Attached evidence artifact | Read fully
attached_assets/EngineeringOS_file_inventory_current_1784052762450.csv | EngineeringOS_file_inventory_current_1784052762450.csv | other | Attached evidence artifact | Read fully
attached_assets/EngineeringOS_file_inventory_full(2)_1783988496247.csv | EngineeringOS_file_inventory_full(2)_1783988496247.csv | other | Attached evidence artifact | Read fully
attached_assets/EngineeringOS_file_inventory_full_1783800987783.csv | EngineeringOS_file_inventory_full_1783800987783.csv | other | Attached evidence artifact | Read fully
attached_assets/EngineeringOS_file_inventory_v2_1784427571850.csv | EngineeringOS_file_inventory_v2_1784427571850.csv | other | Attached evidence artifact | Read fully
attached_assets/EngineeringOS_file_inventory_v2_1784427972718.csv | EngineeringOS_file_inventory_v2_1784427972718.csv | other | Attached evidence artifact | Read fully
attached_assets/EngineeringOS_forensic_audit_report(1)_(1)_1784509785486.md | EngineeringOS_forensic_audit_report(1)_(1)_1784509785486.md | documentation | Attached evidence artifact | Read fully
attached_assets/EngineeringOS_forensic_audit_report_(1)_1784570354611.md | EngineeringOS_forensic_audit_report_(1)_1784570354611.md | documentation | Attached evidence artifact | Read fully
attached_assets/EngineeringOS_forensic_engineering_report_v2_1784427571793.md | EngineeringOS_forensic_engineering_report_v2_1784427571793.md | documentation | Attached evidence artifact | Read fully
attached_assets/EngineeringOS_forensic_engineering_report_v2_1784427972668.md | EngineeringOS_forensic_engineering_report_v2_1784427972668.md | documentation | Attached evidence artifact | Read fully
attached_assets/EngineeringOS_forensic_report(1)_1784492362639.md | EngineeringOS_forensic_report(1)_1784492362639.md | documentation | Attached evidence artifact | Read fully
attached_assets/EngineeringOS_forensic_report(1)_1784492400992.md | EngineeringOS_forensic_report(1)_1784492400992.md | documentation | Attached evidence artifact | Read fully
attached_assets/EngineeringOS_forensic_report_full(1)_1784485047923.md | EngineeringOS_forensic_report_full(1)_1784485047923.md | documentation | Attached evidence artifact | Read fully
attached_assets/EngineeringOS_forensic_report_full(1)_1784487574279.md | EngineeringOS_forensic_report_full(1)_1784487574279.md | documentation | Attached evidence artifact | Read fully
attached_assets/EngineeringOS_forensic_report_full(1)_1784488259926.md | EngineeringOS_forensic_report_full(1)_1784488259926.md | documentation | Attached evidence artifact | Read fully
attached_assets/EngineeringOS_forensic_report_full(1)_1784489456770.md | EngineeringOS_forensic_report_full(1)_1784489456770.md | documentation | Attached evidence artifact | Read fully
attached_assets/EngineeringOS_full_analysis_report_1783988496190.md | EngineeringOS_full_analysis_report_1783988496190.md | documentation | Attached evidence artifact | Read fully
attached_assets/EngineeringOS_full_file_inventory(1)_1784040976594.csv | EngineeringOS_full_file_inventory(1)_1784040976594.csv | other | Attached evidence artifact | Read fully
attached_assets/EngineeringOS_full_file_inventory(1)_1784041152926.csv | EngineeringOS_full_file_inventory(1)_1784041152926.csv | other | Attached evidence artifact | Read fully
attached_assets/EngineeringOS_full_file_inventory_1784492401113.csv | EngineeringOS_full_file_inventory_1784492401113.csv | other | Attached evidence artifact | Read fully
attached_assets/EngineeringOS_full_inventory(1)_1784485047848.csv | EngineeringOS_full_inventory(1)_1784485047848.csv | other | Attached evidence artifact | Read fully
attached_assets/EngineeringOS_full_inventory(1)_1784487574226.csv | EngineeringOS_full_inventory(1)_1784487574226.csv | other | Attached evidence artifact | Read fully
attached_assets/EngineeringOS_full_inventory(1)_1784488259874.csv | EngineeringOS_full_inventory(1)_1784488259874.csv | other | Attached evidence artifact | Read fully
attached_assets/EngineeringOS_full_inventory(1)_1784489456653.csv | EngineeringOS_full_inventory(1)_1784489456653.csv | other | Attached evidence artifact | Read fully
attached_assets/EngineeringOS_inventory_(1)_1784570354569.csv | EngineeringOS_inventory_(1)_1784570354569.csv | other | Attached evidence artifact | Read fully
attached_assets/EngineeringOS_master_inventory(1)_(1)_1784509785451.csv | EngineeringOS_master_inventory(1)_(1)_1784509785451.csv | other | Attached evidence artifact | Read fully
attached_assets/EngineeringOS_minimum_path_to_vision_(1)_1783830867380.md | EngineeringOS_minimum_path_to_vision_(1)_1783830867380.md | documentation | Attached evidence artifact | Read fully
attached_assets/EngineeringOS_minimum_path_to_vision_1783830816710.md | EngineeringOS_minimum_path_to_vision_1783830816710.md | documentation | Attached evidence artifact | Read fully
attached_assets/EngineeringOS_operational_status_record_1783912104506.md | EngineeringOS_operational_status_record_1783912104506.md | documentation | Attached evidence artifact | Read fully
attached_assets/EngineeringOS_project_analysis_report(1)_1783729892769.md | EngineeringOS_project_analysis_report(1)_1783729892769.md | documentation | Attached evidence artifact | Read fully
attached_assets/EngineeringOS_provenance_registry_linked_1783911530593.json | EngineeringOS_provenance_registry_linked_1783911530593.json | config/text | Attached evidence artifact | Read fully
attached_assets/EngineeringOS_provenance_registry_seed_1783911530658.json | EngineeringOS_provenance_registry_seed_1783911530658.json | config/text | Attached evidence artifact | Read fully
attached_assets/EngineeringOS_replit_execution_directive_1783800987701.json | EngineeringOS_replit_execution_directive_1783800987701.json | config/text | Attached evidence artifact | Read fully
attached_assets/EngineeringOS_replit_execution_directive_1783800987743.md | EngineeringOS_replit_execution_directive_1783800987743.md | documentation | Attached evidence artifact | Read fully
attached_assets/EngineeringOS_runtime_trace_matrix_1784492401053.csv | EngineeringOS_runtime_trace_matrix_1784492401053.csv | other | Attached evidence artifact | Read fully
attached_assets/EngineeringOS_series14_truth_matrix_1783966531635.md | EngineeringOS_series14_truth_matrix_1783966531635.md | documentation | Attached evidence artifact | Read fully
attached_assets/EngineeringOS_series15_deep_evidence_1783966531578.md | EngineeringOS_series15_deep_evidence_1783966531578.md | documentation | Attached evidence artifact | Read fully
attached_assets/EngineeringOS_series16_truth_matrix_(1)_1783966531512.md | EngineeringOS_series16_truth_matrix_(1)_1783966531512.md | documentation | Attached evidence artifact | Read fully
attached_assets/EngineeringOS_series17_deep_analysis_1783966531444.md | EngineeringOS_series17_deep_analysis_1783966531444.md | documentation | Attached evidence artifact | Read fully
attached_assets/EngineeringOS_series18_status_register_(1)_1783966531375.md | EngineeringOS_series18_status_register_(1)_1783966531375.md | documentation | Attached evidence artifact | Read fully
attached_assets/EngineeringOS_series19_control_plane_evidence_1783966531303.md | EngineeringOS_series19_control_plane_evidence_1783966531303.md | documentation | Attached evidence artifact | Read fully
attached_assets/EngineeringOS_series20_status_register_1783966531239.md | EngineeringOS_series20_status_register_1783966531239.md | documentation | Attached evidence artifact | Read fully
attached_assets/EngineeringOS_series21_deep_status_1783966531177.md | EngineeringOS_series21_deep_status_1783966531177.md | documentation | Attached evidence artifact | Read fully
attached_assets/EngineeringOS_series22_second_wave_analysis_1783966531113.md | EngineeringOS_series22_second_wave_analysis_1783966531113.md | documentation | Attached evidence artifact | Read fully
attached_assets/EngineeringOS_series23_self_verifying_architecture_1783966531049.md | EngineeringOS_series23_self_verifying_architecture_1783966531049.md | documentation | Attached evidence artifact | Read fully
attached_assets/EngineeringOS_series24_deep_evidence_1783966530990.md | EngineeringOS_series24_deep_evidence_1783966530990.md | documentation | Attached evidence artifact | Read fully
attached_assets/EngineeringOS_series25_truth_register_1783966530939.md | EngineeringOS_series25_truth_register_1783966530939.md | documentation | Attached evidence artifact | Read fully
attached_assets/EngineeringOS_series26_boundary_analysis_1783966530884.md | EngineeringOS_series26_boundary_analysis_1783966530884.md | documentation | Attached evidence artifact | Read fully
attached_assets/EngineeringOS_series27_failure_semantics_1783966530824.md | EngineeringOS_series27_failure_semantics_1783966530824.md | documentation | Attached evidence artifact | Read fully
attached_assets/EngineeringOS_series28_traceability_mesh_1783966530766.md | EngineeringOS_series28_traceability_mesh_1783966530766.md | documentation | Attached evidence artifact | Read fully
attached_assets/EngineeringOS_series29_trust_boundary_register_1783966530702.md | EngineeringOS_series29_trust_boundary_register_1783966530702.md | documentation | Attached evidence artifact | Read fully
attached_assets/EngineeringOS_series30_release_handoff_audit_1783966530642.md | EngineeringOS_series30_release_handoff_audit_1783966530642.md | documentation | Attached evidence artifact | Read fully
attached_assets/EngineeringOS_series31_release_handoff_audit_1783966530586.md | EngineeringOS_series31_release_handoff_audit_1783966530586.md | documentation | Attached evidence artifact | Read fully
attached_assets/EngineeringOS_series32_phase_conformance_audit_1783966530537.md | EngineeringOS_series32_phase_conformance_audit_1783966530537.md | documentation | Attached evidence artifact | Read fully
attached_assets/EngineeringOS_series33_provenance_authority_graph_1783966530470.md | EngineeringOS_series33_provenance_authority_graph_1783966530470.md | documentation | Attached evidence artifact | Read fully
attached_assets/EngineeringOS_status_record_(1)_1783980758791.md | EngineeringOS_status_record_(1)_1783980758791.md | documentation | Attached evidence artifact | Read fully
attached_assets/EngineeringOS_status_register_(1)_1783818095824.md | EngineeringOS_status_register_(1)_1783818095824.md | documentation | Attached evidence artifact | Read fully
attached_assets/EngineeringOS_status_register_final_1783902107873.md | EngineeringOS_status_register_final_1783902107873.md | documentation | Attached evidence artifact | Read fully
attached_assets/EngineeringOS_task_backlog_1783800987875.json | EngineeringOS_task_backlog_1783800987875.json | config/text | Attached evidence artifact | Read fully
attached_assets/EngineeringOS_truth_checklist_1784322972343.md | EngineeringOS_truth_checklist_1784322972343.md | documentation | Attached evidence artifact | Read fully
attached_assets/EngineeringOS_truth_checklist_1784326108247.md | EngineeringOS_truth_checklist_1784326108247.md | documentation | Attached evidence artifact | Read fully
attached_assets/EngineeringOS_truth_register_current_1783825680736.md | EngineeringOS_truth_register_current_1783825680736.md | documentation | Attached evidence artifact | Read fully
attached_assets/Engineering_Os_Fact_Record_1783718570175.pdf | Engineering_Os_Fact_Record_1783718570175.pdf | binary asset | Attached report / plan | Text extracted / metadata read
attached_assets/Engineering_Os_Phased_Completion_Plan_(1)_1783718452123.pdf | Engineering_Os_Phased_Completion_Plan_(1)_1783718452123.pdf | binary asset | Attached report / plan | Text extracted / metadata read
attached_assets/Engineering_Os_Phased_Completion_Plan_1783718452216.pdf | Engineering_Os_Phased_Completion_Plan_1783718452216.pdf | binary asset | Attached report / plan | Text extracted / metadata read
attached_assets/PR_BACKLOG_1784470184510.md | PR_BACKLOG_1784470184510.md | documentation | Attached evidence artifact | Read fully
attached_assets/PR_BACKLOG_1784476473246.md | PR_BACKLOG_1784476473246.md | documentation | Attached evidence artifact | Read fully
attached_assets/Pasted---1783906604381_1783906604385.txt | Pasted---1783906604381_1783906604385.txt | config/text | Attached evidence artifact | Read fully
attached_assets/Pasted---1783956390496_1783956390501.txt | Pasted---1783956390496_1783956390501.txt | config/text | Attached evidence artifact | Read fully
attached_assets/Pasted---1784163447147_1784163447161.txt | Pasted---1784163447147_1784163447161.txt | config/text | Attached evidence artifact | Read fully
attached_assets/Pasted---1784163799356_1784163799366.txt | Pasted---1784163799356_1784163799366.txt | config/text | Attached evidence artifact | Read fully
attached_assets/Pasted---1784230995192_1784230995203.txt | Pasted---1784230995192_1784230995203.txt | config/text | Attached evidence artifact | Read fully
attached_assets/Pasted---1784231528183_1784231528198.txt | Pasted---1784231528183_1784231528198.txt | config/text | Attached evidence artifact | Read fully
attached_assets/Pasted---1784232069146_1784232069153.txt | Pasted---1784232069146_1784232069153.txt | config/text | Attached evidence artifact | Read fully
attached_assets/Pasted---1784348446604_1784348446608.txt | Pasted---1784348446604_1784348446608.txt | config/text | Attached evidence artifact | Read fully
attached_assets/Pasted---1784389595241_1784389595255.txt | Pasted---1784389595241_1784389595255.txt | config/text | Attached evidence artifact | Read fully
attached_assets/Pasted--1--1784078393552_1784078393558.txt | Pasted--1--1784078393552_1784078393558.txt | config/text | Attached evidence artifact | Read fully
attached_assets/Pasted--1-Executive-Summary-I-scanned-the-whole-extracted-tree_1784520091488.txt | Pasted--1-Executive-Summary-I-scanned-the-whole-extracted-tree_1784520091488.txt | config/text | Attached evidence artifact | Read fully
attached_assets/Pasted--1-Executive-Summary-I-scanned-the-whole-extracted-tree_1784520380555.txt | Pasted--1-Executive-Summary-I-scanned-the-whole-extracted-tree_1784520380555.txt | config/text | Attached evidence artifact | Read fully
attached_assets/Pasted--1-Executive-Summary-I-scanned-the-whole-extracted-tree_1784565784400.txt | Pasted--1-Executive-Summary-I-scanned-the-whole-extracted-tree_1784565784400.txt | config/text | Attached evidence artifact | Read fully
attached_assets/Pasted--1-Executive-Summary-ID-Path-Scope--1784588898200_1784588898209.txt | Pasted--1-Executive-Summary-ID-Path-Scope--1784588898200_1784588898209.txt | config/text | Attached evidence artifact | Read fully
attached_assets/Pasted--1-Executive-Summary-ID-Path-Scope--1784588976178_1784588976181.txt | Pasted--1-Executive-Summary-ID-Path-Scope--1784588976178_1784588976181.txt | config/text | Attached evidence artifact | Read fully
attached_assets/Pasted--1-Set-up-the-imported-project-What-Why-The-user-just-i_1784600640416.txt | Pasted--1-Set-up-the-imported-project-What-Why-The-user-just-i_1784600640416.txt | config/text | Attached evidence artifact | Read fully
attached_assets/Pasted--8-minutes-ago-Replacing-in-process-upload-store-The-us_1784600039567.txt | Pasted--8-minutes-ago-Replacing-in-process-upload-store-The-us_1784600039567.txt | config/text | Attached evidence artifact | Read fully
attached_assets/Pasted--Backlog-Execution-Backlog-v1-0--1783975284276_1783975284279.txt | Pasted--Backlog-Execution-Backlog-v1-0--1783975284276_1783975284279.txt | config/text | Attached evidence artifact | Read fully
attached_assets/Pasted--Code-Review-Plan-Groq-Scope-Save-API--1784175594438_1784175594440.txt | Pasted--Code-Review-Plan-Groq-Scope-Save-API--1784175594438_1784175594440.txt | config/text | Attached evidence artifact | Read fully
attached_assets/Pasted--Discovery-Layer--1783988471815_1783988471818.txt | Pasted--Discovery-Layer--1783988471815_1783988471818.txt | config/text | Attached evidence artifact | Read fully
attached_assets/Pasted--EngineeringOS--1784145653787_1784145653789.txt | Pasted--EngineeringOS--1784145653787_1784145653789.txt | config/text | Attached evidence artifact | Read fully
attached_assets/Pasted--EngineeringOS-Autonomous-Project-Discovery-Onboarding-_1783565505918.txt | Pasted--EngineeringOS-Autonomous-Project-Discovery-Onboarding-_1783565505918.txt | config/text | Attached evidence artifact | Read fully
attached_assets/Pasted--EngineeringOS-Autonomous-Project-Discovery-Onboarding-_1783566150077.txt | Pasted--EngineeringOS-Autonomous-Project-Discovery-Onboarding-_1783566150077.txt | config/text | Attached evidence artifact | Read fully
attached_assets/Pasted--EngineeringOS-PR-Backlog-File-by-File-backlog--1784168_1784168977036.txt | Pasted--EngineeringOS-PR-Backlog-File-by-File-backlog--1784168_1784168977036.txt | config/text | Attached evidence artifact | Read fully
attached_assets/Pasted--EngineeringOS-PR-Backlog-File-by-File-backlog--1784169_1784169315352.txt | Pasted--EngineeringOS-PR-Backlog-File-by-File-backlog--1784169_1784169315352.txt | config/text | Attached evidence artifact | Read fully
attached_assets/Pasted--EngineeringOS-PR-by-PR-Execution-Pack-for-Replit-AI-PR_1784154335102.txt | Pasted--EngineeringOS-PR-by-PR-Execution-Pack-for-Replit-AI-PR_1784154335102.txt | config/text | Attached evidence artifact | Read fully
attached_assets/Pasted--EngineeringOS-PR-by-PR-Execution-Pack-for-Replit-AI-PR_1784155079326.txt | Pasted--EngineeringOS-PR-by-PR-Execution-Pack-for-Replit-AI-PR_1784155079326.txt | config/text | Attached evidence artifact | Read fully
attached_assets/Pasted--Forensic-Software-Engineering-Audit-1-Executive-Summar_1784515285022.txt | Pasted--Forensic-Software-Engineering-Audit-1-Executive-Summar_1784515285022.txt | config/text | Attached evidence artifact | Read fully
attached_assets/Pasted--Forensic-Software-Engineering-Audit-1-Executive-Summar_1784515636472.txt | Pasted--Forensic-Software-Engineering-Audit-1-Executive-Summar_1784515636472.txt | config/text | Attached evidence artifact | Read fully
attached_assets/Pasted--GROQ-API-KEY-JavaScript-Groq--1784088277237_1784088277243.txt | Pasted--GROQ-API-KEY-JavaScript-Groq--1784088277237_1784088277243.txt | config/text | Attached evidence artifact | Read fully
attached_assets/Pasted--Git-AI-Orchestrator-lib-ai-orchestrator-src-tools-git-_1784347517831.txt | Pasted--Git-AI-Orchestrator-lib-ai-orchestrator-src-tools-git-_1784347517831.txt | config/text | Attached evidence artifact | Read fully
attached_assets/Pasted--Knowledge-Graph-2-0--1784165514922_1784165514926.txt | Pasted--Knowledge-Graph-2-0--1784165514922_1784165514926.txt | config/text | Attached evidence artifact | Read fully
attached_assets/Pasted--Knowledge-Graph-2-0-Checklist-File--1784165546932_1784165546935.txt | Pasted--Knowledge-Graph-2-0-Checklist-File--1784165546932_1784165546935.txt | config/text | Attached evidence artifact | Read fully
attached_assets/Pasted--PR--1784040954263_1784040954267.txt | Pasted--PR--1784040954263_1784040954267.txt | config/text | Attached evidence artifact | Read fully
attached_assets/Pasted--PR-01-Sync-OpenAPI-with-runtime-graph-surface-files-li_1784234215782.txt | Pasted--PR-01-Sync-OpenAPI-with-runtime-graph-surface-files-li_1784234215782.txt | config/text | Attached evidence artifact | Read fully
attached_assets/Pasted--PR-03-Micro-Backlog-Contract-Layer-Stabilization-1-3--_1784158287520.txt | Pasted--PR-03-Micro-Backlog-Contract-Layer-Stabilization-1-3--_1784158287520.txt | config/text | Attached evidence artifact | Read fully
attached_assets/Pasted--PR-1-Hardening-Contract-Alignment-for-projects-ts-proj_1784052905584.txt | Pasted--PR-1-Hardening-Contract-Alignment-for-projects-ts-proj_1784052905584.txt | config/text | Attached evidence artifact | Read fully
attached_assets/Pasted--PR-Backlog-EngineeringOS-1-Scoping-ownership-integrity_1784154359481.txt | Pasted--PR-Backlog-EngineeringOS-1-Scoping-ownership-integrity_1784154359481.txt | config/text | Attached evidence artifact | Read fully
attached_assets/Pasted--PR-Backlog-EngineeringOS-Execution-Alignment--17841474_1784147452495.txt | Pasted--PR-Backlog-EngineeringOS-Execution-Alignment--17841474_1784147452495.txt | config/text | Attached evidence artifact | Read fully
attached_assets/Pasted--PR-Title-fix-ai-chat-surface-AI-request-failures-and-r_1784130154946.txt | Pasted--PR-Title-fix-ai-chat-surface-AI-request-failures-and-r_1784130154946.txt | config/text | Attached evidence artifact | Read fully
attached_assets/Pasted--PR-Title-fix-discovery-Classify-Project-Loading-Failur_1784086246178.txt | Pasted--PR-Title-fix-discovery-Classify-Project-Loading-Failur_1784086246178.txt | config/text | Attached evidence artifact | Read fully
attached_assets/Pasted--PR-app-ts--1784047027177_1784047027183.txt | Pasted--PR-app-ts--1784047027177_1784047027183.txt | config/text | Attached evidence artifact | Read fully
attached_assets/Pasted--PR-app-ts--1784047927706_1784047927710.txt | Pasted--PR-app-ts--1784047927706_1784047927710.txt | config/text | Attached evidence artifact | Read fully
attached_assets/Pasted--PR-backlog-PR--1784509953092_1784509953095.txt | Pasted--PR-backlog-PR--1784509953092_1784509953095.txt | config/text | Attached evidence artifact | Read fully
attached_assets/Pasted--PR-discovery-ts-PR-1-Discovery--1783996178319_1783996178325.txt | Pasted--PR-discovery-ts-PR-1-Discovery--1783996178319_1783996178325.txt | config/text | Attached evidence artifact | Read fully
attached_assets/Pasted--PR-lib-ai-orchestrator-PR-1-Prompt-Templates--17839939_1783993953832.txt | Pasted--PR-lib-ai-orchestrator-PR-1-Prompt-Templates--17839939_1783993953832.txt | config/text | Attached evidence artifact | Read fully
attached_assets/Pasted--PR-lib-ai-orchestrator-PR-1-Prompt-Templates--17839939_1783993967887.txt | Pasted--PR-lib-ai-orchestrator-PR-1-Prompt-Templates--17839939_1783993967887.txt | config/text | Attached evidence artifact | Read fully
attached_assets/Pasted--PR-lib-ai-orchestrator-PR-1-Prompt-Templates--17839950_1783995013203.txt | Pasted--PR-lib-ai-orchestrator-PR-1-Prompt-Templates--17839950_1783995013203.txt | config/text | Attached evidence artifact | Read fully
attached_assets/Pasted--PR-title-Harden-auth-context-and-prepare-project-scope_1784044908893.txt | Pasted--PR-title-Harden-auth-context-and-prepare-project-scope_1784044908893.txt | config/text | Attached evidence artifact | Read fully
attached_assets/Pasted--PR-title-Hardening-discovery-ts-into-a-deterministic-o_1784053152915.txt | Pasted--PR-title-Hardening-discovery-ts-into-a-deterministic-o_1784053152915.txt | config/text | Attached evidence artifact | Read fully
attached_assets/Pasted--Plan-3-Sync-fact-record-architecture-docs-3-Sync-Fact-_1783733496072.txt | Pasted--Plan-3-Sync-fact-record-architecture-docs-3-Sync-Fact-_1783733496072.txt | config/text | Attached evidence artifact | Read fully
attached_assets/Pasted--Plan-3-Sync-fact-record-architecture-docs-3-Sync-Fact-_1783790285219.txt | Pasted--Plan-3-Sync-fact-record-architecture-docs-3-Sync-Fact-_1783790285219.txt | config/text | Attached evidence artifact | Read fully
attached_assets/Pasted--Today-5-05-AM-EngineeringOS-main-66-zip-Zip-Archive-Fo_1784430667443.txt | Pasted--Today-5-05-AM-EngineeringOS-main-66-zip-Zip-Archive-Fo_1784430667443.txt | config/text | Attached evidence artifact | Read fully
attached_assets/Pasted--artifacts-api-server-src-lib-scan-runner-ts--178460388_1784603885654.txt | Pasted--artifacts-api-server-src-lib-scan-runner-ts--178460388_1784603885654.txt | config/text | Attached evidence artifact | Read fully
attached_assets/Pasted--artifacts-api-server-src-routes-ai-ts-lib-ai-orchestra_1784388540189.txt | Pasted--artifacts-api-server-src-routes-ai-ts-lib-ai-orchestra_1784388540189.txt | config/text | Attached evidence artifact | Read fully
attached_assets/Pasted--artifacts-api-server-src-routes-discovery-ts--17839967_1783996711676.txt | Pasted--artifacts-api-server-src-routes-discovery-ts--17839967_1783996711676.txt | config/text | Attached evidence artifact | Read fully
attached_assets/Pasted--artifacts-api-server-src-routes-discovery-ts--17839967_1783997082105.txt | Pasted--artifacts-api-server-src-routes-discovery-ts--17839967_1783997082105.txt | config/text | Attached evidence artifact | Read fully
attached_assets/Pasted--lib-ai-orchestrator--1783993997216_1783993997218.txt | Pasted--lib-ai-orchestrator--1783993997216_1783993997218.txt | config/text | Attached evidence artifact | Read fully
attached_assets/Pasted--lib-db-test-script--1784159470823_1784159470827.txt | Pasted--lib-db-test-script--1784159470823_1784159470827.txt | config/text | Attached evidence artifact | Read fully
attached_assets/Pasted--onboarding-o-1783988399961_1783988399964.txt | Pasted--onboarding-o-1783988399961_1783988399964.txt | config/text | Attached evidence artifact | Read fully
attached_assets/Pasted--src-context-builder-ts-src-schemas-context-schema-1784_1784305372706.txt | Pasted--src-context-builder-ts-src-schemas-context-schema-1784_1784305372706.txt | config/text | Attached evidence artifact | Read fully
attached_assets/Pasted--test--1784245726594_1784245726598.txt | Pasted--test--1784245726594_1784245726598.txt | config/text | Attached evidence artifact | Read fully
attached_assets/Pasted--test--1784245803493_1784245803497.txt | Pasted--test--1784245803493_1784245803497.txt | config/text | Attached evidence artifact | Read fully
attached_assets/Pasted-7-Upgrade-Dashboard-to-Operational-UI-What-Why-Current-_1783734748019.txt | Pasted-7-Upgrade-Dashboard-to-Operational-UI-What-Why-Current-_1783734748019.txt | config/text | Attached evidence artifact | Read fully
attached_assets/Pasted-7-Upgrade-Dashboard-to-Operational-UI-What-Why-Current-_1783798897613.txt | Pasted-7-Upgrade-Dashboard-to-Operational-UI-What-Why-Current-_1783798897613.txt | config/text | Attached evidence artifact | Read fully
attached_assets/Pasted-Continuing-with-the-appendices-and-the-remaining-large-_1784588937982.txt | Pasted-Continuing-with-the-appendices-and-the-remaining-large-_1784588937982.txt | config/text | Attached evidence artifact | Read fully
attached_assets/Pasted-Continuing-with-the-appendices-and-the-remaining-large-_1784588957924.txt | Pasted-Continuing-with-the-appendices-and-the-remaining-large-_1784588957924.txt | config/text | Attached evidence artifact | Read fully
attached_assets/Pasted-PR-Title-security-ai-Harden-User-Scoped-Groq-Credential_1784127290653.txt | Pasted-PR-Title-security-ai-Harden-User-Scoped-Groq-Credential_1784127290653.txt | config/text | Attached evidence artifact | Read fully
attached_assets/Pasted-Plan-6-Deepen-graph-scanner-discovery-6-Deepen-Graph-Sc_1783734658300.txt | Pasted-Plan-6-Deepen-graph-scanner-discovery-6-Deepen-Graph-Sc_1783734658300.txt | config/text | Attached evidence artifact | Read fully
attached_assets/Pasted-We-are-CONTINUING-an-interrupted-implementation-session_1784565760215.txt | Pasted-We-are-CONTINUING-an-interrupted-implementation-session_1784565760215.txt | config/text | Attached evidence artifact | Read fully
attached_assets/Pasted-We-are-CONTINUING-an-interrupted-implementation-session_1784565840455.txt | Pasted-We-are-CONTINUING-an-interrupted-implementation-session_1784565840455.txt | config/text | Attached evidence artifact | Read fully
attached_assets/Screenshot_٢٠٢٦٠٧٠٩-٠٦١٦٢٥_1783567039006.png | Screenshot_٢٠٢٦٠٧٠٩-٠٦١٦٢٥_1783567039006.png | binary asset | Screenshot evidence | Metadata read; selected images spot-checked
attached_assets/Screenshot_٢٠٢٦٠٧٠٩-٠٦٢٠٣٨_1783610776566.png | Screenshot_٢٠٢٦٠٧٠٩-٠٦٢٠٣٨_1783610776566.png | binary asset | Screenshot evidence | Metadata read; selected images spot-checked
attached_assets/Screenshot_٢٠٢٦٠٧١٣-٠٣٥٣١٨_1783904118069.png | Screenshot_٢٠٢٦٠٧١٣-٠٣٥٣١٨_1783904118069.png | binary asset | Screenshot evidence | Metadata read; selected images spot-checked
attached_assets/Screenshot_٢٠٢٦٠٧١٣-٠٤٠٥١١_1783904724118.png | Screenshot_٢٠٢٦٠٧١٣-٠٤٠٥١١_1783904724118.png | binary asset | Screenshot evidence | Metadata read; selected images spot-checked
attached_assets/Screenshot_٢٠٢٦٠٧١٣-٠٤٤٤٢٨_1783907108840.png | Screenshot_٢٠٢٦٠٧١٣-٠٤٤٤٢٨_1783907108840.png | binary asset | Screenshot evidence | Metadata read; selected images spot-checked
attached_assets/Screenshot_٢٠٢٦٠٧١٣-٠٥٠١٣٨_1783908128704.png | Screenshot_٢٠٢٦٠٧١٣-٠٥٠١٣٨_1783908128704.png | binary asset | Screenshot evidence | Metadata read; selected images spot-checked
attached_assets/Screenshot_٢٠٢٦٠٧١٣-٠٥١٤٥٤_1783908924873.png | Screenshot_٢٠٢٦٠٧١٣-٠٥١٤٥٤_1783908924873.png | binary asset | Screenshot evidence | Metadata read; selected images spot-checked
attached_assets/Screenshot_٢٠٢٦٠٧١٣-٠٥١٩٤٨_1783909201747.png | Screenshot_٢٠٢٦٠٧١٣-٠٥١٩٤٨_1783909201747.png | binary asset | Screenshot evidence | Metadata read; selected images spot-checked
attached_assets/Screenshot_٢٠٢٦٠٧١٦-٠٧٣٧٤٤_1784176683628.png | Screenshot_٢٠٢٦٠٧١٦-٠٧٣٧٤٤_1784176683628.png | binary asset | Screenshot evidence | Metadata read; selected images spot-checked
attached_assets/Screenshot_٢٠٢٦٠٧١٦-١٨٣٠٤١_1784216000977.png | Screenshot_٢٠٢٦٠٧١٦-١٨٣٠٤١_1784216000977.png | binary asset | Screenshot evidence | Metadata read; selected images spot-checked
attached_assets/Screenshot_٢٠٢٦٠٧١٦-١٨٣٠٤٦_1784216000942.png | Screenshot_٢٠٢٦٠٧١٦-١٨٣٠٤٦_1784216000942.png | binary asset | Screenshot evidence | Metadata read; selected images spot-checked
attached_assets/Screenshot_٢٠٢٦٠٧١٨-٠١٠٨١٠_1784326132441.png | Screenshot_٢٠٢٦٠٧١٨-٠١٠٨١٠_1784326132441.png | binary asset | Screenshot evidence | Metadata read; selected images spot-checked
attached_assets/Screenshot_٢٠٢٦٠٧١٨-٠٦١٢٠٢_1784344398002.png | Screenshot_٢٠٢٦٠٧١٨-٠٦١٢٠٢_1784344398002.png | binary asset | Screenshot evidence | Metadata read; selected images spot-checked
attached_assets/Screenshot_٢٠٢٦٠٧١٨-٠٦١٢٤٢_1784344397966.png | Screenshot_٢٠٢٦٠٧١٨-٠٦١٢٤٢_1784344397966.png | binary asset | Screenshot evidence | Metadata read; selected images spot-checked
attached_assets/Screenshot_٢٠٢٦٠٧١٨-٠٦١٢٤٦_1784344397931.png | Screenshot_٢٠٢٦٠٧١٨-٠٦١٢٤٦_1784344397931.png | binary asset | Screenshot evidence | Metadata read; selected images spot-checked
attached_assets/Screenshot_٢٠٢٦٠٧١٨-٠٦١٩١٠_1784344762476.png | Screenshot_٢٠٢٦٠٧١٨-٠٦١٩١٠_1784344762476.png | binary asset | Screenshot evidence | Metadata read; selected images spot-checked
attached_assets/Screenshot_٢٠٢٦٠٧١٩-٠٤٣٥١٧_1784424954601.png | Screenshot_٢٠٢٦٠٧١٩-٠٤٣٥١٧_1784424954601.png | binary asset | Screenshot evidence | Metadata read; selected images spot-checked
attached_assets/Screenshot_٢٠٢٦٠٧١٩-٠٤٣٥٢١_1784424954559.png | Screenshot_٢٠٢٦٠٧١٩-٠٤٣٥٢١_1784424954559.png | binary asset | Screenshot evidence | Metadata read; selected images spot-checked
attached_assets/Screenshot_٢٠٢٦٠٧٢٠-٠٢٠٢٥١_1784502211806.png | Screenshot_٢٠٢٦٠٧٢٠-٠٢٠٢٥١_1784502211806.png | binary asset | Screenshot evidence | Metadata read; selected images spot-checked
attached_assets/Screenshot_٢٠٢٦٠٧٢٠-٠٢٠٣٠٤_1784502211776.png | Screenshot_٢٠٢٦٠٧٢٠-٠٢٠٣٠٤_1784502211776.png | binary asset | Screenshot evidence | Metadata read; selected images spot-checked
attached_assets/Screenshot_٢٠٢٦٠٧٢٠-٠٢٢٤٤٨_1784504071817.png | Screenshot_٢٠٢٦٠٧٢٠-٠٢٢٤٤٨_1784504071817.png | binary asset | Screenshot evidence | Metadata read; selected images spot-checked
attached_assets/Screenshot_٢٠٢٦٠٧٢٠-٠٢٢٤٥١_1784504071787.png | Screenshot_٢٠٢٦٠٧٢٠-٠٢٢٤٥١_1784504071787.png | binary asset | Screenshot evidence | Metadata read; selected images spot-checked
attached_assets/Screenshot_٢٠٢٦٠٧٢٠-٠٢٢٤٥٥_1784504071737.png | Screenshot_٢٠٢٦٠٧٢٠-٠٢٢٤٥٥_1784504071737.png | binary asset | Screenshot evidence | Metadata read; selected images spot-checked
attached_assets/Screenshot_٢٠٢٦٠٧٢٠-٠٣٢٣٤٤_1784507048475.png | Screenshot_٢٠٢٦٠٧٢٠-٠٣٢٣٤٤_1784507048475.png | binary asset | Screenshot evidence | Metadata read; selected images spot-checked
attached_assets/Screenshot_٢٠٢٦٠٧٢٠-٠٤٤٥٣٥_1784512160900.png | Screenshot_٢٠٢٦٠٧٢٠-٠٤٤٥٣٥_1784512160900.png | binary asset | Screenshot evidence | Metadata read; selected images spot-checked
attached_assets/Screenshot_٢٠٢٦٠٧٢٠-٠٦١٠٤٦_1784517131306.png | Screenshot_٢٠٢٦٠٧٢٠-٠٦١٠٤٦_1784517131306.png | binary asset | Screenshot evidence | Metadata read; selected images spot-checked
attached_assets/Screenshot_٢٠٢٦٠٧٢٠-٠٦١٠٥٢_1784517131269.png | Screenshot_٢٠٢٦٠٧٢٠-٠٦١٠٥٢_1784517131269.png | binary asset | Screenshot evidence | Metadata read; selected images spot-checked
attached_assets/Screenshot_٢٠٢٦٠٧٢١-١٨٠٩٠٦_1784646632784.png | Screenshot_٢٠٢٦٠٧٢١-١٨٠٩٠٦_1784646632784.png | binary asset | Screenshot evidence | Metadata read; selected images spot-checked
attached_assets/agents_(1)_1783564013722.zip | agents_(1)_1783564013722.zip | binary asset | Archived snapshot / pointer | Archive metadata / entry list read
attached_assets/ai_orchestrator_deep_dive_(1)_1783994021466.md | ai_orchestrator_deep_dive_(1)_1783994021466.md | documentation | Attached evidence artifact | Read fully
attached_assets/artifacts_(7)_(1)_1783564013761.zip | artifacts_(7)_(1)_1783564013761.zip | binary asset | Archived snapshot / pointer | Archive metadata / entry list read
attached_assets/engineeringos_forensic_analysis_1784431635464.md | engineeringos_forensic_analysis_1784431635464.md | documentation | Attached evidence artifact | Read fully
attached_assets/engineeringos_forensic_analysis_complete_1784431954519.md | engineeringos_forensic_analysis_complete_1784431954519.md | documentation | Attached evidence artifact | Read fully
attached_assets/engineeringos_forensic_analysis_complete_1784476328406.md | engineeringos_forensic_analysis_complete_1784476328406.md | documentation | Attached evidence artifact | Read fully
attached_assets/engineeringos_forensic_audit_report_(2)_1784594296592_1784597203240.md | engineeringos_forensic_audit_report_(2)_1784594296592_1784597203240.md | documentation | Attached evidence artifact | Read fully
attached_assets/engineeringos_forensic_audit_report_(2)_1784594296592_1784600036061.md | engineeringos_forensic_audit_report_(2)_1784594296592_1784600036061.md | documentation | Attached evidence artifact | Read fully
attached_assets/engineeringos_forensic_audit_report_(2)_1784594296592_1784601251287.md | engineeringos_forensic_audit_report_(2)_1784594296592_1784601251287.md | documentation | Attached evidence artifact | Read fully
attached_assets/engineeringos_forensic_audit_report_1784498370433.md | engineeringos_forensic_audit_report_1784498370433.md | documentation | Attached evidence artifact | Read fully
attached_assets/engineeringos_forensic_audit_report_1784499793978.md | engineeringos_forensic_audit_report_1784499793978.md | documentation | Attached evidence artifact | Read fully
attached_assets/engineeringos_forensic_audit_report_1784500814802.md | engineeringos_forensic_audit_report_1784500814802.md | documentation | Attached evidence artifact | Read fully
attached_assets/engineeringos_master_inventory_(3)_1784597203313.csv | engineeringos_master_inventory_(3)_1784597203313.csv | other | Attached evidence artifact | Read fully
attached_assets/engineeringos_master_inventory_(3)_1784600036116.csv | engineeringos_master_inventory_(3)_1784600036116.csv | other | Attached evidence artifact | Read fully
attached_assets/engineeringos_master_inventory_(3)_1784601251241.csv | engineeringos_master_inventory_(3)_1784601251241.csv | other | Attached evidence artifact | Read fully
attached_assets/engineeringos_master_inventory_1784498370483.csv | engineeringos_master_inventory_1784498370483.csv | other | Attached evidence artifact | Read fully
attached_assets/engineeringos_master_inventory_1784499794029.csv | engineeringos_master_inventory_1784499794029.csv | other | Attached evidence artifact | Read fully
attached_assets/engineeringos_master_inventory_1784500814907.csv | engineeringos_master_inventory_1784500814907.csv | other | Attached evidence artifact | Read fully
attached_assets/git_(2)_1783564013691.zip | git_(2)_1783564013691.zip | binary asset | Archived snapshot / pointer | Pointer text read
attached_assets/gitattributes_1783564013915.txt | gitattributes_1783564013915.txt | config/text | Attached evidence artifact | Read fully
attached_assets/gitignore_(1)_1783564013965.txt | gitignore_(1)_1783564013965.txt | config/text | Attached evidence artifact | Read fully
attached_assets/lib_(7)_(1)_1783564013810.zip | lib_(7)_(1)_1783564013810.zip | binary asset | Archived snapshot / pointer | Archive metadata / entry list read
attached_assets/node_modules_(2)_1783564014266.zip | node_modules_(2)_1783564014266.zip | binary asset | Archived snapshot / pointer | Archive metadata / entry list read
attached_assets/npmrc_(2)_1783564014024.txt | npmrc_(2)_1783564014024.txt | config/text | Attached evidence artifact | Read fully
attached_assets/package_(1)_(7)_1783564014328.json | package_(1)_(7)_1783564014328.json | config/text | Attached evidence artifact | Read fully
attached_assets/pnpm-lock.yaml_(3)_1783564014392.txt | pnpm-lock.yaml_(3)_1783564014392.txt | config/text | Attached evidence artifact | Read fully
attached_assets/pnpm-workspace.yaml_(3)_1783564014449.txt | pnpm-workspace.yaml_(3)_1783564014449.txt | config/text | Attached evidence artifact | Read fully
attached_assets/pr-backlog-ai-orchestrator_1784306020062.md | pr-backlog-ai-orchestrator_1784306020062.md | documentation | Attached evidence artifact | Read fully
attached_assets/replit_(13)_1783564014085.md | replit_(13)_1783564014085.md | documentation | Attached evidence artifact | Read fully
attached_assets/replit_(2)_1783564014509.txt | replit_(2)_1783564014509.txt | config/text | Attached evidence artifact | Read fully
attached_assets/replitignore_1783564014569.txt | replitignore_1783564014569.txt | config/text | Attached evidence artifact | Read fully
attached_assets/scripts_(8)_1783564013865.zip | scripts_(8)_1783564013865.zip | binary asset | Archived snapshot / pointer | Archive metadata / entry list read
attached_assets/tsconfig.base_(2)_(1)_1783564014142.json | tsconfig.base_(2)_(1)_1783564014142.json | config/text | Attached evidence artifact | Read fully
attached_assets/tsconfig_(7)_1783564014202.json | tsconfig_(7)_1783564014202.json | config/text | Attached evidence artifact | Read fully
attached_assets/تحليل_EngineeringOS_1783804577785.docx | تحليل_EngineeringOS_1783804577785.docx | binary asset | Attached report / plan | Text extracted / metadata read
attached_assets/خطة_العمل_التنفيذية_لمشروع_EngineeringOS_1783729892699.docx | خطة_العمل_التنفيذية_لمشروع_EngineeringOS_1783729892699.docx | binary asset | Attached report / plan | Text extracted / metadata read

### `docs` (15 ملفًا)
docs/ENGINEERINGOS_MASTER_EXECUTION_CONSTITUTION.md | ENGINEERINGOS_MASTER_EXECUTION_CONSTITUTION.md | documentation | Project documentation / governance | Read fully
docs/EXECUTION_ALIGNMENT_REPORT.md | EXECUTION_ALIGNMENT_REPORT.md | documentation | Project documentation / governance | Read fully
docs/PLACEHOLDER_REGISTER.md | PLACEHOLDER_REGISTER.md | documentation | Project documentation / governance | Read fully
docs/PR_BACKLOG.md | PR_BACKLOG.md | documentation | Project documentation / governance | Read fully
docs/RUNTIME_EXECUTION_MATRIX.md | RUNTIME_EXECUTION_MATRIX.md | documentation | Project documentation / governance | Read fully
docs/ai-orchestrator-executive-table.md | ai-orchestrator-executive-table.md | documentation | Project documentation / governance | Read fully
docs/ai-orchestrator-forensic-analysis.md | ai-orchestrator-forensic-analysis.md | documentation | Project documentation / governance | Read fully
docs/ai-orchestrator-gap-analysis.md | ai-orchestrator-gap-analysis.md | documentation | Project documentation / governance | Read fully
docs/ai-orchestrator-trace-analysis.md | ai-orchestrator-trace-analysis.md | documentation | Project documentation / governance | Read fully
docs/architecture.md | architecture.md | documentation | Project documentation / governance | Read fully
docs/completion-plan.md | completion-plan.md | documentation | Project documentation / governance | Read fully
docs/fact-record.md | fact-record.md | documentation | Project documentation / governance | Read fully
docs/pr-backlog-ai-orchestrator.md | pr-backlog-ai-orchestrator.md | documentation | Project documentation / governance | Read fully
docs/truth-flow-pr-checklist.md | truth-flow-pr-checklist.md | documentation | Project documentation / governance | Read fully
docs/truth-flow-pr-review-plan.md | truth-flow-pr-review-plan.md | documentation | Project documentation / governance | Read fully

### `lib` (261 ملفًا)
lib/ai-orchestrator/package.json | package.json | config/text | Workspace config or root metadata | Read fully
lib/ai-orchestrator/src/__tests__/chat-agent.test.ts | chat-agent.test.ts | code | AI orchestrator runtime | Read fully
lib/ai-orchestrator/src/__tests__/file-tools.test.ts | file-tools.test.ts | code | AI orchestrator runtime | Read fully
lib/ai-orchestrator/src/__tests__/groq-client.test.ts | groq-client.test.ts | code | AI orchestrator runtime | Read fully
lib/ai-orchestrator/src/__tests__/parsing.test.ts | parsing.test.ts | code | AI orchestrator runtime | Read fully
lib/ai-orchestrator/src/__tests__/schemas.test.ts | schemas.test.ts | code | AI orchestrator runtime | Read fully
lib/ai-orchestrator/src/__tests__/workflow-orchestrator.test.ts | workflow-orchestrator.test.ts | code | AI orchestrator runtime | Read fully
lib/ai-orchestrator/src/agents/chat-agent.ts | chat-agent.ts | code | AI agent | Read fully
lib/ai-orchestrator/src/agents/code-reviewer.ts | code-reviewer.ts | code | AI agent | Read fully
lib/ai-orchestrator/src/agents/scan-analyst.ts | scan-analyst.ts | code | AI agent | Read fully
lib/ai-orchestrator/src/agents/task-agent.ts | task-agent.ts | code | AI agent | Read fully
lib/ai-orchestrator/src/agents/workflow-orchestrator.ts | workflow-orchestrator.ts | code | AI agent | Read fully
lib/ai-orchestrator/src/context-builder.test.ts | context-builder.test.ts | code | AI orchestrator runtime | Read fully
lib/ai-orchestrator/src/context-builder.ts | context-builder.ts | code | AI orchestrator runtime | Read fully
lib/ai-orchestrator/src/deepseek-client.ts | deepseek-client.ts | code | AI orchestrator runtime | Read fully
lib/ai-orchestrator/src/errors.ts | errors.ts | code | AI orchestrator runtime | Read fully
lib/ai-orchestrator/src/groq-client.ts | groq-client.ts | code | AI orchestrator runtime | Read fully
lib/ai-orchestrator/src/index.ts | index.ts | code | AI orchestrator runtime | Read fully
lib/ai-orchestrator/src/parsing.ts | parsing.ts | code | AI orchestrator runtime | Read fully
lib/ai-orchestrator/src/prompts/chat.prompt.ts | chat.prompt.ts | code | AI prompt template | Read fully
lib/ai-orchestrator/src/prompts/index.ts | index.ts | code | AI prompt template | Read fully
lib/ai-orchestrator/src/prompts/review.prompt.ts | review.prompt.ts | code | AI prompt template | Read fully
lib/ai-orchestrator/src/prompts/scan.prompt.ts | scan.prompt.ts | code | AI prompt template | Read fully
lib/ai-orchestrator/src/prompts/task.prompt.ts | task.prompt.ts | code | AI prompt template | Read fully
lib/ai-orchestrator/src/prompts/workflow.prompt.ts | workflow.prompt.ts | code | AI prompt template | Read fully
lib/ai-orchestrator/src/schemas/chat.schema.ts | chat.schema.ts | code | AI schema / contract | Read fully
lib/ai-orchestrator/src/schemas/code-review.schema.ts | code-review.schema.ts | code | AI schema / contract | Read fully
lib/ai-orchestrator/src/schemas/context.schema.ts | context.schema.ts | code | AI schema / contract | Read fully
lib/ai-orchestrator/src/schemas/index.ts | index.ts | code | AI schema / contract | Read fully
lib/ai-orchestrator/src/schemas/scan.schema.ts | scan.schema.ts | code | AI schema / contract | Read fully
lib/ai-orchestrator/src/schemas/task.schema.ts | task.schema.ts | code | AI schema / contract | Read fully
lib/ai-orchestrator/src/schemas/workflow.schema.ts | workflow.schema.ts | code | AI schema / contract | Read fully
lib/ai-orchestrator/src/tools/file-tools.ts | file-tools.ts | code | AI tool wrapper | Read fully
lib/ai-orchestrator/src/tools/git-tools.ts | git-tools.ts | code | AI tool wrapper | Read fully
lib/ai-orchestrator/tsconfig.json | tsconfig.json | config/text | Workspace config or root metadata | Read fully
lib/ai-orchestrator/vitest.config.ts | vitest.config.ts | code | Workspace config or root metadata | Read fully
lib/api-client-react/package.json | package.json | config/text | Workspace config or root metadata | Read fully
lib/api-client-react/src/custom-fetch.ts | custom-fetch.ts | code | React API client helper | Read fully
lib/api-client-react/src/generated/api.schemas.ts | api.schemas.ts | code | Generated API client surface | Read fully
lib/api-client-react/src/generated/api.ts | api.ts | code | Generated API client surface | Read fully
lib/api-client-react/src/index.ts | index.ts | code | React API client helper | Read fully
lib/api-client-react/src/project-error.ts | project-error.ts | code | React API client helper | Read fully
lib/api-client-react/src/use-ai-chat-stream.ts | use-ai-chat-stream.ts | code | React API client helper | Read fully
lib/api-client-react/tsconfig.json | tsconfig.json | config/text | Workspace config or root metadata | Read fully
lib/api-spec/openapi.yaml | openapi.yaml | config/text | OpenAPI contract / codegen | Read fully
lib/api-spec/orval.config.ts | orval.config.ts | code | OpenAPI contract / codegen | Read fully
lib/api-spec/package.json | package.json | config/text | OpenAPI contract / codegen | Read fully
lib/api-zod/package.json | package.json | config/text | Workspace config or root metadata | Read fully
lib/api-zod/src/generated/api.ts | api.ts | code | Generated Zod schema surface | Read fully
lib/api-zod/src/generated/types/activeProviderStatus.ts | activeProviderStatus.ts | code | Generated Zod schema surface | Read fully
lib/api-zod/src/generated/types/activeProviderStatusProvider.ts | activeProviderStatusProvider.ts | code | Generated Zod schema surface | Read fully
lib/api-zod/src/generated/types/aiApplyChangesRequest.ts | aiApplyChangesRequest.ts | code | Generated Zod schema surface | Read fully
lib/api-zod/src/generated/types/aiApplyChangesRequestChangesItem.ts | aiApplyChangesRequestChangesItem.ts | code | Generated Zod schema surface | Read fully
lib/api-zod/src/generated/types/aiApplyChangesResult.ts | aiApplyChangesResult.ts | code | Generated Zod schema surface | Read fully
lib/api-zod/src/generated/types/aiApplyChangesResultResultsItem.ts | aiApplyChangesResultResultsItem.ts | code | Generated Zod schema surface | Read fully
lib/api-zod/src/generated/types/aiChatMessage.ts | aiChatMessage.ts | code | Generated Zod schema surface | Read fully
lib/api-zod/src/generated/types/aiChatMessageRole.ts | aiChatMessageRole.ts | code | Generated Zod schema surface | Read fully
lib/api-zod/src/generated/types/aiChatOutput.ts | aiChatOutput.ts | code | Generated Zod schema surface | Read fully
lib/api-zod/src/generated/types/aiChatRequest.ts | aiChatRequest.ts | code | Generated Zod schema surface | Read fully
lib/api-zod/src/generated/types/aiChatSession.ts | aiChatSession.ts | code | Generated Zod schema surface | Read fully
lib/api-zod/src/generated/types/aiCodeIssue.ts | aiCodeIssue.ts | code | Generated Zod schema surface | Read fully
lib/api-zod/src/generated/types/aiCodeIssueSeverity.ts | aiCodeIssueSeverity.ts | code | Generated Zod schema surface | Read fully
lib/api-zod/src/generated/types/aiCodeIssueType.ts | aiCodeIssueType.ts | code | Generated Zod schema surface | Read fully
lib/api-zod/src/generated/types/aiCodeReview.ts | aiCodeReview.ts | code | Generated Zod schema surface | Read fully
lib/api-zod/src/generated/types/aiCodeReviewVerdict.ts | aiCodeReviewVerdict.ts | code | Generated Zod schema surface | Read fully
lib/api-zod/src/generated/types/aiOrchestrateRequest.ts | aiOrchestrateRequest.ts | code | Generated Zod schema surface | Read fully
lib/api-zod/src/generated/types/aiOrchestrationDecision.ts | aiOrchestrationDecision.ts | code | Generated Zod schema surface | Read fully
lib/api-zod/src/generated/types/aiOrchestrationDecisionAction.ts | aiOrchestrationDecisionAction.ts | code | Generated Zod schema surface | Read fully
lib/api-zod/src/generated/types/aiPendingChange.ts | aiPendingChange.ts | code | Generated Zod schema surface | Read fully
lib/api-zod/src/generated/types/aiReviewRequest.ts | aiReviewRequest.ts | code | Generated Zod schema surface | Read fully
lib/api-zod/src/generated/types/aiReviewRequestFileContents.ts | aiReviewRequestFileContents.ts | code | Generated Zod schema surface | Read fully
lib/api-zod/src/generated/types/aiScanAnalysis.ts | aiScanAnalysis.ts | code | Generated Zod schema surface | Read fully
lib/api-zod/src/generated/types/aiScanInsight.ts | aiScanInsight.ts | code | Generated Zod schema surface | Read fully
lib/api-zod/src/generated/types/aiScanInsightCategory.ts | aiScanInsightCategory.ts | code | Generated Zod schema surface | Read fully
lib/api-zod/src/generated/types/aiScanInsightSeverity.ts | aiScanInsightSeverity.ts | code | Generated Zod schema surface | Read fully
lib/api-zod/src/generated/types/apiError.ts | apiError.ts | code | Generated Zod schema surface | Read fully
lib/api-zod/src/generated/types/archiveUploadInput.ts | archiveUploadInput.ts | code | Generated Zod schema surface | Read fully
lib/api-zod/src/generated/types/archiveUploadOutput.ts | archiveUploadOutput.ts | code | Generated Zod schema surface | Read fully
lib/api-zod/src/generated/types/createProjectInput.ts | createProjectInput.ts | code | Generated Zod schema surface | Read fully
lib/api-zod/src/generated/types/createRuleInput.ts | createRuleInput.ts | code | Generated Zod schema surface | Read fully
lib/api-zod/src/generated/types/createTaskInput.ts | createTaskInput.ts | code | Generated Zod schema surface | Read fully
lib/api-zod/src/generated/types/createWorkflowInput.ts | createWorkflowInput.ts | code | Generated Zod schema surface | Read fully
lib/api-zod/src/generated/types/dashboardOverview.ts | dashboardOverview.ts | code | Generated Zod schema surface | Read fully
lib/api-zod/src/generated/types/dashboardOverviewProjectScoresItem.ts | dashboardOverviewProjectScoresItem.ts | code | Generated Zod schema surface | Read fully
lib/api-zod/src/generated/types/dashboardOverviewProjectScoresItemTrend.ts | dashboardOverviewProjectScoresItemTrend.ts | code | Generated Zod schema surface | Read fully
lib/api-zod/src/generated/types/dashboardOverviewTaskStatusBreakdown.ts | dashboardOverviewTaskStatusBreakdown.ts | code | Generated Zod schema surface | Read fully
lib/api-zod/src/generated/types/dashboardOverviewTopRulesItem.ts | dashboardOverviewTopRulesItem.ts | code | Generated Zod schema surface | Read fully
lib/api-zod/src/generated/types/deepSeekKeyStatus.ts | deepSeekKeyStatus.ts | code | Generated Zod schema surface | Read fully
lib/api-zod/src/generated/types/deleteDeepSeekKey200.ts | deleteDeepSeekKey200.ts | code | Generated Zod schema surface | Read fully
lib/api-zod/src/generated/types/deleteGroqKey200.ts | deleteGroqKey200.ts | code | Generated Zod schema surface | Read fully
lib/api-zod/src/generated/types/discoveryGraphSummaryData.ts | discoveryGraphSummaryData.ts | code | Generated Zod schema surface | Read fully
lib/api-zod/src/generated/types/discoveryGraphSummaryDataEntitiesByType.ts | discoveryGraphSummaryDataEntitiesByType.ts | code | Generated Zod schema surface | Read fully
lib/api-zod/src/generated/types/discoveryGraphSummaryDataFilesByLanguage.ts | discoveryGraphSummaryDataFilesByLanguage.ts | code | Generated Zod schema surface | Read fully
lib/api-zod/src/generated/types/discoveryOptions.ts | discoveryOptions.ts | code | Generated Zod schema surface | Read fully
lib/api-zod/src/generated/types/discoveryReport.ts | discoveryReport.ts | code | Generated Zod schema surface | Read fully
lib/api-zod/src/generated/types/discoveryRuleViolationItem.ts | discoveryRuleViolationItem.ts | code | Generated Zod schema surface | Read fully
lib/api-zod/src/generated/types/discoverySessionStatus.ts | discoverySessionStatus.ts | code | Generated Zod schema surface | Read fully
lib/api-zod/src/generated/types/discoverySessionStatusStatus.ts | discoverySessionStatusStatus.ts | code | Generated Zod schema surface | Read fully
lib/api-zod/src/generated/types/discoverySourceCapability.ts | discoverySourceCapability.ts | code | Generated Zod schema surface | Read fully
lib/api-zod/src/generated/types/discoverySourceConfig.ts | discoverySourceConfig.ts | code | Generated Zod schema surface | Read fully
lib/api-zod/src/generated/types/discoverySourceConfigCredentials.ts | discoverySourceConfigCredentials.ts | code | Generated Zod schema surface | Read fully
lib/api-zod/src/generated/types/discoveryStepItem.ts | discoveryStepItem.ts | code | Generated Zod schema surface | Read fully
lib/api-zod/src/generated/types/discoveryStepItemStatus.ts | discoveryStepItemStatus.ts | code | Generated Zod schema surface | Read fully
lib/api-zod/src/generated/types/entityType.ts | entityType.ts | code | Generated Zod schema surface | Read fully
lib/api-zod/src/generated/types/evaluateRuleRequest.ts | evaluateRuleRequest.ts | code | Generated Zod schema surface | Read fully
lib/api-zod/src/generated/types/event.ts | event.ts | code | Generated Zod schema surface | Read fully
lib/api-zod/src/generated/types/eventPayload.ts | eventPayload.ts | code | Generated Zod schema surface | Read fully
lib/api-zod/src/generated/types/eventSeverity.ts | eventSeverity.ts | code | Generated Zod schema surface | Read fully
lib/api-zod/src/generated/types/failWorkflowPhaseInput.ts | failWorkflowPhaseInput.ts | code | Generated Zod schema surface | Read fully
lib/api-zod/src/generated/types/getGraphEntityImpact404.ts | getGraphEntityImpact404.ts | code | Generated Zod schema surface | Read fully
lib/api-zod/src/generated/types/getGraphEntityImpactParams.ts | getGraphEntityImpactParams.ts | code | Generated Zod schema surface | Read fully
lib/api-zod/src/generated/types/getGraphEntityNeighbors200.ts | getGraphEntityNeighbors200.ts | code | Generated Zod schema surface | Read fully
lib/api-zod/src/generated/types/getGraphEntityNeighbors404.ts | getGraphEntityNeighbors404.ts | code | Generated Zod schema surface | Read fully
lib/api-zod/src/generated/types/getGraphEvidence403.ts | getGraphEvidence403.ts | code | Generated Zod schema surface | Read fully
lib/api-zod/src/generated/types/getGraphEvidence404.ts | getGraphEvidence404.ts | code | Generated Zod schema surface | Read fully
lib/api-zod/src/generated/types/getGraphPathParams.ts | getGraphPathParams.ts | code | Generated Zod schema surface | Read fully
lib/api-zod/src/generated/types/getGraphRuntimeSubgraph403.ts | getGraphRuntimeSubgraph403.ts | code | Generated Zod schema surface | Read fully
lib/api-zod/src/generated/types/getGraphRuntimeSubgraph404.ts | getGraphRuntimeSubgraph404.ts | code | Generated Zod schema surface | Read fully
lib/api-zod/src/generated/types/getGraphSemanticNeighborhood400.ts | getGraphSemanticNeighborhood400.ts | code | Generated Zod schema surface | Read fully
lib/api-zod/src/generated/types/getGraphSemanticNeighborhood403.ts | getGraphSemanticNeighborhood403.ts | code | Generated Zod schema surface | Read fully
lib/api-zod/src/generated/types/getGraphSemanticNeighborhood404.ts | getGraphSemanticNeighborhood404.ts | code | Generated Zod schema surface | Read fully
lib/api-zod/src/generated/types/getGraphSemanticNeighborhoodParams.ts | getGraphSemanticNeighborhoodParams.ts | code | Generated Zod schema surface | Read fully
lib/api-zod/src/generated/types/getGraphSubgraph400.ts | getGraphSubgraph400.ts | code | Generated Zod schema surface | Read fully
lib/api-zod/src/generated/types/getGraphSubgraph403.ts | getGraphSubgraph403.ts | code | Generated Zod schema surface | Read fully
lib/api-zod/src/generated/types/getGraphSubgraph404.ts | getGraphSubgraph404.ts | code | Generated Zod schema surface | Read fully
lib/api-zod/src/generated/types/getGraphSubgraphParams.ts | getGraphSubgraphParams.ts | code | Generated Zod schema surface | Read fully
lib/api-zod/src/generated/types/getLatestMetricsParams.ts | getLatestMetricsParams.ts | code | Generated Zod schema surface | Read fully
lib/api-zod/src/generated/types/gitCommitEntry.ts | gitCommitEntry.ts | code | Generated Zod schema surface | Read fully
lib/api-zod/src/generated/types/gitCommitInput.ts | gitCommitInput.ts | code | Generated Zod schema surface | Read fully
lib/api-zod/src/generated/types/gitConfig.ts | gitConfig.ts | code | Generated Zod schema surface | Read fully
lib/api-zod/src/generated/types/gitHubTokenStatus.ts | gitHubTokenStatus.ts | code | Generated Zod schema surface | Read fully
lib/api-zod/src/generated/types/gitLog.ts | gitLog.ts | code | Generated Zod schema surface | Read fully
lib/api-zod/src/generated/types/gitOperationResult.ts | gitOperationResult.ts | code | Generated Zod schema surface | Read fully
lib/api-zod/src/generated/types/gitPushResult.ts | gitPushResult.ts | code | Generated Zod schema surface | Read fully
lib/api-zod/src/generated/types/gitStatus.ts | gitStatus.ts | code | Generated Zod schema surface | Read fully
lib/api-zod/src/generated/types/gitStatusFile.ts | gitStatusFile.ts | code | Generated Zod schema surface | Read fully
lib/api-zod/src/generated/types/graphCentralityScore.ts | graphCentralityScore.ts | code | Generated Zod schema surface | Read fully
lib/api-zod/src/generated/types/graphEdgeType.ts | graphEdgeType.ts | code | Generated Zod schema surface | Read fully
lib/api-zod/src/generated/types/graphEntity.ts | graphEntity.ts | code | Generated Zod schema surface | Read fully
lib/api-zod/src/generated/types/graphEntityMetadata.ts | graphEntityMetadata.ts | code | Generated Zod schema surface | Read fully
lib/api-zod/src/generated/types/graphEvidence.ts | graphEvidence.ts | code | Generated Zod schema surface | Read fully
lib/api-zod/src/generated/types/graphEvidenceBundle.ts | graphEvidenceBundle.ts | code | Generated Zod schema surface | Read fully
lib/api-zod/src/generated/types/graphEvidenceKind.ts | graphEvidenceKind.ts | code | Generated Zod schema surface | Read fully
lib/api-zod/src/generated/types/graphEvidenceResponse.ts | graphEvidenceResponse.ts | code | Generated Zod schema surface | Read fully
lib/api-zod/src/generated/types/graphImpactHop.ts | graphImpactHop.ts | code | Generated Zod schema surface | Read fully
lib/api-zod/src/generated/types/graphImpactResult.ts | graphImpactResult.ts | code | Generated Zod schema surface | Read fully
lib/api-zod/src/generated/types/graphLayerCounts.ts | graphLayerCounts.ts | code | Generated Zod schema surface | Read fully
lib/api-zod/src/generated/types/graphPathResult.ts | graphPathResult.ts | code | Generated Zod schema surface | Read fully
lib/api-zod/src/generated/types/graphPathStep.ts | graphPathStep.ts | code | Generated Zod schema surface | Read fully
lib/api-zod/src/generated/types/graphProvenance.ts | graphProvenance.ts | code | Generated Zod schema surface | Read fully
lib/api-zod/src/generated/types/graphRelationship.ts | graphRelationship.ts | code | Generated Zod schema surface | Read fully
lib/api-zod/src/generated/types/graphRelationshipMetadata.ts | graphRelationshipMetadata.ts | code | Generated Zod schema surface | Read fully
lib/api-zod/src/generated/types/graphRuntimeSubgraph.ts | graphRuntimeSubgraph.ts | code | Generated Zod schema surface | Read fully
lib/api-zod/src/generated/types/graphSemanticNeighborhood.ts | graphSemanticNeighborhood.ts | code | Generated Zod schema surface | Read fully
lib/api-zod/src/generated/types/graphSubgraph.ts | graphSubgraph.ts | code | Generated Zod schema surface | Read fully
lib/api-zod/src/generated/types/graphSubgraphFilters.ts | graphSubgraphFilters.ts | code | Generated Zod schema surface | Read fully
lib/api-zod/src/generated/types/graphSubgraphLayered.ts | graphSubgraphLayered.ts | code | Generated Zod schema surface | Read fully
lib/api-zod/src/generated/types/graphSummary.ts | graphSummary.ts | code | Generated Zod schema surface | Read fully
lib/api-zod/src/generated/types/graphSummaryEntitiesByType.ts | graphSummaryEntitiesByType.ts | code | Generated Zod schema surface | Read fully
lib/api-zod/src/generated/types/graphSummaryRelationsByType.ts | graphSummaryRelationsByType.ts | code | Generated Zod schema surface | Read fully
lib/api-zod/src/generated/types/groqKeyStatus.ts | groqKeyStatus.ts | code | Generated Zod schema surface | Read fully
lib/api-zod/src/generated/types/healthStatus.ts | healthStatus.ts | code | Generated Zod schema surface | Read fully
lib/api-zod/src/generated/types/healthStatusStatus.ts | healthStatusStatus.ts | code | Generated Zod schema surface | Read fully
lib/api-zod/src/generated/types/importProjectInput.ts | importProjectInput.ts | code | Generated Zod schema surface | Read fully
lib/api-zod/src/generated/types/importProjectInputOverrides.ts | importProjectInputOverrides.ts | code | Generated Zod schema surface | Read fully
lib/api-zod/src/generated/types/index.ts | index.ts | code | Generated Zod schema surface | Read fully
lib/api-zod/src/generated/types/jobQueueStats.ts | jobQueueStats.ts | code | Generated Zod schema surface | Read fully
lib/api-zod/src/generated/types/listAiChatSessionsParams.ts | listAiChatSessionsParams.ts | code | Generated Zod schema surface | Read fully
lib/api-zod/src/generated/types/listEventsParams.ts | listEventsParams.ts | code | Generated Zod schema surface | Read fully
lib/api-zod/src/generated/types/listGraphEntitiesParams.ts | listGraphEntitiesParams.ts | code | Generated Zod schema surface | Read fully
lib/api-zod/src/generated/types/listGraphRelationshipsParams.ts | listGraphRelationshipsParams.ts | code | Generated Zod schema surface | Read fully
lib/api-zod/src/generated/types/listMetricsParams.ts | listMetricsParams.ts | code | Generated Zod schema surface | Read fully
lib/api-zod/src/generated/types/listRulesParams.ts | listRulesParams.ts | code | Generated Zod schema surface | Read fully
lib/api-zod/src/generated/types/listTasksParams.ts | listTasksParams.ts | code | Generated Zod schema surface | Read fully
lib/api-zod/src/generated/types/listWorkflowsParams.ts | listWorkflowsParams.ts | code | Generated Zod schema surface | Read fully
lib/api-zod/src/generated/types/metricRecord.ts | metricRecord.ts | code | Generated Zod schema surface | Read fully
lib/api-zod/src/generated/types/metricRecordBuildStatus.ts | metricRecordBuildStatus.ts | code | Generated Zod schema surface | Read fully
lib/api-zod/src/generated/types/operationalCounters.ts | operationalCounters.ts | code | Generated Zod schema surface | Read fully
lib/api-zod/src/generated/types/plugin.ts | plugin.ts | code | Generated Zod schema surface | Read fully
lib/api-zod/src/generated/types/pluginCapabilitiesItem.ts | pluginCapabilitiesItem.ts | code | Generated Zod schema surface | Read fully
lib/api-zod/src/generated/types/pluginProjectRequest.ts | pluginProjectRequest.ts | code | Generated Zod schema surface | Read fully
lib/api-zod/src/generated/types/project.ts | project.ts | code | Generated Zod schema surface | Read fully
lib/api-zod/src/generated/types/projectStatus.ts | projectStatus.ts | code | Generated Zod schema surface | Read fully
lib/api-zod/src/generated/types/projectSummary.ts | projectSummary.ts | code | Generated Zod schema surface | Read fully
lib/api-zod/src/generated/types/projectSummaryTaskCounts.ts | projectSummaryTaskCounts.ts | code | Generated Zod schema surface | Read fully
lib/api-zod/src/generated/types/rule.ts | rule.ts | code | Generated Zod schema surface | Read fully
lib/api-zod/src/generated/types/ruleEvaluationResult.ts | ruleEvaluationResult.ts | code | Generated Zod schema surface | Read fully
lib/api-zod/src/generated/types/ruleEvaluationResultMatchesItem.ts | ruleEvaluationResultMatchesItem.ts | code | Generated Zod schema surface | Read fully
lib/api-zod/src/generated/types/ruleSeverity.ts | ruleSeverity.ts | code | Generated Zod schema surface | Read fully
lib/api-zod/src/generated/types/saveDeepSeekKeyInput.ts | saveDeepSeekKeyInput.ts | code | Generated Zod schema surface | Read fully
lib/api-zod/src/generated/types/saveGitHubTokenInput.ts | saveGitHubTokenInput.ts | code | Generated Zod schema surface | Read fully
lib/api-zod/src/generated/types/saveGroqKeyInput.ts | saveGroqKeyInput.ts | code | Generated Zod schema surface | Read fully
lib/api-zod/src/generated/types/scanJob.ts | scanJob.ts | code | Generated Zod schema surface | Read fully
lib/api-zod/src/generated/types/scanJobStatus.ts | scanJobStatus.ts | code | Generated Zod schema surface | Read fully
lib/api-zod/src/generated/types/scanResult.ts | scanResult.ts | code | Generated Zod schema surface | Read fully
lib/api-zod/src/generated/types/sourceType.ts | sourceType.ts | code | Generated Zod schema surface | Read fully
lib/api-zod/src/generated/types/startDiscoveryInput.ts | startDiscoveryInput.ts | code | Generated Zod schema surface | Read fully
lib/api-zod/src/generated/types/task.ts | task.ts | code | Generated Zod schema surface | Read fully
lib/api-zod/src/generated/types/taskLog.ts | taskLog.ts | code | Generated Zod schema surface | Read fully
lib/api-zod/src/generated/types/taskLogLevel.ts | taskLogLevel.ts | code | Generated Zod schema surface | Read fully
lib/api-zod/src/generated/types/taskLogMetadata.ts | taskLogMetadata.ts | code | Generated Zod schema surface | Read fully
lib/api-zod/src/generated/types/taskPriority.ts | taskPriority.ts | code | Generated Zod schema surface | Read fully
lib/api-zod/src/generated/types/taskStatus.ts | taskStatus.ts | code | Generated Zod schema surface | Read fully
lib/api-zod/src/generated/types/updateGitConfigInput.ts | updateGitConfigInput.ts | code | Generated Zod schema surface | Read fully
lib/api-zod/src/generated/types/updateProjectInput.ts | updateProjectInput.ts | code | Generated Zod schema surface | Read fully
lib/api-zod/src/generated/types/updateProjectInputStatus.ts | updateProjectInputStatus.ts | code | Generated Zod schema surface | Read fully
lib/api-zod/src/generated/types/updateRuleInput.ts | updateRuleInput.ts | code | Generated Zod schema surface | Read fully
lib/api-zod/src/generated/types/updateTaskInput.ts | updateTaskInput.ts | code | Generated Zod schema surface | Read fully
lib/api-zod/src/generated/types/verificationResult.ts | verificationResult.ts | code | Generated Zod schema surface | Read fully
lib/api-zod/src/generated/types/verificationResultStepsItem.ts | verificationResultStepsItem.ts | code | Generated Zod schema surface | Read fully
lib/api-zod/src/generated/types/workflow.ts | workflow.ts | code | Generated Zod schema surface | Read fully
lib/api-zod/src/generated/types/workflowExecution.ts | workflowExecution.ts | code | Generated Zod schema surface | Read fully
lib/api-zod/src/generated/types/workflowPhase.ts | workflowPhase.ts | code | Generated Zod schema surface | Read fully
lib/api-zod/src/generated/types/workflowStatus.ts | workflowStatus.ts | code | Generated Zod schema surface | Read fully
lib/api-zod/src/index.ts | index.ts | code | Shared API schema | Read fully
lib/api-zod/src/truth-flow-matrix.schema.ts | truth-flow-matrix.schema.ts | code | Shared API schema | Read fully
lib/api-zod/tsconfig.json | tsconfig.json | config/text | Workspace config or root metadata | Read fully
lib/db/drizzle.config.ts | drizzle.config.ts | code | Workspace config or root metadata | Read fully
lib/db/package.json | package.json | config/text | Workspace config or root metadata | Read fully
lib/db/src/index.ts | index.ts | code | DB runtime / index | Read fully
lib/db/src/schema/ai_chats.ts | ai_chats.ts | code | DB schema / table | Read fully
lib/db/src/schema/ai_provider_credentials.ts | ai_provider_credentials.ts | code | DB schema / table | Read fully
lib/db/src/schema/audit_logs.ts | audit_logs.ts | code | DB schema / table | Read fully
lib/db/src/schema/discovery.ts | discovery.ts | code | DB schema / table | Read fully
lib/db/src/schema/events.ts | events.ts | code | DB schema / table | Read fully
lib/db/src/schema/graph.ts | graph.ts | code | DB schema / table | Read fully
lib/db/src/schema/index.ts | index.ts | code | DB schema / table | Read fully
lib/db/src/schema/metrics.ts | metrics.ts | code | DB schema / table | Read fully
lib/db/src/schema/plugins.ts | plugins.ts | code | DB schema / table | Read fully
lib/db/src/schema/projects.ts | projects.ts | code | DB schema / table | Read fully
lib/db/src/schema/rate_limits.ts | rate_limits.ts | code | DB schema / table | Read fully
lib/db/src/schema/rules.ts | rules.ts | code | DB schema / table | Read fully
lib/db/src/schema/scan_jobs.ts | scan_jobs.ts | code | DB schema / table | Read fully
lib/db/src/schema/task_logs.ts | task_logs.ts | code | DB schema / table | Read fully
lib/db/src/schema/tasks.ts | tasks.ts | code | DB schema / table | Read fully
lib/db/src/schema/uploads.ts | uploads.ts | code | DB schema / table | Read fully
lib/db/src/schema/workflows.ts | workflows.ts | code | DB schema / table | Read fully
lib/db/tsconfig.json | tsconfig.json | config/text | Workspace config or root metadata | Read fully
lib/knowledge-engine/package.json | package.json | config/text | Workspace config or root metadata | Read fully
lib/knowledge-engine/src/__tests__/inference.test.ts | inference.test.ts | code | Knowledge engine unit test | Read fully
lib/knowledge-engine/src/__tests__/queries.test.ts | queries.test.ts | code | Knowledge engine unit test | Read fully
lib/knowledge-engine/src/index.ts | index.ts | code | Knowledge engine module | Read fully
lib/knowledge-engine/src/inference.ts | inference.ts | code | Knowledge engine module | Read fully
lib/knowledge-engine/src/queries.ts | queries.ts | code | Knowledge engine module | Read fully
lib/knowledge-engine/src/types.ts | types.ts | code | Knowledge engine module | Read fully
lib/knowledge-engine/tsconfig.json | tsconfig.json | config/text | Workspace config or root metadata | Read fully
lib/scanner/package.json | package.json | config/text | Workspace config or root metadata | Read fully
lib/scanner/src/__tests__/file-walker.test.ts | file-walker.test.ts | code | Scanner unit test | Read fully
lib/scanner/src/__tests__/graph-extractor.test.ts | graph-extractor.test.ts | code | Scanner unit test | Read fully
lib/scanner/src/__tests__/metrics-calc.test.ts | metrics-calc.test.ts | code | Scanner unit test | Read fully
lib/scanner/src/__tests__/rule-matcher.test.ts | rule-matcher.test.ts | code | Scanner unit test | Read fully
lib/scanner/src/file-walker.ts | file-walker.ts | code | Scanner module | Read fully
lib/scanner/src/graph-extractor.ts | graph-extractor.ts | code | Scanner module | Read fully
lib/scanner/src/index.ts | index.ts | code | Scanner module | Read fully
lib/scanner/src/metrics-calc.ts | metrics-calc.ts | code | Scanner module | Read fully
lib/scanner/src/python-ast-script.py | python-ast-script.py | code | Scanner module | Read fully
lib/scanner/src/python-ast-script.ts | python-ast-script.ts | code | Scanner module | Read fully
lib/scanner/src/python-extractor.ts | python-extractor.ts | code | Scanner module | Read fully
lib/scanner/src/rule-matcher.ts | rule-matcher.ts | code | Scanner module | Read fully
lib/scanner/tsconfig.json | tsconfig.json | config/text | Workspace config or root metadata | Read fully
lib/scanner/vitest.config.ts | vitest.config.ts | code | Workspace config or root metadata | Read fully

### `package.json` (1 ملفًا)
package.json | package.json | config/text | Workspace config or root metadata | Read fully

### `pnpm-lock.yaml` (1 ملفًا)
pnpm-lock.yaml | pnpm-lock.yaml | config/text | Workspace config or root metadata | Read fully

### `pnpm-workspace.yaml` (1 ملفًا)
pnpm-workspace.yaml | pnpm-workspace.yaml | config/text | Workspace config or root metadata | Read fully

### `replit.md` (1 ملفًا)
replit.md | replit.md | documentation | Workspace config or root metadata | Read fully

### `scripts` (8 ملفًا)
scripts/check-codegen-drift.ts | check-codegen-drift.ts | code | Workspace tooling / validation | Read fully
scripts/package.json | package.json | config/text | Workspace tooling / validation | Read fully
scripts/post-merge.sh | post-merge.sh | code | Workspace tooling / validation | Read fully
scripts/src/hello.ts | hello.ts | code | Workspace tooling / validation | Read fully
scripts/trigger-scan.mts | trigger-scan.mts | code | Workspace tooling / validation | Read fully
scripts/tsconfig.json | tsconfig.json | config/text | Workspace tooling / validation | Read fully
scripts/validate-truth-flow.ts | validate-truth-flow.ts | code | Workspace tooling / validation | Read fully
scripts/verify-setup.sh | verify-setup.sh | code | Workspace tooling / validation | Read fully

### `tsconfig.base.json` (1 ملفًا)
tsconfig.base.json | tsconfig.base.json | config/text | Workspace config or root metadata | Read fully

### `tsconfig.base.json.bak` (1 ملفًا)
tsconfig.base.json.bak | tsconfig.base.json.bak | other | Workspace config or root metadata | Read fully

### `tsconfig.json` (1 ملفًا)
tsconfig.json | tsconfig.json | config/text | Workspace config or root metadata | Read fully

### ملاحظات ختامية
إذا كانت أي معلومة أعلاه لا يمكن إثباتها مباشرة من الملفات، فقد سُجّلت بصيغة حذرة بدلًا من تخمينها.
مهم: ملف المفتاح الخاص في الجذر يجب التعامل معه كحادث أمني حتى يثبت العكس.
# سجل الحالة الرسمي لمشروع EngineeringOS

**المرجع:** تحليل مباشر من داخل المستودع الحالي  
**النطاق:** `package.json`، `replit.md`، `lib/api-spec/openapi.yaml`، `lib/db/src/schema/*`، `artifacts/api-server/src/*`، `artifacts/dashboard/src/*`، `lib/scanner/src/*`، `lib/knowledge-engine/src/*`، `lib/ai-orchestrator/src/*`، `scripts/check-codegen-drift.ts`، `docs/fact-record.md`، `docs/completion-plan.md`، `.agents/memory/*`

**مؤشرات بنيوية سريعة من الكود:**
- 12 حزمة/workspaces رئيسية
- 47 مسار API
- 59 schema داخل OpenAPI
- 14 ملف schema لقاعدة البيانات
- 20 ملف route في API server
- 15 صفحة في dashboard
- 14 ملف اختبار واضح
- OpenAPI هو المصدر المرجعي للعقود
- التوليد الآلي محروس بسكربت drift check
- queue التشغيل الخلفية الحالية in-process ومحدودة التزامن

---

## جدول الحالة

| المحور | مكتمل | جزئي | مفقود | الدليل | الأثر | الخطوة التالية |
|---|---:|---:|---:|---|---|---|
| مرجع العقود API-first | ✓ |  |  | `lib/api-spec/openapi.yaml` + `replit.md` يقرران أن OpenAPI هو مصدر الحقيقة، و`package.json` يفرض `codegen` و`codegen:check`. | يمنع بناء أنواع/واجهات منفصلة عن المرجع. | الاستمرار في منع أي تعديل لا يمر عبر `openapi.yaml`. |
| توليد Zod وReact Query من العقد | ✓ |  |  | وجود `lib/api-zod/src/generated/` و`lib/api-client-react/src/generated/` مع أوامر التوليد في الجذر. | يرفع الاتساق بين الخادم والواجهة ويقلل drift اليدوي. | إبقاء أي تغيير في العقد مقترنًا بإعادة توليد ومراجعة الناتج. |
| حراسة drift بين المصدر والمشتق | ✓ |  |  | `scripts/check-codegen-drift.ts` + `package.json#codegen:check`. | يمنع الانحراف الصامت بين `openapi.yaml` والمخرجات المولدة. | توسيع الفكرة نفسها إلى طبقات أخرى إن لزم (مثل DB/Docs). |
| قاعدة البيانات والكيانات الأساسية | ✓ |  |  | `lib/db/src/schema/*` يحتوي `projects`, `tasks`, `rules`, `workflows`, `events`, `metrics`, `graph`, `scan_jobs`, `discovery`, `audit_logs`, `task_logs`, `plugins`, `ai_chats`. | يثبت أن المنظومة تملك ذاكرة تشغيلية كاملة نسبيًا وليست CRUD بسيطًا. | تثبيت أي قيود/حقول معنوية إضافية فقط إذا كانت تعزز invariants. |
| FKs والقيود البنيوية | ✓ |  |  | `docs/completion-plan.md` يذكر اكتمال Phase 1: FKs لـ `events.taskId`, `events.workflowId`, `scan_jobs.projectId`, `discovery_sessions.importedProjectId`. | يقلل الأيتام ويقوي اتساق البيانات بين الطبقات. | مراجعة الحقول المعنوية المؤجلة فقط إذا ظهرت حاجة تشغيلية واضحة. |
| Backend execution hardening | ✓ |  |  | `artifacts/api-server/src/routes/discovery.ts`, `tasks.ts`, `workflows.ts`, `scan-runner.ts` مع transactional writes وatomic claims؛ ووثيقة completion-plan تثبت اكتمال Phase 2. | يمنع الحالات النصفية والسباقات أثناء discovery/scan/task/workflow. | الإبقاء على نفس النمط في أي مسار mutating جديد. |
| Scanner / graph extraction depth |  | ✓ |  | `lib/scanner/src/*` + `docs/completion-plan.md` Phase 3 يذكر AST TS/JS + Python batched subprocess + regex fallback؛ وبعض التحسينات المؤجلة. | يعطي فحصًا قويًا، لكن ما زالت هناك مساحة لتقليل الاعتماد على fallback. | تعميق التغطية للأشكال/اللغات/الأنماط التي ما تزال تعتمد على heuristics. |
| Knowledge graph / knowledge engine |  | ✓ |  | `lib/knowledge-engine/src/*` و`lib/knowledge-engine/package.json` و`docs/completion-plan.md` Phase 4. | يحول graph من تخزين علاقات إلى طبقة استدلال/impact/path/clustering. | زيادة عمق الاستدلال وربطه أكثر بسياقات project/task/event. |
| Workflow orchestration engine |  | ✓ |  | `artifacts/api-server/src/routes/workflows.ts` + `workflows.test.ts` + `docs/completion-plan.md` Phase 5 يذكر أن branching/conditional phases ما تزال مؤجلة. | المنصة تدير workflows فعليًا، لكن ما زالت بعض قدرات orchestration المتقدمة غير مفعلة. | تنفيذ تقييم `phases[].condition` فقط إذا أصبح branching مطلوبًا فعليًا. |
| Traceability: audit / events / task logs / metrics | ✓ |  |  | `artifacts/api-server/src/routes/*` + `lib/db/src/schema/{audit_logs,events,task_logs,metrics}.ts` + `completion-plan` Phase 6. | كل transition تقريبًا يترك أثرًا قابلًا للتتبع والتدقيق. | الحفاظ على coherence بين الأثر التشغيلي والتاريخ الزمني والـ correlation ids. |
| `correlationId` في العقود الرسمية |  | ✓ |  | `artifacts/api-server/src/routes/events.ts` يدعمه، و`docs/completion-plan.md` يذكر أنه غير ممثل بالكامل في `openapi.yaml`. | القدرة موجودة في التنفيذ، لكن العميل المولّد لا يراها كقدرة رسمية بالكامل. | إضافة الحقل/الفلتر إلى OpenAPI ثم إعادة التوليد. |
| AI orchestration |  | ✓ |  | `lib/ai-orchestrator/src/*` + `artifacts/api-server/src/routes/ai.ts` + `lib/db/src/schema/ai_chats.ts` و`ai_chat_messages.ts` + `ai.ts` page في dashboard. | يثبت وجود طبقة وكلاء وتحليل، لكن ليس بعد policy engine نهائي. | توسيع الضبط: متى يرد، متى يقترح، متى يحتاج مراجعة بشرية. |
| AI auto-trigger عند حالة `verifying` |  | ✓ |  | `docs/completion-plan.md` يذكر أن endpoint التنفيذ موجود لكن الاستدعاء التلقائي عند `verifying` ما زال مؤجلًا. | يقلل أتمتة الانتقال الطبيعي من الحالة إلى التنفيذ المساند. | ربط transition في tasks hook باستدعاء تلقائي مضبوط إذا ثبتت الحاجة. |
| Authentication / access control |  | ✓ |  | `replit.md` يذكر Clerk، و`completion-plan` يحدد أن أي مستخدم مسجل يملك وصولًا كاملًا، مع غياب `ownerId/teamId` و`authorizeProjectAccess`. | الوصول محمي فقط على مستوى الدخول، لا على مستوى الملكية/المشروع. | إضافة owner-scoped access ثم project membership/ACL عند الحاجة. |
| Test coverage |  | ✓ |  | `artifacts/api-server/src/routes/*.test.ts`, `lib/scanner/src/*.test.ts`, `lib/api-server/src/lib/*.test.ts`؛ ووثيقة الخطة تذكر فجوات في `ai`, `events`, `rules`, `dashboard`, `health`. | الاختبارات موجودة ومفيدة، لكنها لا تغطي كل الأسطح الحرجة بعد. | توسيع الاختبارات لتغطي المناطق الأعلى أثرًا والحدود السلوكية. |
| Dashboard / presentation layer |  | ✓ |  | `artifacts/dashboard/src/pages/*` (15 صفحة) تشمل `Dashboard`, `Projects`, `ProjectDetail`, `Tasks`, `Rules`, `Workflows`, `Events`, `Metrics`, `Graph`, `AiChat`, `DiscoverProjectWizard`. | الواجهة تعكس بنية داخلية حقيقية، لكنها ما زالت تحتاج تعميق “لغة الحقيقة” بدل عرض البيانات فقط. | إبراز الحالة، درجة الثقة، الفجوات، وآخر حدث مهم في ملخص المشروع. |
| Documentation / fact record / plan | ✓ |  |  | `docs/fact-record.md`, `docs/completion-plan.md`, `.agents/memory/*`. | يوجد سجل حقيقة وخطة ترتيب وتراكم قرارات، ما يمنع التقدير المرتجل. | إبقاء الوثائق محدثة مع أي تغيير في الكود أو العقد. |
| Memory of engineering decisions | ✓ |  |  | `.agents/memory/MEMORY.md` وروابطه الداخلية لمذكرات القرار (discovery, audit, scanner, AI, codegen drift, testing gotchas...). | يحول القرارات السابقة إلى معرفة قابلة للاستدعاء بدل تكرار اكتشافها. | معالجة أي تعارض بين الذاكرة والتطبيق عبر تحديث المرجع لا عبر تراكم نسخ متعارضة. |
| Durable job queue |  |  | ✓ | `replit.md` و`docs/completion-plan.md` يصرحان بأن `heavyJobQueue` in-process ومحدود التزامن، وأن queue الدائمة الخارجية مؤجلة. | أي crash قد يفقد jobs المنتظرة؛ recovery الحالي يعالج/يفشل أكثر مما يستأنف. | إن أصبحت الديمومة مطلبًا، نقلها إلى queue خارجية مع worker منفصل. |

---

## الحكم التشغيلي المختصر

المنظومة **مكتملة وظيفيًا في مركزها**: العقود، قاعدة البيانات، scanner، backend execution، traceability، والذاكرة المرجعية كلها موجودة وتعمل كطبقات حقيقية.  
لكنها **جزئية في حدودها النهائية**: الملكية والصلاحيات، بعض أسطح الاختبار، بعض قدرات AI automation، وبعض السلوكيات المتقدمة في orchestration وdurability ما زالت بحاجة إغلاق.

### ترتيب الإغلاق الأعلى أثرًا
1. **الملكية والصلاحيات داخل المشروع**
2. **توسيع الاختبارات للأسطح الحرجة**
3. **إكمال تمثيل `correlationId` في العقود**
4. **تعميق أتمتة AI في نقاط الانتقال الطبيعية**
5. **تعميق scanner/knowledge graph فقط حيث توجد فجوة فعلية**
6. **رفع الديمومة التشغيلية إذا أصبحت jobs الخلفية جزءًا حرجًا من المنتج**

---

## الخلاصة
EngineeringOS ليس مشروعًا ناقصًا في “الفكرة”؛ هو مشروع **متقدم في النواة، وجزئي في الإغلاق النهائي**.  
كل ما هو أساسي موجود تقريبًا، وما تبقى هو تحويل هذا الموجود إلى **حدود واضحة، إثباتات أقوى، وتفويض محكوم**.
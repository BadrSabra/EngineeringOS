# EngineeringOS — سجل حقيقة منظّم ملفًا ملفًا

_آخر تحقق: 2026-07-11، اعتمادًا على الأرشيف المرفوع نفسه._

هذا السجل يصف **ما يوجد** و**ما ينقص** و**الأثر** و**الأولوية** لكل ملف ظاهر في الأرشيف. الأوصاف هنا عملية ومختصرة، وتُعامل ملفات التوليد والأصول المكررة باعتبارها جزءًا من السطح الفعلي الذي يجب تتبعه.

## إحصاءات سريعة

- إجمالي الملفات: **345**
- أكبر كتلة: `artifacts/dashboard` بعدد **82** ملفًا
- ثاني أكبر كتلة: `lib/api-zod` بعدد **76** ملفًا
- ثالث أكبر كتلة: `artifacts/mockup-sandbox` بعدد **69** ملفًا

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

### docs (2)

| الملف | الموجود | الناقص | الأثر | الأولوية | الدليل |
|---|---|---|---|---|---|
| docs/completion-plan.md | خطة مرحلية رسمية لترتيب الاستكمال من الداخل إلى الخارج. | يحتاج مواءمة مع أي تغيّر في الأسبقيات. | يحدد التسلسل الصحيح للتطوير. | High | docs/completion-plan.md |
| docs/fact-record.md | سجل حقيقة معتمد يصف ما يوجد وما ينقص طبقةً طبقة. | يجب تحديثه كلما تغيّر الكود أو العقد. | يمنع بناء قرارات على افتراضات قديمة. | High | docs/fact-record.md |

### .agents/memory (7)

| الملف | الموجود | الناقص | الأثر | الأولوية | الدليل |
|---|---|---|---|---|---|
| .agents/memory/MEMORY.md | مذكرة قرار/ذاكرة تشغيلية للجانب الهندسي. | تحتاج البقاء متوافقة مع الكود والوثائق الرسمية. | تحفظ القرارات والقواعد بين الجلسات. | Medium | .agents/memory/MEMORY.md |
| .agents/memory/audit-fixes.md | مذكرة قرار/ذاكرة تشغيلية للجانب الهندسي. | تحتاج البقاء متوافقة مع الكود والوثائق الرسمية. | تحفظ القرارات والقواعد بين الجلسات. | Medium | .agents/memory/audit-fixes.md |
| .agents/memory/discovery-feature.md | مذكرة قرار/ذاكرة تشغيلية للجانب الهندسي. | تحتاج البقاء متوافقة مع الكود والوثائق الرسمية. | تحفظ القرارات والقواعد بين الجلسات. | Medium | .agents/memory/discovery-feature.md |
| .agents/memory/engineeringos-completion-plan.md | مذكرة قرار/ذاكرة تشغيلية للجانب الهندسي. | تحتاج البقاء متوافقة مع الكود والوثائق الرسمية. | تحفظ القرارات والقواعد بين الجلسات. | Medium | .agents/memory/engineeringos-completion-plan.md |
| .agents/memory/fk-atomic-claim-ordering.md | مذكرة قرار/ذاكرة تشغيلية للجانب الهندسي. | تحتاج البقاء متوافقة مع الكود والوثائق الرسمية. | تحفظ القرارات والقواعد بين الجلسات. | Medium | .agents/memory/fk-atomic-claim-ordering.md |
| .agents/memory/scanner-ast-extraction.md | مذكرة قرار/ذاكرة تشغيلية للجانب الهندسي. | تحتاج البقاء متوافقة مع الكود والوثائق الرسمية. | تحفظ القرارات والقواعد بين الجلسات. | Medium | .agents/memory/scanner-ast-extraction.md |
| .agents/memory/testing-drift-checks.md | مذكرة قرار/ذاكرة تشغيلية للجانب الهندسي. | تحتاج البقاء متوافقة مع الكود والوثائق الرسمية. | تحفظ القرارات والقواعد بين الجلسات. | Medium | .agents/memory/testing-drift-checks.md |

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

### lib/api-zod (76)

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
| lib/api-zod/src/index.ts | إعادة تصدير لأنواع/schemas المولدة. | لا نقص مستقل ظاهر. | يدعم استيرادًا موحدًا. | Medium | lib/api-zod/src/index.ts |
| lib/api-zod/tsconfig.json | إعداد TypeScript للحزمة. | لا نقص مستقل ظاهر. | يدعم التحقق والتجميع. | Medium | lib/api-zod/tsconfig.json |

### lib/db/src/schema (13)

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

### lib/scanner (12)

| الملف | الموجود | الناقص | الأثر | الأولوية | الدليل |
|---|---|---|---|---|---|
| lib/scanner/package.json | ملف مساند داخل scanner. | يتحدد حسب الاستهلاك. | يسهم في التحليل. | Medium | lib/scanner/package.json |
| lib/scanner/src/__tests__/file-walker.test.ts | ملف مساند داخل scanner. | يتحدد حسب الاستهلاك. | يسهم في التحليل. | Medium | lib/scanner/src/__tests__/file-walker.test.ts |
| lib/scanner/src/__tests__/graph-extractor.test.ts | اختبارات لاستخراج الرسم والعلاقات. | تحتاج تغطية أوسع لحواف اللغات والبنية. | تثبت صحة AST extraction. | Medium | lib/scanner/src/__tests__/graph-extractor.test.ts |
| lib/scanner/src/__tests__/metrics-calc.test.ts | اختبارات حساب المقاييس. | قد تحتاج حالات بيانات أكثر تنوعًا. | تحقق عدالة حسابات الجودة. | Medium | lib/scanner/src/__tests__/metrics-calc.test.ts |
| lib/scanner/src/__tests__/rule-matcher.test.ts | اختبارات مطابقة القواعد. | تحتاج حالات حدودية إضافية. | تثبت heuristics المطابقة. | Medium | lib/scanner/src/__tests__/rule-matcher.test.ts |
| lib/scanner/src/file-walker.ts | يمشي على الملفات مع حدود استثناء/حجم. | قد يحتاج اتساعًا لأنماط المشاريع المختلفة. | مصدر المدخلات للمحلل. | High | lib/scanner/src/file-walker.ts |
| lib/scanner/src/graph-extractor.ts | يستخرج كيانات وعلاقات TS/JS عبر AST. | Python ما يزال heuristic/regex. | يبني المعرفة البنيوية. | High | lib/scanner/src/graph-extractor.ts |
| lib/scanner/src/index.ts | واجهة تصدير للحزمة scanner. | لا نقص مستقل ظاهر. | مدخل موحد للمكتبة. | Medium | lib/scanner/src/index.ts |
| lib/scanner/src/metrics-calc.ts | يحسب درجات الجودة/الدين/التغطية. | يحتاج معايرة مستمرة. | يحوّل الإشارات إلى رقم قابل للقراءة. | High | lib/scanner/src/metrics-calc.ts |
| lib/scanner/src/rule-matcher.ts | يطابق القواعد على النص/المحتوى. | ما يزال regex-driven. | يحدد المخالفات/الإشارات. | High | lib/scanner/src/rule-matcher.ts |
| lib/scanner/tsconfig.json | ملف مساند داخل scanner. | يتحدد حسب الاستهلاك. | يسهم في التحليل. | Medium | lib/scanner/tsconfig.json |
| lib/scanner/vitest.config.ts | ملف مساند داخل scanner. | يتحدد حسب الاستهلاك. | يسهم في التحليل. | Medium | lib/scanner/vitest.config.ts |

### artifacts/api-server (27)

| الملف | الموجود | الناقص | الأثر | الأولوية | الدليل |
|---|---|---|---|---|---|
| artifacts/api-server/.replit-artifact/artifact.toml | ملف backend داعم. | يُراجع حسب دوره المباشر. | يسهم في التنفيذ. | Medium | artifacts/api-server/.replit-artifact/artifact.toml |
| artifacts/api-server/build.mjs | ملف backend داعم. | يُراجع حسب دوره المباشر. | يسهم في التنفيذ. | Medium | artifacts/api-server/build.mjs |
| artifacts/api-server/package.json | ملف backend داعم. | يُراجع حسب دوره المباشر. | يسهم في التنفيذ. | Medium | artifacts/api-server/package.json |
| artifacts/api-server/src/app.ts | تهيئة Express وتسجيل الوسطاء والمسارات. | يجب أن يبقى متسقًا مع routes الفعلية. | نواة الخادم. | High | artifacts/api-server/src/app.ts |
| artifacts/api-server/src/index.ts | نقطة تشغيل الخادم. | لا نقص مستقل ظاهر. | يشغّل API server. | High | artifacts/api-server/src/index.ts |
| artifacts/api-server/src/lib/.gitkeep | ملف حارس لمجلد فارغ. | لا شيء؛ placeholder فقط. | يحافظ على وجود المجلد في النسخة. | Low | artifacts/api-server/src/lib/.gitkeep |
| artifacts/api-server/src/lib/audit.ts | مساعد audit للعمليات الحساسة. | best-effort وليس transaction-bound. | يوثق التغييرات المهمة. | Medium | artifacts/api-server/src/lib/audit.ts |
| artifacts/api-server/src/lib/logger.ts | إعداد logging موحد. | يحتاج اتساقًا مع traceability الشاملة. | يسهل التتبع والتشخيص. | Medium | artifacts/api-server/src/lib/logger.ts |
| artifacts/api-server/src/lib/scan-runner.ts | pipeline كاملة: walk → match → graph → metrics → persist. | أصبح all-or-nothing؛ لا يحتفظ بنتائج جزئية عند الفشل. | يضمن سلامة تشغيل الفحص. | High | artifacts/api-server/src/lib/scan-runner.ts |
| artifacts/api-server/src/middlewares/.gitkeep | ملف حارس لمجلد فارغ. | لا شيء؛ placeholder فقط. | يحافظ على وجود المجلد في النسخة. | Low | artifacts/api-server/src/middlewares/.gitkeep |
| artifacts/api-server/src/routes/dashboard.ts | endpoint لبيانات dashboard العامة. | قد يحتاج اتساعًا حسب ما تعرضه الواجهة. | يغذي الصفحة الرئيسية. | Medium | artifacts/api-server/src/routes/dashboard.ts |
| artifacts/api-server/src/routes/discovery.test.ts | اختبارات endpoints وسلوك الخادم. | تحتاج توسيعًا في العقد والجراف وworkflow phases. | تحمي من regressions. | Medium | artifacts/api-server/src/routes/discovery.test.ts |
| artifacts/api-server/src/routes/discovery.ts | إدارة discovery/import وخطواته. | حواف الفشل الجزئي تحتاج ربطًا دائمًا بالاختبارات. | يدخل المشاريع إلى المنصة. | High | artifacts/api-server/src/routes/discovery.ts |
| artifacts/api-server/src/routes/events.ts | قراءة/تصفية الأحداث. | يحتاج مواءمة أقوى مع التتبع الموحد. | يعرض سجل التشغيل. | Medium | artifacts/api-server/src/routes/events.ts |
| artifacts/api-server/src/routes/graph.ts | إدارة entities/relationships وneighbors. | neighbors غير منعكس في OpenAPI/الواجهة. | طبقة المعرفة. | High | artifacts/api-server/src/routes/graph.ts |
| artifacts/api-server/src/routes/health.ts | فحص صحة الخدمة. | لا نقص مستقل ظاهر. | يعطي readiness سريع. | Low | artifacts/api-server/src/routes/health.ts |
| artifacts/api-server/src/routes/index.ts | نقطة تشغيل الخادم. | لا نقص مستقل ظاهر. | يشغّل API server. | High | artifacts/api-server/src/routes/index.ts |
| artifacts/api-server/src/routes/metrics.ts | قراءة المقاييس. | يحتاج ربطًا أوضح مع العمليات الأساسية. | يعرض صحة النظام. | Medium | artifacts/api-server/src/routes/metrics.ts |
| artifacts/api-server/src/routes/plugins.ts | إدارة الإضافات. | يتطلب ضبطًا أدق للحياة التشغيلية. | يسمح بالتوسعة. | Medium | artifacts/api-server/src/routes/plugins.ts |
| artifacts/api-server/src/routes/projects.test.ts | اختبارات endpoints وسلوك الخادم. | تحتاج توسيعًا في العقد والجراف وworkflow phases. | تحمي من regressions. | Medium | artifacts/api-server/src/routes/projects.test.ts |
| artifacts/api-server/src/routes/projects.ts | CRUD وإدارة المشاريع. | يحتاج اتساقًا تامًا مع schema والـ audit. | مدخل البيانات الأساسية. | High | artifacts/api-server/src/routes/projects.ts |
| artifacts/api-server/src/routes/rules.ts | CRUD/تقييم القواعد. | يحتاج مزيدًا من اختبارات التكامل. | يحكم سياسة الفحص. | High | artifacts/api-server/src/routes/rules.ts |
| artifacts/api-server/src/routes/tasks.ts | إدارة tasks مع execute/retry/rollback. | لا يوجد saga عبر مهام متعددة. | محور التنفيذ. | High | artifacts/api-server/src/routes/tasks.ts |
| artifacts/api-server/src/routes/workflows.test.ts | اختبارات endpoints وسلوك الخادم. | تحتاج توسيعًا في العقد والجراف وworkflow phases. | تحمي من regressions. | Medium | artifacts/api-server/src/routes/workflows.test.ts |
| artifacts/api-server/src/routes/workflows.ts | إدارة workflows مع advance/fail-phase/retry-phase. | condition branching غير مفعّل. | محرك orchestration. | High | artifacts/api-server/src/routes/workflows.ts |
| artifacts/api-server/tsconfig.json | ملف backend داعم. | يُراجع حسب دوره المباشر. | يسهم في التنفيذ. | Medium | artifacts/api-server/tsconfig.json |
| artifacts/api-server/vitest.config.ts | ملف إعداد/بناء للحزمة. | لا نقص مستقل ظاهر. | يدعم البناء والتشغيل. | Medium | artifacts/api-server/vitest.config.ts |

### artifacts/dashboard (82)

| الملف | الموجود | الناقص | الأثر | الأولوية | الدليل |
|---|---|---|---|---|---|
| artifacts/dashboard/.replit-artifact/artifact.toml | ملف واجهة داعم. | يُراجع حسب الاستهلاك. | يسهم في التجربة البصرية. | Low | artifacts/dashboard/.replit-artifact/artifact.toml |
| artifacts/dashboard/components.json | ملف واجهة داعم. | يُراجع حسب الاستهلاك. | يسهم في التجربة البصرية. | Low | artifacts/dashboard/components.json |
| artifacts/dashboard/index.html | ملف واجهة داعم. | يُراجع حسب الاستهلاك. | يسهم في التجربة البصرية. | Low | artifacts/dashboard/index.html |
| artifacts/dashboard/package.json | ملف واجهة داعم. | يُراجع حسب الاستهلاك. | يسهم في التجربة البصرية. | Low | artifacts/dashboard/package.json |
| artifacts/dashboard/public/favicon.svg | ملف واجهة داعم. | يُراجع حسب الاستهلاك. | يسهم في التجربة البصرية. | Low | artifacts/dashboard/public/favicon.svg |
| artifacts/dashboard/public/robots.txt | ملف واجهة داعم. | يُراجع حسب الاستهلاك. | يسهم في التجربة البصرية. | Low | artifacts/dashboard/public/robots.txt |
| artifacts/dashboard/src/App.tsx | ملف واجهة داعم. | يُراجع حسب الاستهلاك. | يسهم في التجربة البصرية. | Low | artifacts/dashboard/src/App.tsx |
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
| artifacts/dashboard/src/pages/not-found.tsx | ملف واجهة داعم. | يُراجع حسب الاستهلاك. | يسهم في التجربة البصرية. | Low | artifacts/dashboard/src/pages/not-found.tsx |
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

### attached_assets (29)

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

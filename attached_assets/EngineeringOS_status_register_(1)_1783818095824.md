# سجل الحالة الرسمي — EngineeringOS

هذا السجل يصف حالة الملفات التنفيذية والمؤثرة في الحزمة الحالية بصيغة: **منجز / جزئي / مفقود / الدليل / الأثر / الخطوة التالية**.

**ملاحظة منهجية:** تم تفصيل الملفات المؤثرة في التشغيل والعمارة والاختبار. الملفات المتكررة جدًا من مكتبة الواجهة الأساسية (UI primitives) لم تُفرد واحدًا واحدًا هنا لأنها شبيهة في الدور وموروثة من scaffolding، ويمكن إضافتها كملحق مستقل إذا أردت نسخة أشد شمولًا.

| الملف | الحالة | الدليل | الأثر | الخطوة التالية |
|---|---|---|---|---|
| `package.json` | منجز | Scripts for codegen, codegen:check, build, typecheck, and test are present and wired to workspaces. | يوحّد دورة التحقق والتوليد عبر المستودع. | حافظ على توافق السكربتات مع أي مسارات جديدة. |
| `pnpm-workspace.yaml` | منجز | Workspace packages and supply-chain minimumReleaseAge are enforced. | يحمي سلسلة التوريد ويثبت حدود الحزم المسموح بها. | راجع exclusions فقط عند الحاجة وبشكل مؤقت. |
| `replit.md` | منجز | Operational runbook documents run, build, codegen, stack, and architecture decisions. | يوجه التشغيل والصيانة ويختصر onboarding. | أبقِه مواكبًا لأوامر التشغيل الفعلية. |
| `tsconfig.json` | منجز | Project references point to db, api-client-react, api-zod, and scanner. | يبقي البناء الموزع منظمًا ويمنع الانفصال بين الحزم. | أضف أي package جديدة إلى references فورًا. |
| `docs/completion-plan.md` | منجز | A phased completion plan exists and matches the current multi-layer execution model. | يحوّل المشروع إلى خطة تشغيلية قابلة للمتابعة. | حدّثه بعد كل إغلاق مرحلة. |
| `docs/fact-record.md` | منجز | Truth log / fact record is present for file-level verification. | يوثق الواقع الحالي ويمنع الانحراف بين الوثيقة والكود. | أعد مزامنته عند أي تغيير هيكلي. |
| `.agents/memory/MEMORY.md` | منجز | Operational memory note exists in .agents/memory. | يحفظ قرارات التنفيذ والسياق التشغيلي لوكلاء لاحقين. | راجعها عند تحديث سياسة العمل أو الوصول. |
| `.agents/memory/audit-fixes.md` | منجز | Operational memory note exists in .agents/memory. | يحفظ قرارات التنفيذ والسياق التشغيلي لوكلاء لاحقين. | راجعها عند تحديث سياسة العمل أو الوصول. |
| `.agents/memory/clerk-auth-testing.md` | منجز | Operational memory note exists in .agents/memory. | يحفظ قرارات التنفيذ والسياق التشغيلي لوكلاء لاحقين. | راجعها عند تحديث سياسة العمل أو الوصول. |
| `.agents/memory/discovery-feature.md` | جزئي | Operational memory note exists in .agents/memory. | يحفظ قرارات التنفيذ والسياق التشغيلي لوكلاء لاحقين. | راجعها عند تحديث سياسة العمل أو الوصول. |
| `.agents/memory/drizzle-error-wrapping.md` | منجز | Operational memory note exists in .agents/memory. | يحفظ قرارات التنفيذ والسياق التشغيلي لوكلاء لاحقين. | راجعها عند تحديث سياسة العمل أو الوصول. |
| `.agents/memory/engineeringos-completion-plan.md` | جزئي | Operational memory note exists in .agents/memory. | يحفظ قرارات التنفيذ والسياق التشغيلي لوكلاء لاحقين. | راجعها عند تحديث سياسة العمل أو الوصول. |
| `.agents/memory/fk-atomic-claim-ordering.md` | منجز | Operational memory note exists in .agents/memory. | يحفظ قرارات التنفيذ والسياق التشغيلي لوكلاء لاحقين. | راجعها عند تحديث سياسة العمل أو الوصول. |
| `.agents/memory/imported-project-workflow-failures.md` | جزئي | Operational memory note exists in .agents/memory. | يحفظ قرارات التنفيذ والسياق التشغيلي لوكلاء لاحقين. | راجعها عند تحديث سياسة العمل أو الوصول. |
| `.agents/memory/orval-openapi-codegen.md` | منجز | Operational memory note exists in .agents/memory. | يحفظ قرارات التنفيذ والسياق التشغيلي لوكلاء لاحقين. | راجعها عند تحديث سياسة العمل أو الوصول. |
| `.agents/memory/scanner-ast-extraction.md` | منجز | Operational memory note exists in .agents/memory. | يحفظ قرارات التنفيذ والسياق التشغيلي لوكلاء لاحقين. | راجعها عند تحديث سياسة العمل أو الوصول. |
| `.agents/memory/testing-drift-checks.md` | جزئي | Operational memory note exists in .agents/memory. | يحفظ قرارات التنفيذ والسياق التشغيلي لوكلاء لاحقين. | راجعها عند تحديث سياسة العمل أو الوصول. |
| `attached_assets/EngineeringOS_Audit_Report_1783641389270.md` | منجز | Audit report artifact exists. | يدعم التتبع والتدقيق الداخلي. | اربطه بإصدارات لاحقة عند الحاجة. |
| `attached_assets/EngineeringOS_Audit_Report_Expanded_1783642792349.md` | منجز | Expanded audit artifact exists. | يغطي الفجوات بصورة أوسع من التقرير المختصر. | أبقِه متسقًا مع fact-record. |
| `attached_assets/EngineeringOS_File_by_File_Fact_Record_1783725698283.md` | منجز | Exported fact record artifact exists. | نسخة مشاركة قابلة للتسليم خارج المستودع. | احتفظ به كمرجع أرشيفي فقط. |
| `attached_assets/EngineeringOS_Implementation_Document_1783726156016.md` | منجز | Implementation artifact exists. | يدعم التسليم والتوثيق المؤسسي. | حدّثه إن تغيّرت الخطة التنفيذية. |
| `attached_assets/EngineeringOS_Project_1783718452179.pdf` | منجز | Project PDF artifact exists. | نسخة قابلة للطباعة/المشاركة. | حافظ على النسخة الأحدث فقط إذا لزم. |
| `attached_assets/EngineeringOS_deep_analysis_report_1783800987828.md` | منجز | Deep analysis artifact exists. | مرجع تنفيذي لتحليل معمّق سابق. | استخدمه كمرجع تاريخي لا كحقيقة تشغيلية وحيدة. |
| `attached_assets/EngineeringOS_file_inventory_(1)_1783729892809.csv` | منجز | Earlier inventory snapshot exists. | يفيد في المقارنة الزمنية. | احتفظ به كمرجع تاريخي. |
| `attached_assets/EngineeringOS_file_inventory_full_1783800987783.csv` | منجز | Full file inventory exists. | يسهّل التحقق والإحصاء السريع. | استبدله إذا تغيّرت الشجرة جذريًا. |
| `attached_assets/EngineeringOS_project_analysis_report(1)_1783729892769.md` | منجز | Project analysis artifact exists. | يساعد على تتبع تطور التحليل. | راجع التناقضات مع النسخ الأحدث. |
| `attached_assets/EngineeringOS_replit_execution_directive_1783800987701.json` | منجز | Execution directive artifact exists in JSON form. | يوثق تعليمات الوكيل التنفيذية. | استخدمه كأساس إنشائي لا كنسخة نهائية إذا تغيرت التعليمات. |
| `attached_assets/EngineeringOS_replit_execution_directive_1783800987743.md` | منجز | Execution directive artifact exists in Markdown form. | أسهل في القراءة والمراجعة البشرية. | أبقِ JSON وMarkdown متطابقين. |
| `attached_assets/EngineeringOS_task_backlog_1783800987875.json` | منجز | Task backlog artifact exists. | يدعم تحويل التحليل إلى مهام قابلة للتنفيذ. | زامن أولوية المهام مع الواقع الحالي. |
| `lib/api-spec/openapi.yaml` | منجز | OpenAPI exists as the single source of truth for API contracts. | يُشغّل codegen ويضمن contract-first discipline. | أضف endpoints فقط عبر هذا الملف ثم أعد التوليد. |
| `lib/api-client-react/src/generated/api.schemas.ts` | منجز | Generated React Query/SDK schema bundle exists. | يوحّد استهلاك العقد في الواجهة. | أعد توليده بعد أي drift في OpenAPI. |
| `lib/api-client-react/src/generated/api.ts` | منجز | Generated client surface exists. | يوفّر hooks/clients موحّدة للواجهة. | راجع drift check دوريًا. |
| `lib/api-zod/src/generated/api.ts` | منجز | Generated Zod schema derived from openapi.yaml. | يوفّر validation/types موحّدة للخادم والعميل. | أعد التوليد عند أي تغيير في العقود. |
| `lib/api-zod/src/generated/createProjectInput.ts` | منجز | Generated Zod schema derived from openapi.yaml. | يوفّر validation/types موحّدة للخادم والعميل. | أعد التوليد عند أي تغيير في العقود. |
| `lib/api-zod/src/generated/createRuleInput.ts` | منجز | Generated Zod schema derived from openapi.yaml. | يوفّر validation/types موحّدة للخادم والعميل. | أعد التوليد عند أي تغيير في العقود. |
| `lib/api-zod/src/generated/createTaskInput.ts` | منجز | Generated Zod schema derived from openapi.yaml. | يوفّر validation/types موحّدة للخادم والعميل. | أعد التوليد عند أي تغيير في العقود. |
| `lib/api-zod/src/generated/createWorkflowInput.ts` | منجز | Generated Zod schema derived from openapi.yaml. | يوفّر validation/types موحّدة للخادم والعميل. | أعد التوليد عند أي تغيير في العقود. |
| `lib/api-zod/src/generated/dashboardOverview.ts` | منجز | Generated Zod schema derived from openapi.yaml. | يوفّر validation/types موحّدة للخادم والعميل. | أعد التوليد عند أي تغيير في العقود. |
| `lib/api-zod/src/generated/dashboardOverviewProjectScoresItem.ts` | منجز | Generated Zod schema derived from openapi.yaml. | يوفّر validation/types موحّدة للخادم والعميل. | أعد التوليد عند أي تغيير في العقود. |
| `lib/api-zod/src/generated/dashboardOverviewProjectScoresItemTrend.ts` | منجز | Generated Zod schema derived from openapi.yaml. | يوفّر validation/types موحّدة للخادم والعميل. | أعد التوليد عند أي تغيير في العقود. |
| `lib/api-zod/src/generated/dashboardOverviewTaskStatusBreakdown.ts` | منجز | Generated Zod schema derived from openapi.yaml. | يوفّر validation/types موحّدة للخادم والعميل. | أعد التوليد عند أي تغيير في العقود. |
| `lib/api-zod/src/generated/dashboardOverviewTopRulesItem.ts` | منجز | Generated Zod schema derived from openapi.yaml. | يوفّر validation/types موحّدة للخادم والعميل. | أعد التوليد عند أي تغيير في العقود. |
| `lib/api-zod/src/generated/discoveryGraphSummaryData.ts` | منجز | Generated Zod schema derived from openapi.yaml. | يوفّر validation/types موحّدة للخادم والعميل. | أعد التوليد عند أي تغيير في العقود. |
| `lib/api-zod/src/generated/discoveryGraphSummaryDataEntitiesByType.ts` | منجز | Generated Zod schema derived from openapi.yaml. | يوفّر validation/types موحّدة للخادم والعميل. | أعد التوليد عند أي تغيير في العقود. |
| `lib/api-zod/src/generated/discoveryGraphSummaryDataFilesByLanguage.ts` | منجز | Generated Zod schema derived from openapi.yaml. | يوفّر validation/types موحّدة للخادم والعميل. | أعد التوليد عند أي تغيير في العقود. |
| `lib/api-zod/src/generated/discoveryReport.ts` | منجز | Generated Zod schema derived from openapi.yaml. | يوفّر validation/types موحّدة للخادم والعميل. | أعد التوليد عند أي تغيير في العقود. |
| `lib/api-zod/src/generated/discoveryRuleViolationItem.ts` | منجز | Generated Zod schema derived from openapi.yaml. | يوفّر validation/types موحّدة للخادم والعميل. | أعد التوليد عند أي تغيير في العقود. |
| `lib/api-zod/src/generated/discoverySessionStatus.ts` | منجز | Generated Zod schema derived from openapi.yaml. | يوفّر validation/types موحّدة للخادم والعميل. | أعد التوليد عند أي تغيير في العقود. |
| `lib/api-zod/src/generated/discoverySessionStatusStatus.ts` | منجز | Generated Zod schema derived from openapi.yaml. | يوفّر validation/types موحّدة للخادم والعميل. | أعد التوليد عند أي تغيير في العقود. |
| `lib/api-zod/src/generated/discoveryStepItem.ts` | منجز | Generated Zod schema derived from openapi.yaml. | يوفّر validation/types موحّدة للخادم والعميل. | أعد التوليد عند أي تغيير في العقود. |
| `lib/api-zod/src/generated/discoveryStepItemStatus.ts` | منجز | Generated Zod schema derived from openapi.yaml. | يوفّر validation/types موحّدة للخادم والعميل. | أعد التوليد عند أي تغيير في العقود. |
| `lib/api-zod/src/generated/entityType.ts` | منجز | Generated Zod schema derived from openapi.yaml. | يوفّر validation/types موحّدة للخادم والعميل. | أعد التوليد عند أي تغيير في العقود. |
| `lib/api-zod/src/generated/evaluateRuleRequest.ts` | منجز | Generated Zod schema derived from openapi.yaml. | يوفّر validation/types موحّدة للخادم والعميل. | أعد التوليد عند أي تغيير في العقود. |
| `lib/api-zod/src/generated/event.ts` | منجز | Generated Zod schema derived from openapi.yaml. | يوفّر validation/types موحّدة للخادم والعميل. | أعد التوليد عند أي تغيير في العقود. |
| `lib/api-zod/src/generated/eventPayload.ts` | منجز | Generated Zod schema derived from openapi.yaml. | يوفّر validation/types موحّدة للخادم والعميل. | أعد التوليد عند أي تغيير في العقود. |
| `lib/api-zod/src/generated/eventSeverity.ts` | منجز | Generated Zod schema derived from openapi.yaml. | يوفّر validation/types موحّدة للخادم والعميل. | أعد التوليد عند أي تغيير في العقود. |
| `lib/api-zod/src/generated/failWorkflowPhaseInput.ts` | منجز | Generated Zod schema derived from openapi.yaml. | يوفّر validation/types موحّدة للخادم والعميل. | أعد التوليد عند أي تغيير في العقود. |
| `lib/api-zod/src/generated/getGraphEntityNeighbors200.ts` | منجز | Generated Zod schema derived from openapi.yaml. | يوفّر validation/types موحّدة للخادم والعميل. | أعد التوليد عند أي تغيير في العقود. |
| `lib/api-zod/src/generated/getGraphEntityNeighbors404.ts` | منجز | Generated Zod schema derived from openapi.yaml. | يوفّر validation/types موحّدة للخادم والعميل. | أعد التوليد عند أي تغيير في العقود. |
| `lib/api-zod/src/generated/getLatestMetricsParams.ts` | منجز | Generated Zod schema derived from openapi.yaml. | يوفّر validation/types موحّدة للخادم والعميل. | أعد التوليد عند أي تغيير في العقود. |
| `lib/api-zod/src/generated/graphEntity.ts` | منجز | Generated Zod schema derived from openapi.yaml. | يوفّر validation/types موحّدة للخادم والعميل. | أعد التوليد عند أي تغيير في العقود. |
| `lib/api-zod/src/generated/graphEntityMetadata.ts` | منجز | Generated Zod schema derived from openapi.yaml. | يوفّر validation/types موحّدة للخادم والعميل. | أعد التوليد عند أي تغيير في العقود. |
| `lib/api-zod/src/generated/graphRelationship.ts` | منجز | Generated Zod schema derived from openapi.yaml. | يوفّر validation/types موحّدة للخادم والعميل. | أعد التوليد عند أي تغيير في العقود. |
| `lib/api-zod/src/generated/graphRelationshipMetadata.ts` | منجز | Generated Zod schema derived from openapi.yaml. | يوفّر validation/types موحّدة للخادم والعميل. | أعد التوليد عند أي تغيير في العقود. |
| `lib/api-zod/src/generated/healthStatus.ts` | منجز | Generated Zod schema derived from openapi.yaml. | يوفّر validation/types موحّدة للخادم والعميل. | أعد التوليد عند أي تغيير في العقود. |
| `lib/api-zod/src/generated/healthStatusStatus.ts` | منجز | Generated Zod schema derived from openapi.yaml. | يوفّر validation/types موحّدة للخادم والعميل. | أعد التوليد عند أي تغيير في العقود. |
| `lib/api-zod/src/generated/importProjectInput.ts` | منجز | Generated Zod schema derived from openapi.yaml. | يوفّر validation/types موحّدة للخادم والعميل. | أعد التوليد عند أي تغيير في العقود. |
| `lib/api-zod/src/generated/importProjectInputOverrides.ts` | منجز | Generated Zod schema derived from openapi.yaml. | يوفّر validation/types موحّدة للخادم والعميل. | أعد التوليد عند أي تغيير في العقود. |
| `lib/api-zod/src/generated/index.ts` | منجز | Generated Zod schema derived from openapi.yaml. | يوفّر validation/types موحّدة للخادم والعميل. | أعد التوليد عند أي تغيير في العقود. |
| `lib/api-zod/src/generated/listEventsParams.ts` | منجز | Generated Zod schema derived from openapi.yaml. | يوفّر validation/types موحّدة للخادم والعميل. | أعد التوليد عند أي تغيير في العقود. |
| `lib/api-zod/src/generated/listGraphEntitiesParams.ts` | منجز | Generated Zod schema derived from openapi.yaml. | يوفّر validation/types موحّدة للخادم والعميل. | أعد التوليد عند أي تغيير في العقود. |
| `lib/api-zod/src/generated/listGraphRelationshipsParams.ts` | منجز | Generated Zod schema derived from openapi.yaml. | يوفّر validation/types موحّدة للخادم والعميل. | أعد التوليد عند أي تغيير في العقود. |
| `lib/api-zod/src/generated/listMetricsParams.ts` | منجز | Generated Zod schema derived from openapi.yaml. | يوفّر validation/types موحّدة للخادم والعميل. | أعد التوليد عند أي تغيير في العقود. |
| `lib/api-zod/src/generated/listRulesParams.ts` | منجز | Generated Zod schema derived from openapi.yaml. | يوفّر validation/types موحّدة للخادم والعميل. | أعد التوليد عند أي تغيير في العقود. |
| `lib/api-zod/src/generated/listTasksParams.ts` | منجز | Generated Zod schema derived from openapi.yaml. | يوفّر validation/types موحّدة للخادم والعميل. | أعد التوليد عند أي تغيير في العقود. |
| `lib/api-zod/src/generated/listWorkflowsParams.ts` | منجز | Generated Zod schema derived from openapi.yaml. | يوفّر validation/types موحّدة للخادم والعميل. | أعد التوليد عند أي تغيير في العقود. |
| `lib/api-zod/src/generated/metricRecord.ts` | منجز | Generated Zod schema derived from openapi.yaml. | يوفّر validation/types موحّدة للخادم والعميل. | أعد التوليد عند أي تغيير في العقود. |
| `lib/api-zod/src/generated/metricRecordBuildStatus.ts` | منجز | Generated Zod schema derived from openapi.yaml. | يوفّر validation/types موحّدة للخادم والعميل. | أعد التوليد عند أي تغيير في العقود. |
| `lib/api-zod/src/generated/plugin.ts` | منجز | Generated Zod schema derived from openapi.yaml. | يوفّر validation/types موحّدة للخادم والعميل. | أعد التوليد عند أي تغيير في العقود. |
| `lib/api-zod/src/generated/pluginCapabilitiesItem.ts` | منجز | Generated Zod schema derived from openapi.yaml. | يوفّر validation/types موحّدة للخادم والعميل. | أعد التوليد عند أي تغيير في العقود. |
| `lib/api-zod/src/generated/pluginProjectRequest.ts` | منجز | Generated Zod schema derived from openapi.yaml. | يوفّر validation/types موحّدة للخادم والعميل. | أعد التوليد عند أي تغيير في العقود. |
| `lib/api-zod/src/generated/project.ts` | منجز | Generated Zod schema derived from openapi.yaml. | يوفّر validation/types موحّدة للخادم والعميل. | أعد التوليد عند أي تغيير في العقود. |
| `lib/api-zod/src/generated/projectStatus.ts` | منجز | Generated Zod schema derived from openapi.yaml. | يوفّر validation/types موحّدة للخادم والعميل. | أعد التوليد عند أي تغيير في العقود. |
| `lib/api-zod/src/generated/projectSummary.ts` | منجز | Generated Zod schema derived from openapi.yaml. | يوفّر validation/types موحّدة للخادم والعميل. | أعد التوليد عند أي تغيير في العقود. |
| `lib/api-zod/src/generated/projectSummaryTaskCounts.ts` | منجز | Generated Zod schema derived from openapi.yaml. | يوفّر validation/types موحّدة للخادم والعميل. | أعد التوليد عند أي تغيير في العقود. |
| `lib/api-zod/src/generated/rule.ts` | منجز | Generated Zod schema derived from openapi.yaml. | يوفّر validation/types موحّدة للخادم والعميل. | أعد التوليد عند أي تغيير في العقود. |
| `lib/api-zod/src/generated/ruleEvaluationResult.ts` | منجز | Generated Zod schema derived from openapi.yaml. | يوفّر validation/types موحّدة للخادم والعميل. | أعد التوليد عند أي تغيير في العقود. |
| `lib/api-zod/src/generated/ruleEvaluationResultMatchesItem.ts` | منجز | Generated Zod schema derived from openapi.yaml. | يوفّر validation/types موحّدة للخادم والعميل. | أعد التوليد عند أي تغيير في العقود. |
| `lib/api-zod/src/generated/ruleSeverity.ts` | منجز | Generated Zod schema derived from openapi.yaml. | يوفّر validation/types موحّدة للخادم والعميل. | أعد التوليد عند أي تغيير في العقود. |
| `lib/api-zod/src/generated/scanJob.ts` | منجز | Generated Zod schema derived from openapi.yaml. | يوفّر validation/types موحّدة للخادم والعميل. | أعد التوليد عند أي تغيير في العقود. |
| `lib/api-zod/src/generated/scanJobStatus.ts` | منجز | Generated Zod schema derived from openapi.yaml. | يوفّر validation/types موحّدة للخادم والعميل. | أعد التوليد عند أي تغيير في العقود. |
| `lib/api-zod/src/generated/scanResult.ts` | منجز | Generated Zod schema derived from openapi.yaml. | يوفّر validation/types موحّدة للخادم والعميل. | أعد التوليد عند أي تغيير في العقود. |
| `lib/api-zod/src/generated/startDiscoveryInput.ts` | منجز | Generated Zod schema derived from openapi.yaml. | يوفّر validation/types موحّدة للخادم والعميل. | أعد التوليد عند أي تغيير في العقود. |
| `lib/api-zod/src/generated/startDiscoveryInputSource.ts` | منجز | Generated Zod schema derived from openapi.yaml. | يوفّر validation/types موحّدة للخادم والعميل. | أعد التوليد عند أي تغيير في العقود. |
| `lib/api-zod/src/generated/task.ts` | منجز | Generated Zod schema derived from openapi.yaml. | يوفّر validation/types موحّدة للخادم والعميل. | أعد التوليد عند أي تغيير في العقود. |
| `lib/api-zod/src/generated/taskLog.ts` | منجز | Generated Zod schema derived from openapi.yaml. | يوفّر validation/types موحّدة للخادم والعميل. | أعد التوليد عند أي تغيير في العقود. |
| `lib/api-zod/src/generated/taskLogLevel.ts` | منجز | Generated Zod schema derived from openapi.yaml. | يوفّر validation/types موحّدة للخادم والعميل. | أعد التوليد عند أي تغيير في العقود. |
| `lib/api-zod/src/generated/taskLogMetadata.ts` | منجز | Generated Zod schema derived from openapi.yaml. | يوفّر validation/types موحّدة للخادم والعميل. | أعد التوليد عند أي تغيير في العقود. |
| `lib/api-zod/src/generated/taskPriority.ts` | منجز | Generated Zod schema derived from openapi.yaml. | يوفّر validation/types موحّدة للخادم والعميل. | أعد التوليد عند أي تغيير في العقود. |
| `lib/api-zod/src/generated/taskStatus.ts` | منجز | Generated Zod schema derived from openapi.yaml. | يوفّر validation/types موحّدة للخادم والعميل. | أعد التوليد عند أي تغيير في العقود. |
| `lib/api-zod/src/generated/updateProjectInput.ts` | منجز | Generated Zod schema derived from openapi.yaml. | يوفّر validation/types موحّدة للخادم والعميل. | أعد التوليد عند أي تغيير في العقود. |
| `lib/api-zod/src/generated/updateProjectInputStatus.ts` | منجز | Generated Zod schema derived from openapi.yaml. | يوفّر validation/types موحّدة للخادم والعميل. | أعد التوليد عند أي تغيير في العقود. |
| `lib/api-zod/src/generated/updateRuleInput.ts` | منجز | Generated Zod schema derived from openapi.yaml. | يوفّر validation/types موحّدة للخادم والعميل. | أعد التوليد عند أي تغيير في العقود. |
| `lib/api-zod/src/generated/updateTaskInput.ts` | منجز | Generated Zod schema derived from openapi.yaml. | يوفّر validation/types موحّدة للخادم والعميل. | أعد التوليد عند أي تغيير في العقود. |
| `lib/api-zod/src/generated/verificationResult.ts` | منجز | Generated Zod schema derived from openapi.yaml. | يوفّر validation/types موحّدة للخادم والعميل. | أعد التوليد عند أي تغيير في العقود. |
| `lib/api-zod/src/generated/verificationResultStepsItem.ts` | منجز | Generated Zod schema derived from openapi.yaml. | يوفّر validation/types موحّدة للخادم والعميل. | أعد التوليد عند أي تغيير في العقود. |
| `lib/api-zod/src/generated/workflow.ts` | منجز | Generated Zod schema derived from openapi.yaml. | يوفّر validation/types موحّدة للخادم والعميل. | أعد التوليد عند أي تغيير في العقود. |
| `lib/api-zod/src/generated/workflowExecution.ts` | منجز | Generated Zod schema derived from openapi.yaml. | يوفّر validation/types موحّدة للخادم والعميل. | أعد التوليد عند أي تغيير في العقود. |
| `lib/api-zod/src/generated/workflowPhase.ts` | منجز | Generated Zod schema derived from openapi.yaml. | يوفّر validation/types موحّدة للخادم والعميل. | أعد التوليد عند أي تغيير في العقود. |
| `lib/api-zod/src/generated/workflowStatus.ts` | منجز | Generated Zod schema derived from openapi.yaml. | يوفّر validation/types موحّدة للخادم والعميل. | أعد التوليد عند أي تغيير في العقود. |
| `lib/db/src/schema/audit_logs.ts` | منجز | Drizzle schema file is present and wired into the shared schema layer. | يؤسس قيود العلاقات والسجلات التنفيذية والـ graph/store. | حافظ على الاتساق مع migrations وpush tooling. |
| `lib/db/src/schema/discovery.ts` | منجز | Drizzle schema file is present and wired into the shared schema layer. | يؤسس قيود العلاقات والسجلات التنفيذية والـ graph/store. | حافظ على الاتساق مع migrations وpush tooling. |
| `lib/db/src/schema/events.ts` | منجز | Drizzle schema file is present and wired into the shared schema layer. | يؤسس قيود العلاقات والسجلات التنفيذية والـ graph/store. | حافظ على الاتساق مع migrations وpush tooling. |
| `lib/db/src/schema/graph.ts` | منجز | Drizzle schema file is present and wired into the shared schema layer. | يؤسس قيود العلاقات والسجلات التنفيذية والـ graph/store. | حافظ على الاتساق مع migrations وpush tooling. |
| `lib/db/src/schema/index.ts` | منجز | Drizzle schema file is present and wired into the shared schema layer. | يؤسس قيود العلاقات والسجلات التنفيذية والـ graph/store. | حافظ على الاتساق مع migrations وpush tooling. |
| `lib/db/src/schema/metrics.ts` | منجز | Drizzle schema file is present and wired into the shared schema layer. | يؤسس قيود العلاقات والسجلات التنفيذية والـ graph/store. | حافظ على الاتساق مع migrations وpush tooling. |
| `lib/db/src/schema/plugins.ts` | منجز | Drizzle schema file is present and wired into the shared schema layer. | يؤسس قيود العلاقات والسجلات التنفيذية والـ graph/store. | حافظ على الاتساق مع migrations وpush tooling. |
| `lib/db/src/schema/projects.ts` | منجز | Drizzle schema file is present and wired into the shared schema layer. | يؤسس قيود العلاقات والسجلات التنفيذية والـ graph/store. | حافظ على الاتساق مع migrations وpush tooling. |
| `lib/db/src/schema/rules.ts` | منجز | Drizzle schema file is present and wired into the shared schema layer. | يؤسس قيود العلاقات والسجلات التنفيذية والـ graph/store. | حافظ على الاتساق مع migrations وpush tooling. |
| `lib/db/src/schema/scan_jobs.ts` | منجز | Drizzle schema file is present and wired into the shared schema layer. | يؤسس قيود العلاقات والسجلات التنفيذية والـ graph/store. | حافظ على الاتساق مع migrations وpush tooling. |
| `lib/db/src/schema/task_logs.ts` | منجز | Drizzle schema file is present and wired into the shared schema layer. | يؤسس قيود العلاقات والسجلات التنفيذية والـ graph/store. | حافظ على الاتساق مع migrations وpush tooling. |
| `lib/db/src/schema/tasks.ts` | منجز | Drizzle schema file is present and wired into the shared schema layer. | يؤسس قيود العلاقات والسجلات التنفيذية والـ graph/store. | حافظ على الاتساق مع migrations وpush tooling. |
| `lib/db/src/schema/workflows.ts` | منجز | Drizzle schema file is present and wired into the shared schema layer. | يؤسس قيود العلاقات والسجلات التنفيذية والـ graph/store. | حافظ على الاتساق مع migrations وpush tooling. |
| `lib/scanner/src/__tests__/file-walker.test.ts` | منجز | Dedicated scanner tests exist. | يحمي السلوك التحليلي من الانحدار. | أضف حالات edge جديدة عند توسيع language support. |
| `lib/scanner/src/__tests__/graph-extractor.test.ts` | منجز | Dedicated scanner tests exist. | يحمي السلوك التحليلي من الانحدار. | أضف حالات edge جديدة عند توسيع language support. |
| `lib/scanner/src/__tests__/metrics-calc.test.ts` | منجز | Dedicated scanner tests exist. | يحمي السلوك التحليلي من الانحدار. | أضف حالات edge جديدة عند توسيع language support. |
| `lib/scanner/src/__tests__/rule-matcher.test.ts` | منجز | Dedicated scanner tests exist. | يحمي السلوك التحليلي من الانحدار. | أضف حالات edge جديدة عند توسيع language support. |
| `lib/scanner/src/file-walker.ts` | منجز | Scanner module is implemented with file walking, rule matching, graph extraction, and metrics. | يحوّل المستودع إلى مصدر فهم بنيوي للمشاريع. | وسع extraction فقط إذا احتاجت الدقة إلى طبقات إضافية. |
| `lib/scanner/src/graph-extractor.ts` | جزئي | Scanner module is implemented with file walking, rule matching, graph extraction, and metrics. | يحوّل المستودع إلى مصدر فهم بنيوي للمشاريع. | وسع extraction فقط إذا احتاجت الدقة إلى طبقات إضافية. |
| `lib/scanner/src/index.ts` | منجز | Scanner module is implemented with file walking, rule matching, graph extraction, and metrics. | يحوّل المستودع إلى مصدر فهم بنيوي للمشاريع. | وسع extraction فقط إذا احتاجت الدقة إلى طبقات إضافية. |
| `lib/scanner/src/metrics-calc.ts` | منجز | Scanner module is implemented with file walking, rule matching, graph extraction, and metrics. | يحوّل المستودع إلى مصدر فهم بنيوي للمشاريع. | وسع extraction فقط إذا احتاجت الدقة إلى طبقات إضافية. |
| `lib/scanner/src/python-ast-script.py` | منجز | Scanner module is implemented with file walking, rule matching, graph extraction, and metrics. | يحوّل المستودع إلى مصدر فهم بنيوي للمشاريع. | وسع extraction فقط إذا احتاجت الدقة إلى طبقات إضافية. |
| `lib/scanner/src/python-ast-script.ts` | منجز | Scanner module is implemented with file walking, rule matching, graph extraction, and metrics. | يحوّل المستودع إلى مصدر فهم بنيوي للمشاريع. | وسع extraction فقط إذا احتاجت الدقة إلى طبقات إضافية. |
| `lib/scanner/src/python-extractor.ts` | منجز | Scanner module is implemented with file walking, rule matching, graph extraction, and metrics. | يحوّل المستودع إلى مصدر فهم بنيوي للمشاريع. | وسع extraction فقط إذا احتاجت الدقة إلى طبقات إضافية. |
| `lib/scanner/src/rule-matcher.ts` | منجز | Scanner module is implemented with file walking, rule matching, graph extraction, and metrics. | يحوّل المستودع إلى مصدر فهم بنيوي للمشاريع. | وسع extraction فقط إذا احتاجت الدقة إلى طبقات إضافية. |
| `artifacts/api-server/src/app.ts` | منجز | Express app includes helmet, rate limiting, auth, proxy handling, and router mounting. | يوفر سطح تشغيل محميًا ومنظمًا. | حافظ على توافق middleware ordering. |
| `artifacts/api-server/src/config.ts` | منجز | Typed fail-fast configuration loader exists. | يقلل أخطاء التشغيل الصامتة. | أضف أي env جديد عبر هذا الملف. |
| `artifacts/api-server/src/index.ts` | منجز | Server entrypoint present. | يوصل الإعداد بالتشغيل الفعلي. | لا تضف منطقًا تجاريًا هنا. |
| `artifacts/api-server/src/lib/audit.ts` | جزئي | Audit writes are explicitly best-effort telemetry. | يحفظ traceability دون تعطيل المعاملات الأساسية. | إن احتجت compliance أقوى فافصل مسار audit عن best-effort. |
| `artifacts/api-server/src/lib/job-queue.test.ts` | منجز | Queue tests exist. | يمنع انحراف concurrency semantics. | أضف اختبارًا للسباقات وحالات الـ restart. |
| `artifacts/api-server/src/lib/job-queue.ts` | منجز | Bounded queue concurrency and queueing logic exist. | يمنع انفجار العمل المتوازي. | راقب backpressure عند نمو الحمل. |
| `artifacts/api-server/src/lib/job-reconciliation.test.ts` | منجز | Reconciliation tests exist. | يثبت recovery behavior. | وسع التغطية لحالات failure edge. |
| `artifacts/api-server/src/lib/job-reconciliation.ts` | منجز | Reconciliation logic exists for stuck jobs. | يعيد النظام للتوازن بعد restart/failure. | اختبره مع crash-recovery scenarios. |
| `artifacts/api-server/src/lib/logger.ts` | منجز | Central logger exists. | يوحد observability. | وسع serializers عند الحاجة فقط. |
| `artifacts/api-server/src/lib/plugin-runtime.ts` | مفقود | الـ plugin routes موجودة لكن runtime framework منفصل غير ظاهر. | الامتداد يبقى محدودًا بالتسجيل لا بالتنفيذ. | أنشئ runtime/hook system مع isolation. |
| `artifacts/api-server/src/lib/scan-runner.ts` | منجز | Scan jobs are executed in a transaction and write audit/event state. | يمنع half-written scan results. | أبقِ النتائج atomic دائمًا. |
| `artifacts/api-server/src/middlewares/clerkProxyMiddleware.ts` | منجز | Clerk proxy middleware is present. | يدعم مسار auth في Replit deployment. | حافظ على ordering المبكر في app.ts. |
| `artifacts/api-server/src/middlewares/rbac.ts` | مفقود | لا يوجد middleware RBAC منفصل في الشجرة الحالية. | الصلاحيات ما تزال coarse-grained على مستوى auth فقط. | أضف طبقة RBAC أو policy checks. |
| `artifacts/api-server/src/middlewares/requireAuth.ts` | منجز | Auth middleware is present. | يحمي API surface. | أضف RBAC فوقه إن لزم. |
| `artifacts/api-server/src/routes/dashboard.ts` | جزئي | Dashboard summary route exists | يوفر summary/overview للواجهة | وسع المقاييس التشغيلية فقط عند الحاجة |
| `artifacts/api-server/src/routes/discovery.test.ts` | منجز | Discovery tests exist | يحمي onboarding flow | أضف حالات session failure والتزامن |
| `artifacts/api-server/src/routes/discovery.ts` | جزئي | Discovery workflow route exists with partial/ready/import states | يمكّن autonomous project onboarding | أكمل أي فروع أو guardrails ناقصة |
| `artifacts/api-server/src/routes/events.ts` | منجز | Events listing route exists | يوفر trace layer للواجهة | أضف تصفيات/paging إضافية إن لزم |
| `artifacts/api-server/src/routes/graph.test.ts` | منجز | Graph tests exist | يحمي العلاقات والاستعلامات | وسّعها مع أي relation types جديدة |
| `artifacts/api-server/src/routes/graph.ts` | جزئي | Graph entities/relationships/neighbors routes exist | يوفر طبقة knowledge graph browsable | أضف inference/query semantics لاحقًا |
| `artifacts/api-server/src/routes/health.ts` | منجز | Health endpoint exists | يوفر readiness check | أبقِه بسيطًا ومستقرًا |
| `artifacts/api-server/src/routes/index.ts` | منجز | Router composition file exists | يجمع كل المسارات في نقطة واحدة | راجع ترتيب mount عند إضافة routes جديدة |
| `artifacts/api-server/src/routes/metrics.test.ts` | منجز | Metrics tests exist | يحمي الحسابات والـ aggregation | أضف regression test لأي formula جديدة |
| `artifacts/api-server/src/routes/metrics.ts` | جزئي | Metrics route exists and serves computed stats | يوفر قياسًا تشغيليًا | وسع dimensions أو trending فقط عند الحاجة |
| `artifacts/api-server/src/routes/plugins.test.ts` | منجز | Plugin tests exist | يحمي registry semantics | أضف اختبارات للعزل والتشغيل الفعلي عند البناء |
| `artifacts/api-server/src/routes/plugins.ts` | جزئي | Plugin registry/toggle route exists | يوفر أساس الامتداد | يبقى runtime plugins/framework الكامل مفقودًا |
| `artifacts/api-server/src/routes/projects.test.ts` | منجز | Project route tests exist | يحمي lifecycle الأساسي | أضف حالات race/failure أكثر |
| `artifacts/api-server/src/routes/projects.ts` | منجز | Project CRUD plus scan trigger/import related flow exists | هو محور دورة حياة المشروع | استمر في atomic claim/order semantics |
| `artifacts/api-server/src/routes/rules.ts` | منجز | Rules route exists | يوفر rule management | أضف قياس أثر القواعد إذا توسع الاستخدام |
| `artifacts/api-server/src/routes/tasks.test.ts` | منجز | Task route tests exist | يحمي task state machine | أضف اختبارات تزامن إضافية |
| `artifacts/api-server/src/routes/tasks.ts` | منجز | Task lifecycle route exists with execute/retry/rollback | يمثّل التنفيذ الذرّي للمهام | وسع حالات rollback/resume إن ظهرت |
| `artifacts/api-server/src/routes/workflows.test.ts` | منجز | Workflow tests exist | يحمي transitions والتعقب | وسع coverage للأخطاء غير السعيدة |
| `artifacts/api-server/src/routes/workflows.ts` | منجز | Workflow orchestration route exists with start/stop/advance/fail/retry | يوفر state machine للسير | حافظ على transition guards الصارمة |
| `artifacts/api-server/src/workers/background-worker.ts` | مفقود | لا يوجد worker orchestration ملف منفصل واضح خارج queue/reconciliation. | الجدولة الخلفية ما زالت مضمنة في وحدات التنفيذ الحالية. | استخرج worker runner واضحًا إذا زاد الحمل. |
| `artifacts/dashboard/src/components/layout/Shell.tsx` | جزئي | App shell exists and wires navigation/search/layout | يوفّر هيكل التحكم العام | اربط العناصر التشغيلية غير المكتملة |
| `artifacts/dashboard/src/components/layout/Sidebar.tsx` | جزئي | Sidebar layout exists | يحسّن navigation | قلّل العناصر الزائدة أو اربطها فعليًا |
| `artifacts/dashboard/src/pages/Admin.tsx` | مفقود | لا توجد صفحة إدارة متقدمة منفصلة. | إدارة السياسات/الصلاحيات/التشغيل تظل موزعة. | أنشئ صفحة إدارية عند تفعيل RBAC. |
| `artifacts/dashboard/src/pages/Dashboard.tsx` | جزئي | Operational dashboard page exists and uses dashboard query hook | يعرض overview للمنصة | عزّز drill-down والـ health context |
| `artifacts/dashboard/src/pages/DiscoverProjectWizard.tsx` | منجز | Autonomous discover/import wizard exists and is wired to API hooks | ينفذ التحول من register project إلى discover project | أضف guardrails وتحسينات UX فقط |
| `artifacts/dashboard/src/pages/Events.tsx` | جزئي | Events browser page exists with filters/search | يجعل audit trail قابلاً للتصفح | أضف pagination/inspection المتقدمة |
| `artifacts/dashboard/src/pages/Graph.tsx` | جزئي | Graph browser page exists with visualization | يعرض knowledge graph browse | أضف semantic explanations and scoring later |
| `artifacts/dashboard/src/pages/Landing.tsx` | منجز | Landing page exists | يوفر entry point للمستخدم | أبقِه خفيفًا وواضحًا |
| `artifacts/dashboard/src/pages/Metrics.tsx` | جزئي | Metrics charts page exists | يتيح قراءة الأداء | وسع التحليلات فقط إذا صارت ضرورة |
| `artifacts/dashboard/src/pages/ProjectDetail.tsx` | جزئي | Project detail page exists with scan/task controls | يجمع project execution controls | أكمل أي blind spots في الحالة والتحميل |
| `artifacts/dashboard/src/pages/Projects.tsx` | منجز | Projects page exists and surfaces DiscoverProjectWizard | يوجه المستخدم إلى onboarding الصحيح | أبقِ discovery flow هو المسار الافتراضي |
| `artifacts/dashboard/src/pages/Rules.tsx` | منجز | Rules management page exists | يمكن إدارة القواعد من الواجهة | أضف UX refinements فقط |
| `artifacts/dashboard/src/pages/SignIn.tsx` | منجز | Sign-in page exists | يوفر auth entry point | أبقِه متوافقًا مع Clerk flow |
| `artifacts/dashboard/src/pages/SignUp.tsx` | منجز | Sign-up page exists | يوفر onboarding auth entry point | أبقِه متوافقًا مع Clerk flow |
| `artifacts/dashboard/src/pages/Tasks.tsx` | منجز | Tasks page exists and exposes execute/retry/rollback actions | يمكّن تنفيذ المهام من الواجهة | أضف حالة التزامن/التعارض إذا لزم |
| `artifacts/dashboard/src/pages/Workflows.tsx` | منجز | Workflows page exists and exposes orchestration actions | يمكّن إدارة السير من الواجهة | أضف exploration للـ execution history |
| `artifacts/dashboard/src/pages/not-found.tsx` | منجز | 404 page exists | يحسن UX للأخطاء الملاحية | لا حاجة لتوسيعها |
| `lib/knowledge-engine/src/index.ts` | مفقود | لا توجد طبقة استدلال/semantic query مستقلة فوق graph storage. | الـ graph يبقى browsable لا معرفيًا بالكامل. | أضف layer للاستعلام والاستدلال والتفسير. |

## ملخص عددي
- **منجز:** 164
- **جزئي:** 18
- **مفقود:** 5

## استنتاج تنفيذي
المشروع منجز معماريًا في الطبقات الأساسية: العقد، البيانات، scanner، queue/reconciliation، workflows، tasks، والواجهة الرئيسية. الفجوات الواضحة الآن ليست في الأساس، بل في **RBAC** و**plugin runtime** و**knowledge inference layer** و**worker isolation** و**عمق التشغيل الإداري**.
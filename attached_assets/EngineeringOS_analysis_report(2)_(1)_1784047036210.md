# EngineeringOS — تحليل شامل للملفّات والطبقات

**الأرشيف المفحوص:** `EngineeringOS-main (37).zip`
**إجمالي الإدخالات:** 606
**إجمالي الملفات:** 548
**الملفات المصدرية:** 232
**الملفات المولّدة:** 116
**الاختبارات:** 27
**الأصول/المرفقات:** 105
**مذكرات/ذاكرة فريق العمل:** 20
**الوثائق:** 2
**التهيئات/config:** 46

## القراءة التنفيذية المختصرة

المشروع ليس تطبيقًا تقليديًا بطبقة واحدة؛ بل منصة متعددة الطبقات تتكوّن من:
1. **طبقة العقد/المواصفات**: OpenAPI + Zod + React Query + codegen.
2. **طبقة البيانات/الاستمرار**: Drizzle schema مع علاقات مرجعية ومفاتيح خارجية وسجلات تتبّع.
3. **طبقة التنفيذ والتحليل**: scanner + knowledge-engine + ai-orchestrator.
4. **طبقة الخدمة/API**: routes في api-server مع مهام background queue وscan/discovery.
5. **طبقة الواجهة**: dashboard وwizard الاكتشاف وAI chat وواجهات المراقبة.
6. **طبقة الأدلة/الحالة**: docs/fact-record + .agents/memory + attached_assets.

أبرز ما يظهر من الكود: المنصة وصلت إلى شكل **هيكلي ناضج**، لكن التحدي المتبقي ليس بناء شاشات إضافية بل **تثبيت الاتساق التشغيلي**: صلاحيات المشروع، توحيد التتبّع، تقوية عقود المدخلات/المخرجات، وإغلاق الفجوات بين طبقات التنفيذ المختلفة.

## أهم النتائج من فحص الكود

- **المستودع يملك سطرًا واضحًا بين العقد والتنفيذ**: `lib/api-spec/openapi.yaml` هو المصدر الأعلى، ويُولِّد `lib/api-zod` و`lib/api-client-react`، مع gate لفحص drift.
- **الماسن/الماسح scanner حقيقي وليس شكليًا**: file-walker + rule-matcher + graph-extractor + metrics-calc + Python AST bridge.
- **knowledge-engine** لا يكتب للقاعدة؛ هو طبقة استعلام/استدلال نقية فوق graph entities/relationships.
- **ai-orchestrator** مبني حول Groq، والردود تمر عبر parsing + fallback schemas بدل الاعتماد على نص خام.
- **api-server** ينفذ مهام ثقيلة في الخلفية عبر `heavyJobQueue` و`scan-runner` و`job-reconciliation`.
- **الهيمنة الحالية للملكية على المشاريع**: `ownerId` موجود، لكن تطبيق access-control الكامل لا يزال غير موحد عبر كل routes.

## الفجوات والمخاطر العملية

1. **تفوّض المشروع ليس شاملًا بعد**: `requireProjectAccess`/`requireProjectWriteAccess` مطبقان داخل `routes/projects.ts` فقط، بينما routes أخرى تعتمد على `projectId` مباشرة.
2. **بعض الحقول/العقود ما زالت خارج التوليد**: يوجد تعليق صريح في `events.ts` أن `correlationId` غير ممثل بالكامل داخل generated schema، في حين يُقرأ يدويًا.
3. **الاعتماد على write-best-effort** في `recordAudit` قرار مناسب تشغيليًا الآن، لكنه يعني أن audit ليس transactional مع mutation.
4. **الطبقات المولّدة كبيرة جدًا**: أي تعديل في OpenAPI أو schema قد يسبب drift إذا لم يُراجع codegen فورًا.
5. **المدخلات الخارجية** مثل git clone/scan paths ومشاريع import تحتاج استمرار التشديد الأمني والاختباري.

## طريقة عملية لتلخيص الوضع الحالي وإكمال البناء

### A. سجل حقيقة واحد
اعتمد ملفًا واحدًا للحقيقة التشغيلية يحتوي لكل ملف:
`الحالة | الدليل | الأثر | الأولوية | الإجراء التالي`
ويُحدَّث بعد كل PR. هذا يمنع الانفصال بين الوثيقة والكود.

### B. الترتيب الصحيح للتطوير
1. **تثبيت البيانات والعلاقات**
2. **تثبيت الصلاحيات والملكية عبر كل routes**
3. **تثبيت scan/discovery/background jobs**
4. **إغلاق فجوات graph/knowledge/audit correlation**
5. **تقوية AI parsing والاختبارات الطرفية**
6. **الواجهة تعكس الحقيقة الداخلية بدل تبسيطها**
7. **التوثيق النهائي والتسليم**

## الخلاصة البنيوية

EngineeringOS هنا يبدو كمنصة **مؤسسية متعددة الطبقات**: اكتشاف مشروع، مسح، تحليل، بناء معرفة، تشغيل AI، وتدقيق/تتبّع. ما ينقصه الآن ليس «فكرة» جديدة بل **إحكام الحدود بين الطبقات**: من يملك أي مشروع، متى يُكتب audit، كيف تُربط الأحداث بــ correlationId، وكيف نمنع طبقة UI من أن تبدو متقدمة على الحقيقة التنفيذية.

## Appendix A — الجرد الكامل للملفات

### الجذر
- [config] `.gitattributes`
- [config] `.gitignore`
- [config] `.npmrc`
- [config] `.replit`
- [config] `.replitignore`
- [config] `package.json`
- [config] `pnpm-lock.yaml`
- [config] `pnpm-workspace.yaml`
- [config] `replit.md`
- [config] `tsconfig.base.json`
- [config] `tsconfig.json`

### docs
- [doc] `docs/completion-plan.md`
- [doc] `docs/fact-record.md`

### .agents
- [memory] `.agents/memory/ai-orchestrator-hardening.md`
- [memory] `.agents/memory/ai-orchestrator-layer.md`
- [memory] `.agents/memory/audit-fixes.md`
- [memory] `.agents/memory/clerk-401-race-cookie-vs-bearer.md`
- [memory] `.agents/memory/clerk-auth-testing.md`
- [memory] `.agents/memory/discovery-adapter-registry.md`
- [memory] `.agents/memory/discovery-feature.md`
- [memory] `.agents/memory/discovery-multi-source.md`
- [memory] `.agents/memory/drizzle-error-wrapping.md`
- [memory] `.agents/memory/engineeringos-completion-plan.md`
- [memory] `.agents/memory/fk-atomic-claim-ordering.md`
- [memory] `.agents/memory/imported-project-clerk-secrets.md`
- [memory] `.agents/memory/imported-project-workflow-failures.md`
- [memory] `.agents/memory/knowledge-engine-bfs-depth.md`
- [memory] `.agents/memory/knowledge-engine.md`
- [memory] `.agents/memory/MEMORY.md`
- [memory] `.agents/memory/orval-openapi-codegen.md`
- [memory] `.agents/memory/project-ownership-scoping.md`
- [memory] `.agents/memory/scanner-ast-extraction.md`
- [memory] `.agents/memory/testing-drift-checks.md`

### lib
- [config] `lib/ai-orchestrator/package.json`
- [test] `lib/ai-orchestrator/src/__tests__/groq-client.test.ts`
- [test] `lib/ai-orchestrator/src/__tests__/parsing.test.ts`
- [test] `lib/ai-orchestrator/src/__tests__/schemas.test.ts`
- [test] `lib/ai-orchestrator/src/__tests__/workflow-orchestrator.test.ts`
- [code] `lib/ai-orchestrator/src/agents/chat-agent.ts`
- [code] `lib/ai-orchestrator/src/agents/code-reviewer.ts`
- [code] `lib/ai-orchestrator/src/agents/scan-analyst.ts`
- [code] `lib/ai-orchestrator/src/agents/task-agent.ts`
- [code] `lib/ai-orchestrator/src/agents/workflow-orchestrator.ts`
- [code] `lib/ai-orchestrator/src/context-builder.ts`
- [code] `lib/ai-orchestrator/src/errors.ts`
- [code] `lib/ai-orchestrator/src/groq-client.ts`
- [code] `lib/ai-orchestrator/src/index.ts`
- [code] `lib/ai-orchestrator/src/parsing.ts`
- [code] `lib/ai-orchestrator/src/prompts/chat.prompt.ts`
- [code] `lib/ai-orchestrator/src/prompts/index.ts`
- [code] `lib/ai-orchestrator/src/prompts/review.prompt.ts`
- [code] `lib/ai-orchestrator/src/prompts/scan.prompt.ts`
- [code] `lib/ai-orchestrator/src/prompts/task.prompt.ts`
- [code] `lib/ai-orchestrator/src/prompts/workflow.prompt.ts`
- [code] `lib/ai-orchestrator/src/schemas/chat.schema.ts`
- [code] `lib/ai-orchestrator/src/schemas/code-review.schema.ts`
- [code] `lib/ai-orchestrator/src/schemas/context.schema.ts`
- [code] `lib/ai-orchestrator/src/schemas/index.ts`
- [code] `lib/ai-orchestrator/src/schemas/scan.schema.ts`
- [code] `lib/ai-orchestrator/src/schemas/task.schema.ts`
- [code] `lib/ai-orchestrator/src/schemas/workflow.schema.ts`
- [config] `lib/ai-orchestrator/tsconfig.json`
- [code] `lib/ai-orchestrator/vitest.config.ts`
- [config] `lib/api-client-react/package.json`
- [code] `lib/api-client-react/src/custom-fetch.ts`
- [generated] `lib/api-client-react/src/generated/api.schemas.ts`
- [generated] `lib/api-client-react/src/generated/api.ts`
- [code] `lib/api-client-react/src/index.ts`
- [config] `lib/api-client-react/tsconfig.json`
- [config] `lib/api-spec/openapi.yaml`
- [code] `lib/api-spec/orval.config.ts`
- [config] `lib/api-spec/package.json`
- [config] `lib/api-zod/package.json`
- [generated] `lib/api-zod/src/generated/api.ts`
- [generated] `lib/api-zod/src/generated/types/aiChatMessage.ts`
- [generated] `lib/api-zod/src/generated/types/aiChatMessageRole.ts`
- [generated] `lib/api-zod/src/generated/types/aiChatOutput.ts`
- [generated] `lib/api-zod/src/generated/types/aiChatRequest.ts`
- [generated] `lib/api-zod/src/generated/types/aiChatSession.ts`
- [generated] `lib/api-zod/src/generated/types/aiCodeIssue.ts`
- [generated] `lib/api-zod/src/generated/types/aiCodeIssueSeverity.ts`
- [generated] `lib/api-zod/src/generated/types/aiCodeIssueType.ts`
- [generated] `lib/api-zod/src/generated/types/aiCodeReview.ts`
- [generated] `lib/api-zod/src/generated/types/aiCodeReviewVerdict.ts`
- [generated] `lib/api-zod/src/generated/types/aiOrchestrateRequest.ts`
- [generated] `lib/api-zod/src/generated/types/aiOrchestrationDecision.ts`
- [generated] `lib/api-zod/src/generated/types/aiOrchestrationDecisionAction.ts`
- [generated] `lib/api-zod/src/generated/types/aiReviewRequest.ts`
- [generated] `lib/api-zod/src/generated/types/aiReviewRequestFileContents.ts`
- [generated] `lib/api-zod/src/generated/types/aiScanAnalysis.ts`
- [generated] `lib/api-zod/src/generated/types/aiScanInsight.ts`
- [generated] `lib/api-zod/src/generated/types/aiScanInsightCategory.ts`
- [generated] `lib/api-zod/src/generated/types/aiScanInsightSeverity.ts`
- [generated] `lib/api-zod/src/generated/types/createProjectInput.ts`
- [generated] `lib/api-zod/src/generated/types/createRuleInput.ts`
- [generated] `lib/api-zod/src/generated/types/createTaskInput.ts`
- [generated] `lib/api-zod/src/generated/types/createWorkflowInput.ts`
- [generated] `lib/api-zod/src/generated/types/dashboardOverview.ts`
- [generated] `lib/api-zod/src/generated/types/dashboardOverviewProjectScoresItem.ts`
- [generated] `lib/api-zod/src/generated/types/dashboardOverviewProjectScoresItemTrend.ts`
- [generated] `lib/api-zod/src/generated/types/dashboardOverviewTaskStatusBreakdown.ts`
- [generated] `lib/api-zod/src/generated/types/dashboardOverviewTopRulesItem.ts`
- [generated] `lib/api-zod/src/generated/types/discoveryGraphSummaryData.ts`
- [generated] `lib/api-zod/src/generated/types/discoveryGraphSummaryDataEntitiesByType.ts`
- [generated] `lib/api-zod/src/generated/types/discoveryGraphSummaryDataFilesByLanguage.ts`
- [generated] `lib/api-zod/src/generated/types/discoveryOptions.ts`
- [generated] `lib/api-zod/src/generated/types/discoveryReport.ts`
- [generated] `lib/api-zod/src/generated/types/discoveryRuleViolationItem.ts`
- [generated] `lib/api-zod/src/generated/types/discoverySessionStatus.ts`
- [generated] `lib/api-zod/src/generated/types/discoverySessionStatusStatus.ts`
- [generated] `lib/api-zod/src/generated/types/discoverySourceCapability.ts`
- [generated] `lib/api-zod/src/generated/types/discoverySourceConfig.ts`
- [generated] `lib/api-zod/src/generated/types/discoverySourceConfigCredentials.ts`
- [generated] `lib/api-zod/src/generated/types/discoveryStepItem.ts`
- [generated] `lib/api-zod/src/generated/types/discoveryStepItemStatus.ts`
- [generated] `lib/api-zod/src/generated/types/entityType.ts`
- [generated] `lib/api-zod/src/generated/types/evaluateRuleRequest.ts`
- [generated] `lib/api-zod/src/generated/types/event.ts`
- [generated] `lib/api-zod/src/generated/types/eventPayload.ts`
- [generated] `lib/api-zod/src/generated/types/eventSeverity.ts`
- [generated] `lib/api-zod/src/generated/types/failWorkflowPhaseInput.ts`
- [generated] `lib/api-zod/src/generated/types/getGraphEntityImpact404.ts`
- [generated] `lib/api-zod/src/generated/types/getGraphEntityImpactParams.ts`
- [generated] `lib/api-zod/src/generated/types/getGraphEntityNeighbors200.ts`
- [generated] `lib/api-zod/src/generated/types/getGraphEntityNeighbors404.ts`
- [generated] `lib/api-zod/src/generated/types/getGraphPathParams.ts`
- [generated] `lib/api-zod/src/generated/types/getLatestMetricsParams.ts`
- [generated] `lib/api-zod/src/generated/types/graphCentralityScore.ts`
- [generated] `lib/api-zod/src/generated/types/graphEntity.ts`
- [generated] `lib/api-zod/src/generated/types/graphEntityMetadata.ts`
- [generated] `lib/api-zod/src/generated/types/graphImpactHop.ts`
- [generated] `lib/api-zod/src/generated/types/graphImpactResult.ts`
- [generated] `lib/api-zod/src/generated/types/graphPathResult.ts`
- [generated] `lib/api-zod/src/generated/types/graphPathStep.ts`
- [generated] `lib/api-zod/src/generated/types/graphProvenance.ts`
- [generated] `lib/api-zod/src/generated/types/graphRelationship.ts`
- [generated] `lib/api-zod/src/generated/types/graphRelationshipMetadata.ts`
- [generated] `lib/api-zod/src/generated/types/graphSummary.ts`
- [generated] `lib/api-zod/src/generated/types/graphSummaryEntitiesByType.ts`
- [generated] `lib/api-zod/src/generated/types/graphSummaryRelationsByType.ts`
- [generated] `lib/api-zod/src/generated/types/healthStatus.ts`
- [generated] `lib/api-zod/src/generated/types/healthStatusStatus.ts`
- [generated] `lib/api-zod/src/generated/types/importProjectInput.ts`
- [generated] `lib/api-zod/src/generated/types/importProjectInputOverrides.ts`
- [generated] `lib/api-zod/src/generated/types/index.ts`
- [generated] `lib/api-zod/src/generated/types/listAiChatSessionsParams.ts`
- [generated] `lib/api-zod/src/generated/types/listEventsParams.ts`
- [generated] `lib/api-zod/src/generated/types/listGraphEntitiesParams.ts`
- [generated] `lib/api-zod/src/generated/types/listGraphRelationshipsParams.ts`
- [generated] `lib/api-zod/src/generated/types/listMetricsParams.ts`
- [generated] `lib/api-zod/src/generated/types/listRulesParams.ts`
- [generated] `lib/api-zod/src/generated/types/listTasksParams.ts`
- [generated] `lib/api-zod/src/generated/types/listWorkflowsParams.ts`
- [generated] `lib/api-zod/src/generated/types/metricRecord.ts`
- [generated] `lib/api-zod/src/generated/types/metricRecordBuildStatus.ts`
- [generated] `lib/api-zod/src/generated/types/plugin.ts`
- [generated] `lib/api-zod/src/generated/types/pluginCapabilitiesItem.ts`
- [generated] `lib/api-zod/src/generated/types/pluginProjectRequest.ts`
- [generated] `lib/api-zod/src/generated/types/project.ts`
- [generated] `lib/api-zod/src/generated/types/projectStatus.ts`
- [generated] `lib/api-zod/src/generated/types/projectSummary.ts`
- [generated] `lib/api-zod/src/generated/types/projectSummaryTaskCounts.ts`
- [generated] `lib/api-zod/src/generated/types/rule.ts`
- [generated] `lib/api-zod/src/generated/types/ruleEvaluationResult.ts`
- [generated] `lib/api-zod/src/generated/types/ruleEvaluationResultMatchesItem.ts`
- [generated] `lib/api-zod/src/generated/types/ruleSeverity.ts`
- [generated] `lib/api-zod/src/generated/types/scanJob.ts`
- [generated] `lib/api-zod/src/generated/types/scanJobStatus.ts`
- [generated] `lib/api-zod/src/generated/types/scanResult.ts`
- [generated] `lib/api-zod/src/generated/types/sourceType.ts`
- [generated] `lib/api-zod/src/generated/types/startDiscoveryInput.ts`
- [generated] `lib/api-zod/src/generated/types/task.ts`
- [generated] `lib/api-zod/src/generated/types/taskLog.ts`
- [generated] `lib/api-zod/src/generated/types/taskLogLevel.ts`
- [generated] `lib/api-zod/src/generated/types/taskLogMetadata.ts`
- [generated] `lib/api-zod/src/generated/types/taskPriority.ts`
- [generated] `lib/api-zod/src/generated/types/taskStatus.ts`
- [generated] `lib/api-zod/src/generated/types/updateProjectInput.ts`
- [generated] `lib/api-zod/src/generated/types/updateProjectInputStatus.ts`
- [generated] `lib/api-zod/src/generated/types/updateRuleInput.ts`
- [generated] `lib/api-zod/src/generated/types/updateTaskInput.ts`
- [generated] `lib/api-zod/src/generated/types/verificationResult.ts`
- [generated] `lib/api-zod/src/generated/types/verificationResultStepsItem.ts`
- [generated] `lib/api-zod/src/generated/types/workflow.ts`
- [generated] `lib/api-zod/src/generated/types/workflowExecution.ts`
- [generated] `lib/api-zod/src/generated/types/workflowPhase.ts`
- [generated] `lib/api-zod/src/generated/types/workflowStatus.ts`
- [code] `lib/api-zod/src/index.ts`
- [config] `lib/api-zod/tsconfig.json`
- [code] `lib/db/drizzle.config.ts`
- [config] `lib/db/package.json`
- [code] `lib/db/src/index.ts`
- [code] `lib/db/src/schema/ai_chats.ts`
- [code] `lib/db/src/schema/audit_logs.ts`
- [code] `lib/db/src/schema/discovery.ts`
- [code] `lib/db/src/schema/events.ts`
- [code] `lib/db/src/schema/graph.ts`
- [code] `lib/db/src/schema/index.ts`
- [code] `lib/db/src/schema/metrics.ts`
- [code] `lib/db/src/schema/plugins.ts`
- [code] `lib/db/src/schema/projects.ts`
- [code] `lib/db/src/schema/rules.ts`
- [code] `lib/db/src/schema/scan_jobs.ts`
- [code] `lib/db/src/schema/task_logs.ts`
- [code] `lib/db/src/schema/tasks.ts`
- [code] `lib/db/src/schema/workflows.ts`
- [config] `lib/db/tsconfig.json`
- [config] `lib/knowledge-engine/package.json`
- [test] `lib/knowledge-engine/src/__tests__/inference.test.ts`
- [test] `lib/knowledge-engine/src/__tests__/queries.test.ts`
- [code] `lib/knowledge-engine/src/index.ts`
- [code] `lib/knowledge-engine/src/inference.ts`
- [code] `lib/knowledge-engine/src/queries.ts`
- [code] `lib/knowledge-engine/src/types.ts`
- [config] `lib/knowledge-engine/tsconfig.json`
- [config] `lib/scanner/package.json`
- [test] `lib/scanner/src/__tests__/file-walker.test.ts`
- [test] `lib/scanner/src/__tests__/graph-extractor.test.ts`
- [test] `lib/scanner/src/__tests__/metrics-calc.test.ts`
- [test] `lib/scanner/src/__tests__/rule-matcher.test.ts`
- [code] `lib/scanner/src/file-walker.ts`
- [code] `lib/scanner/src/graph-extractor.ts`
- [code] `lib/scanner/src/index.ts`
- [code] `lib/scanner/src/metrics-calc.ts`
- [code] `lib/scanner/src/python-ast-script.py`
- [code] `lib/scanner/src/python-ast-script.ts`
- [code] `lib/scanner/src/python-extractor.ts`
- [code] `lib/scanner/src/rule-matcher.ts`
- [config] `lib/scanner/tsconfig.json`
- [code] `lib/scanner/vitest.config.ts`

### artifacts
- [config] `artifacts/api-server/.replit-artifact/artifact.toml`
- [code] `artifacts/api-server/build.mjs`
- [config] `artifacts/api-server/package.json`
- [code] `artifacts/api-server/src/app.ts`
- [code] `artifacts/api-server/src/config.ts`
- [code] `artifacts/api-server/src/index.ts`
- [code] `artifacts/api-server/src/lib/audit.ts`
- [test] `artifacts/api-server/src/lib/discovery-adapters.test.ts`
- [code] `artifacts/api-server/src/lib/discovery-adapters.ts`
- [test] `artifacts/api-server/src/lib/job-queue.test.ts`
- [code] `artifacts/api-server/src/lib/job-queue.ts`
- [test] `artifacts/api-server/src/lib/job-reconciliation.test.ts`
- [code] `artifacts/api-server/src/lib/job-reconciliation.ts`
- [code] `artifacts/api-server/src/lib/logger.ts`
- [test] `artifacts/api-server/src/lib/plugin-runtime.test.ts`
- [code] `artifacts/api-server/src/lib/plugin-runtime.ts`
- [code] `artifacts/api-server/src/lib/scan-runner.ts`
- [config] `artifacts/api-server/src/middlewares/.gitkeep`
- [code] `artifacts/api-server/src/middlewares/clerkProxyMiddleware.ts`
- [test] `artifacts/api-server/src/middlewares/requireAuth.test.ts`
- [code] `artifacts/api-server/src/middlewares/requireAuth.ts`
- [code] `artifacts/api-server/src/middlewares/requireProjectAccess.ts`
- [test] `artifacts/api-server/src/routes/ai.test.ts`
- [code] `artifacts/api-server/src/routes/ai.ts`
- [test] `artifacts/api-server/src/routes/dashboard.test.ts`
- [code] `artifacts/api-server/src/routes/dashboard.ts`
- [test] `artifacts/api-server/src/routes/discovery.test.ts`
- [code] `artifacts/api-server/src/routes/discovery.ts`
- [test] `artifacts/api-server/src/routes/events.test.ts`
- [code] `artifacts/api-server/src/routes/events.ts`
- [test] `artifacts/api-server/src/routes/graph.test.ts`
- [code] `artifacts/api-server/src/routes/graph.ts`
- [test] `artifacts/api-server/src/routes/health.test.ts`
- [code] `artifacts/api-server/src/routes/health.ts`
- [code] `artifacts/api-server/src/routes/index.ts`
- [test] `artifacts/api-server/src/routes/metrics.test.ts`
- [code] `artifacts/api-server/src/routes/metrics.ts`
- [test] `artifacts/api-server/src/routes/plugins.test.ts`
- [code] `artifacts/api-server/src/routes/plugins.ts`
- [test] `artifacts/api-server/src/routes/projects.test.ts`
- [code] `artifacts/api-server/src/routes/projects.ts`
- [test] `artifacts/api-server/src/routes/rules.test.ts`
- [code] `artifacts/api-server/src/routes/rules.ts`
- [test] `artifacts/api-server/src/routes/tasks.test.ts`
- [code] `artifacts/api-server/src/routes/tasks.ts`
- [test] `artifacts/api-server/src/routes/workflows.test.ts`
- [code] `artifacts/api-server/src/routes/workflows.ts`
- [code] `artifacts/api-server/src/scripts/seed-provenance.ts`
- [code] `artifacts/api-server/src/types/express.d.ts`
- [config] `artifacts/api-server/tsconfig.json`
- [code] `artifacts/api-server/vitest.config.ts`
- [config] `artifacts/dashboard/.replit-artifact/artifact.toml`
- [config] `artifacts/dashboard/components.json`
- [config] `artifacts/dashboard/index.html`
- [config] `artifacts/dashboard/package.json`
- [config] `artifacts/dashboard/public/favicon.svg`
- [config] `artifacts/dashboard/public/logo.svg`
- [config] `artifacts/dashboard/public/robots.txt`
- [code] `artifacts/dashboard/src/App.tsx`
- [code] `artifacts/dashboard/src/components/layout/Shell.tsx`
- [code] `artifacts/dashboard/src/components/layout/Sidebar.tsx`
- [code] `artifacts/dashboard/src/components/ui/accordion.tsx`
- [code] `artifacts/dashboard/src/components/ui/alert-dialog.tsx`
- [code] `artifacts/dashboard/src/components/ui/alert.tsx`
- [code] `artifacts/dashboard/src/components/ui/aspect-ratio.tsx`
- [code] `artifacts/dashboard/src/components/ui/avatar.tsx`
- [code] `artifacts/dashboard/src/components/ui/badge.tsx`
- [code] `artifacts/dashboard/src/components/ui/breadcrumb.tsx`
- [code] `artifacts/dashboard/src/components/ui/button-group.tsx`
- [code] `artifacts/dashboard/src/components/ui/button.tsx`
- [code] `artifacts/dashboard/src/components/ui/calendar.tsx`
- [code] `artifacts/dashboard/src/components/ui/card.tsx`
- [code] `artifacts/dashboard/src/components/ui/carousel.tsx`
- [code] `artifacts/dashboard/src/components/ui/chart.tsx`
- [code] `artifacts/dashboard/src/components/ui/checkbox.tsx`
- [code] `artifacts/dashboard/src/components/ui/collapsible.tsx`
- [code] `artifacts/dashboard/src/components/ui/command.tsx`
- [code] `artifacts/dashboard/src/components/ui/context-menu.tsx`
- [code] `artifacts/dashboard/src/components/ui/dialog.tsx`
- [code] `artifacts/dashboard/src/components/ui/drawer.tsx`
- [code] `artifacts/dashboard/src/components/ui/dropdown-menu.tsx`
- [code] `artifacts/dashboard/src/components/ui/empty.tsx`
- [code] `artifacts/dashboard/src/components/ui/field.tsx`
- [code] `artifacts/dashboard/src/components/ui/form.tsx`
- [code] `artifacts/dashboard/src/components/ui/hover-card.tsx`
- [code] `artifacts/dashboard/src/components/ui/input-group.tsx`
- [code] `artifacts/dashboard/src/components/ui/input-otp.tsx`
- [code] `artifacts/dashboard/src/components/ui/input.tsx`
- [code] `artifacts/dashboard/src/components/ui/item.tsx`
- [code] `artifacts/dashboard/src/components/ui/kbd.tsx`
- [code] `artifacts/dashboard/src/components/ui/label.tsx`
- [code] `artifacts/dashboard/src/components/ui/menubar.tsx`
- [code] `artifacts/dashboard/src/components/ui/navigation-menu.tsx`
- [code] `artifacts/dashboard/src/components/ui/pagination.tsx`
- [code] `artifacts/dashboard/src/components/ui/popover.tsx`
- [code] `artifacts/dashboard/src/components/ui/progress.tsx`
- [code] `artifacts/dashboard/src/components/ui/radio-group.tsx`
- [code] `artifacts/dashboard/src/components/ui/resizable.tsx`
- [code] `artifacts/dashboard/src/components/ui/scroll-area.tsx`
- [code] `artifacts/dashboard/src/components/ui/select.tsx`
- [code] `artifacts/dashboard/src/components/ui/separator.tsx`
- [code] `artifacts/dashboard/src/components/ui/sheet.tsx`
- [code] `artifacts/dashboard/src/components/ui/sidebar.tsx`
- [code] `artifacts/dashboard/src/components/ui/skeleton.tsx`
- [code] `artifacts/dashboard/src/components/ui/slider.tsx`
- [code] `artifacts/dashboard/src/components/ui/sonner.tsx`
- [code] `artifacts/dashboard/src/components/ui/spinner.tsx`
- [code] `artifacts/dashboard/src/components/ui/switch.tsx`
- [code] `artifacts/dashboard/src/components/ui/table.tsx`
- [code] `artifacts/dashboard/src/components/ui/tabs.tsx`
- [code] `artifacts/dashboard/src/components/ui/textarea.tsx`
- [code] `artifacts/dashboard/src/components/ui/toast.tsx`
- [code] `artifacts/dashboard/src/components/ui/toaster.tsx`
- [code] `artifacts/dashboard/src/components/ui/toggle-group.tsx`
- [code] `artifacts/dashboard/src/components/ui/toggle.tsx`
- [code] `artifacts/dashboard/src/components/ui/tooltip.tsx`
- [code] `artifacts/dashboard/src/hooks/use-mobile.tsx`
- [code] `artifacts/dashboard/src/hooks/use-toast.ts`
- [config] `artifacts/dashboard/src/index.css`
- [code] `artifacts/dashboard/src/lib/clerk.ts`
- [code] `artifacts/dashboard/src/lib/utils.ts`
- [code] `artifacts/dashboard/src/main.tsx`
- [code] `artifacts/dashboard/src/pages/AiChat.tsx`
- [code] `artifacts/dashboard/src/pages/Dashboard.tsx`
- [code] `artifacts/dashboard/src/pages/DiscoverProjectWizard.tsx`
- [code] `artifacts/dashboard/src/pages/Events.tsx`
- [code] `artifacts/dashboard/src/pages/Graph.tsx`
- [code] `artifacts/dashboard/src/pages/Landing.tsx`
- [code] `artifacts/dashboard/src/pages/Metrics.tsx`
- [code] `artifacts/dashboard/src/pages/not-found.tsx`
- [code] `artifacts/dashboard/src/pages/ProjectDetail.tsx`
- [code] `artifacts/dashboard/src/pages/Projects.tsx`
- [code] `artifacts/dashboard/src/pages/Rules.tsx`
- [code] `artifacts/dashboard/src/pages/SignIn.tsx`
- [code] `artifacts/dashboard/src/pages/SignUp.tsx`
- [code] `artifacts/dashboard/src/pages/Tasks.tsx`
- [code] `artifacts/dashboard/src/pages/Workflows.tsx`
- [config] `artifacts/dashboard/tsconfig.json`
- [code] `artifacts/dashboard/vite.config.ts`
- [config] `artifacts/mockup-sandbox/.replit-artifact/artifact.toml`
- [config] `artifacts/mockup-sandbox/components.json`
- [config] `artifacts/mockup-sandbox/index.html`
- [code] `artifacts/mockup-sandbox/mockupPreviewPlugin.ts`
- [config] `artifacts/mockup-sandbox/package.json`
- [code] `artifacts/mockup-sandbox/src/.generated/mockup-components.ts`
- [code] `artifacts/mockup-sandbox/src/App.tsx`
- [code] `artifacts/mockup-sandbox/src/components/ui/accordion.tsx`
- [code] `artifacts/mockup-sandbox/src/components/ui/alert-dialog.tsx`
- [code] `artifacts/mockup-sandbox/src/components/ui/alert.tsx`
- [code] `artifacts/mockup-sandbox/src/components/ui/aspect-ratio.tsx`
- [code] `artifacts/mockup-sandbox/src/components/ui/avatar.tsx`
- [code] `artifacts/mockup-sandbox/src/components/ui/badge.tsx`
- [code] `artifacts/mockup-sandbox/src/components/ui/breadcrumb.tsx`
- [code] `artifacts/mockup-sandbox/src/components/ui/button-group.tsx`
- [code] `artifacts/mockup-sandbox/src/components/ui/button.tsx`
- [code] `artifacts/mockup-sandbox/src/components/ui/calendar.tsx`
- [code] `artifacts/mockup-sandbox/src/components/ui/card.tsx`
- [code] `artifacts/mockup-sandbox/src/components/ui/carousel.tsx`
- [code] `artifacts/mockup-sandbox/src/components/ui/chart.tsx`
- [code] `artifacts/mockup-sandbox/src/components/ui/checkbox.tsx`
- [code] `artifacts/mockup-sandbox/src/components/ui/collapsible.tsx`
- [code] `artifacts/mockup-sandbox/src/components/ui/command.tsx`
- [code] `artifacts/mockup-sandbox/src/components/ui/context-menu.tsx`
- [code] `artifacts/mockup-sandbox/src/components/ui/dialog.tsx`
- [code] `artifacts/mockup-sandbox/src/components/ui/drawer.tsx`
- [code] `artifacts/mockup-sandbox/src/components/ui/dropdown-menu.tsx`
- [code] `artifacts/mockup-sandbox/src/components/ui/empty.tsx`
- [code] `artifacts/mockup-sandbox/src/components/ui/field.tsx`
- [code] `artifacts/mockup-sandbox/src/components/ui/form.tsx`
- [code] `artifacts/mockup-sandbox/src/components/ui/hover-card.tsx`
- [code] `artifacts/mockup-sandbox/src/components/ui/input-group.tsx`
- [code] `artifacts/mockup-sandbox/src/components/ui/input-otp.tsx`
- [code] `artifacts/mockup-sandbox/src/components/ui/input.tsx`
- [code] `artifacts/mockup-sandbox/src/components/ui/item.tsx`
- [code] `artifacts/mockup-sandbox/src/components/ui/kbd.tsx`
- [code] `artifacts/mockup-sandbox/src/components/ui/label.tsx`
- [code] `artifacts/mockup-sandbox/src/components/ui/menubar.tsx`
- [code] `artifacts/mockup-sandbox/src/components/ui/navigation-menu.tsx`
- [code] `artifacts/mockup-sandbox/src/components/ui/pagination.tsx`
- [code] `artifacts/mockup-sandbox/src/components/ui/popover.tsx`
- [code] `artifacts/mockup-sandbox/src/components/ui/progress.tsx`
- [code] `artifacts/mockup-sandbox/src/components/ui/radio-group.tsx`
- [code] `artifacts/mockup-sandbox/src/components/ui/resizable.tsx`
- [code] `artifacts/mockup-sandbox/src/components/ui/scroll-area.tsx`
- [code] `artifacts/mockup-sandbox/src/components/ui/select.tsx`
- [code] `artifacts/mockup-sandbox/src/components/ui/separator.tsx`
- [code] `artifacts/mockup-sandbox/src/components/ui/sheet.tsx`
- [code] `artifacts/mockup-sandbox/src/components/ui/sidebar.tsx`
- [code] `artifacts/mockup-sandbox/src/components/ui/skeleton.tsx`
- [code] `artifacts/mockup-sandbox/src/components/ui/slider.tsx`
- [code] `artifacts/mockup-sandbox/src/components/ui/sonner.tsx`
- [code] `artifacts/mockup-sandbox/src/components/ui/spinner.tsx`
- [code] `artifacts/mockup-sandbox/src/components/ui/switch.tsx`
- [code] `artifacts/mockup-sandbox/src/components/ui/table.tsx`
- [code] `artifacts/mockup-sandbox/src/components/ui/tabs.tsx`
- [code] `artifacts/mockup-sandbox/src/components/ui/textarea.tsx`
- [code] `artifacts/mockup-sandbox/src/components/ui/toast.tsx`
- [code] `artifacts/mockup-sandbox/src/components/ui/toaster.tsx`
- [code] `artifacts/mockup-sandbox/src/components/ui/toggle-group.tsx`
- [code] `artifacts/mockup-sandbox/src/components/ui/toggle.tsx`
- [code] `artifacts/mockup-sandbox/src/components/ui/tooltip.tsx`
- [code] `artifacts/mockup-sandbox/src/hooks/use-mobile.tsx`
- [code] `artifacts/mockup-sandbox/src/hooks/use-toast.ts`
- [config] `artifacts/mockup-sandbox/src/index.css`
- [code] `artifacts/mockup-sandbox/src/lib/utils.ts`
- [code] `artifacts/mockup-sandbox/src/main.tsx`
- [config] `artifacts/mockup-sandbox/tsconfig.json`
- [code] `artifacts/mockup-sandbox/vite.config.ts`

### attached_assets
- [asset] `attached_assets/agents_(1)_1783564013722.zip`
- [asset] `attached_assets/ai_orchestrator_deep_dive_(1)_1783994021466.md`
- [asset] `attached_assets/artifacts_(7)_(1)_1783564013761.zip`
- [asset] `attached_assets/Engineering_Os_Fact_Record_1783718570175.pdf`
- [asset] `attached_assets/Engineering_Os_Phased_Completion_Plan_(1)_1783718452123.pdf`
- [asset] `attached_assets/Engineering_Os_Phased_Completion_Plan_1783718452216.pdf`
- [asset] `attached_assets/EngineeringOS_architecture_analysis_report_1784040976647.md`
- [asset] `attached_assets/EngineeringOS_archive_entries_1784040976692.csv`
- [asset] `attached_assets/EngineeringOS_archive_entries_1784041152876.csv`
- [asset] `attached_assets/EngineeringOS_Audit_Report_1783641389270.md`
- [asset] `attached_assets/EngineeringOS_Audit_Report_Expanded_1783642792349.md`
- [asset] `attached_assets/EngineeringOS_Combined_Deep_Analysis_(1)_1783706911895.md`
- [asset] `attached_assets/EngineeringOS_deep_analysis_report_1783800987828.md`
- [asset] `attached_assets/EngineeringOS_Execution_Plan_1783831261195.pdf`
- [asset] `attached_assets/EngineeringOS_Executive_Build_Directive_v1_1783912619169.md`
- [asset] `attached_assets/EngineeringOS_File_by_File_Fact_Record_1783725698283.md`
- [asset] `attached_assets/EngineeringOS_file_inventory_(1)_1783729892809.csv`
- [asset] `attached_assets/EngineeringOS_File_Inventory_Complete(1)_1783706911845.md`
- [asset] `attached_assets/EngineeringOS_file_inventory_full(2)_1783988496247.csv`
- [asset] `attached_assets/EngineeringOS_file_inventory_full_1783800987783.csv`
- [asset] `attached_assets/EngineeringOS_full_analysis_report_1783988496190.md`
- [asset] `attached_assets/EngineeringOS_full_file_inventory(1)_1784040976594.csv`
- [asset] `attached_assets/EngineeringOS_full_file_inventory(1)_1784041152926.csv`
- [asset] `attached_assets/EngineeringOS_Implementation_Document_1783726156016.md`
- [asset] `attached_assets/EngineeringOS_minimum_path_to_vision_(1)_1783830867380.md`
- [asset] `attached_assets/EngineeringOS_minimum_path_to_vision_1783830816710.md`
- [asset] `attached_assets/EngineeringOS_operational_status_record_1783912104506.md`
- [asset] `attached_assets/EngineeringOS_Plan_1783818095882.pdf`
- [asset] `attached_assets/EngineeringOS_Project_1783718452179.pdf`
- [asset] `attached_assets/EngineeringOS_project_analysis_report(1)_1783729892769.md`
- [asset] `attached_assets/EngineeringOS_provenance_registry_linked_1783911530593.json`
- [asset] `attached_assets/EngineeringOS_provenance_registry_seed_1783911530658.json`
- [asset] `attached_assets/EngineeringOS_replit_execution_directive_1783800987701.json`
- [asset] `attached_assets/EngineeringOS_replit_execution_directive_1783800987743.md`
- [asset] `attached_assets/EngineeringOS_series14_truth_matrix_1783966531635.md`
- [asset] `attached_assets/EngineeringOS_series15_deep_evidence_1783966531578.md`
- [asset] `attached_assets/EngineeringOS_series16_truth_matrix_(1)_1783966531512.md`
- [asset] `attached_assets/EngineeringOS_series17_deep_analysis_1783966531444.md`
- [asset] `attached_assets/EngineeringOS_series18_status_register_(1)_1783966531375.md`
- [asset] `attached_assets/EngineeringOS_series19_control_plane_evidence_1783966531303.md`
- [asset] `attached_assets/EngineeringOS_series20_status_register_1783966531239.md`
- [asset] `attached_assets/EngineeringOS_series21_deep_status_1783966531177.md`
- [asset] `attached_assets/EngineeringOS_series22_second_wave_analysis_1783966531113.md`
- [asset] `attached_assets/EngineeringOS_series23_self_verifying_architecture_1783966531049.md`
- [asset] `attached_assets/EngineeringOS_series24_deep_evidence_1783966530990.md`
- [asset] `attached_assets/EngineeringOS_series25_truth_register_1783966530939.md`
- [asset] `attached_assets/EngineeringOS_series26_boundary_analysis_1783966530884.md`
- [asset] `attached_assets/EngineeringOS_series27_failure_semantics_1783966530824.md`
- [asset] `attached_assets/EngineeringOS_series28_traceability_mesh_1783966530766.md`
- [asset] `attached_assets/EngineeringOS_series29_trust_boundary_register_1783966530702.md`
- [asset] `attached_assets/EngineeringOS_series30_release_handoff_audit_1783966530642.md`
- [asset] `attached_assets/EngineeringOS_series31_release_handoff_audit_1783966530586.md`
- [asset] `attached_assets/EngineeringOS_series32_phase_conformance_audit_1783966530537.md`
- [asset] `attached_assets/EngineeringOS_series33_provenance_authority_graph_1783966530470.md`
- [asset] `attached_assets/EngineeringOS_status_record_(1)_1783980758791.md`
- [asset] `attached_assets/EngineeringOS_status_register_(1)_1783818095824.md`
- [asset] `attached_assets/EngineeringOS_status_register_final_1783902107873.md`
- [asset] `attached_assets/EngineeringOS_task_backlog_1783800987875.json`
- [asset] `attached_assets/EngineeringOS_truth_register_current_1783825680736.md`
- [asset] `attached_assets/git_(2)_1783564013691.zip`
- [asset] `attached_assets/gitattributes_1783564013915.txt`
- [asset] `attached_assets/gitignore_(1)_1783564013965.txt`
- [asset] `attached_assets/lib_(7)_(1)_1783564013810.zip`
- [asset] `attached_assets/node_modules_(2)_1783564014266.zip`
- [asset] `attached_assets/npmrc_(2)_1783564014024.txt`
- [asset] `attached_assets/package_(1)_(7)_1783564014328.json`
- [asset] `attached_assets/Pasted---1783906604381_1783906604385.txt`
- [asset] `attached_assets/Pasted---1783956390496_1783956390501.txt`
- [asset] `attached_assets/Pasted--artifacts-api-server-src-routes-discovery-ts--17839967_1783996711676.txt`
- [asset] `attached_assets/Pasted--artifacts-api-server-src-routes-discovery-ts--17839967_1783997082105.txt`
- [asset] `attached_assets/Pasted--Backlog-Execution-Backlog-v1-0--1783975284276_1783975284279.txt`
- [asset] `attached_assets/Pasted--Discovery-Layer--1783988471815_1783988471818.txt`
- [asset] `attached_assets/Pasted--EngineeringOS-Autonomous-Project-Discovery-Onboarding-_1783565505918.txt`
- [asset] `attached_assets/Pasted--EngineeringOS-Autonomous-Project-Discovery-Onboarding-_1783566150077.txt`
- [asset] `attached_assets/Pasted--lib-ai-orchestrator--1783993997216_1783993997218.txt`
- [asset] `attached_assets/Pasted--onboarding-o-1783988399961_1783988399964.txt`
- [asset] `attached_assets/Pasted--Plan-3-Sync-fact-record-architecture-docs-3-Sync-Fact-_1783733496072.txt`
- [asset] `attached_assets/Pasted--Plan-3-Sync-fact-record-architecture-docs-3-Sync-Fact-_1783790285219.txt`
- [asset] `attached_assets/Pasted--PR--1784040954263_1784040954267.txt`
- [asset] `attached_assets/Pasted--PR-discovery-ts-PR-1-Discovery--1783996178319_1783996178325.txt`
- [asset] `attached_assets/Pasted--PR-lib-ai-orchestrator-PR-1-Prompt-Templates--17839939_1783993953832.txt`
- [asset] `attached_assets/Pasted--PR-lib-ai-orchestrator-PR-1-Prompt-Templates--17839939_1783993967887.txt`
- [asset] `attached_assets/Pasted--PR-lib-ai-orchestrator-PR-1-Prompt-Templates--17839950_1783995013203.txt`
- [asset] `attached_assets/Pasted--PR-title-Harden-auth-context-and-prepare-project-scope_1784044908893.txt`
- [asset] `attached_assets/Pasted-7-Upgrade-Dashboard-to-Operational-UI-What-Why-Current-_1783734748019.txt`
- [asset] `attached_assets/Pasted-7-Upgrade-Dashboard-to-Operational-UI-What-Why-Current-_1783798897613.txt`
- [asset] `attached_assets/Pasted-Plan-6-Deepen-graph-scanner-discovery-6-Deepen-Graph-Sc_1783734658300.txt`
- [asset] `attached_assets/pnpm-lock.yaml_(3)_1783564014392.txt`
- [asset] `attached_assets/pnpm-workspace.yaml_(3)_1783564014449.txt`
- [asset] `attached_assets/replit_(13)_1783564014085.md`
- [asset] `attached_assets/replit_(2)_1783564014509.txt`
- [asset] `attached_assets/replitignore_1783564014569.txt`
- [asset] `attached_assets/Screenshot_٢٠٢٦٠٧٠٩-٠٦١٦٢٥_1783567039006.png`
- [asset] `attached_assets/Screenshot_٢٠٢٦٠٧٠٩-٠٦٢٠٣٨_1783610776566.png`
- [asset] `attached_assets/Screenshot_٢٠٢٦٠٧١٣-٠٣٥٣١٨_1783904118069.png`
- [asset] `attached_assets/Screenshot_٢٠٢٦٠٧١٣-٠٤٠٥١١_1783904724118.png`
- [asset] `attached_assets/Screenshot_٢٠٢٦٠٧١٣-٠٤٤٤٢٨_1783907108840.png`
- [asset] `attached_assets/Screenshot_٢٠٢٦٠٧١٣-٠٥٠١٣٨_1783908128704.png`
- [asset] `attached_assets/Screenshot_٢٠٢٦٠٧١٣-٠٥١٤٥٤_1783908924873.png`
- [asset] `attached_assets/Screenshot_٢٠٢٦٠٧١٣-٠٥١٩٤٨_1783909201747.png`
- [asset] `attached_assets/scripts_(8)_1783564013865.zip`
- [asset] `attached_assets/tsconfig.base_(2)_(1)_1783564014142.json`
- [asset] `attached_assets/tsconfig_(7)_1783564014202.json`
- [asset] `attached_assets/تحليل_EngineeringOS_1783804577785.docx`
- [asset] `attached_assets/خطة_العمل_التنفيذية_لمشروع_EngineeringOS_1783729892699.docx`

### scripts
- [code] `scripts/check-codegen-drift.ts`
- [config] `scripts/package.json`
- [code] `scripts/post-merge.sh`
- [code] `scripts/src/hello.ts`
- [config] `scripts/tsconfig.json`

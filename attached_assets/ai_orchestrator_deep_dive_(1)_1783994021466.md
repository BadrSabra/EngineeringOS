# lib/ai-orchestrator — deep dive

## ما الذي تفعله هذه الطبقة
هذه الطبقة هي واجهة الذكاء التشغيلي في EngineeringOS. وظيفتها ليست “استدعاء LLM” فقط، بل:
- بناء سياق المشروع من قاعدة البيانات
- إرسال هذا السياق إلى نماذج Groq
- إرجاع مخرجات منظمة لعدة حالات استخدام:
  - chat
  - code review
  - scan analysis
  - task execution
  - workflow orchestration

الطبقة صغيرة نسبيًا في عدد الملفات، لكنها عالية التأثير لأن أي خلل فيها ينعكس مباشرة على:
- AI responses
- quality reviews
- workflow decisions
- task outputs
- trustworthiness of orchestrated actions

---

## فهرس الملفات

### 1) `src/groq-client.ts`
**الدور:** عميل Groq موحد + اختيار النموذج + إدارة الاستجابة.

**الملاحظات:**
- يوجد lazy initialization للعميل.
- API key تُقرأ من `GROQ_API_KEY`.
- هناك نموذج سريع ونموذج قوي:
  - `MODEL_FAST = llama-3.1-8b-instant`
  - `MODEL_POWERFUL = llama-3.3-70b-versatile`
- الدالة `complete()` تقوم بإرجاع `content`, `model`, `usage`.

**نقاط القوة:**
- فصل جيد بين client وagent logic.
- وجود fallback واضح عند غياب content.
- واجهة ثابتة تساعد بقية الطبقة.

**نقاط الضعف:**
- لا يوجد retry/backoff.
- لا يوجد timeout explicit.
- لا يوجد structured error mapping.
- لا يوجد telemetry/trace على مستوى الطلبات.
- لا يوجد دعم لـ response schemas أو validation قبل الرجوع إلى الوكلاء.

**الحالة:** جزئي ومقبول كبنية أولى، لكنه ليس production-hardened.

---

### 2) `src/context-builder.ts`
**الدور:** بناء سياق موحّد من قاعدة البيانات.

**المدخلات:**
- `projectsTable`
- `tasksTable`
- `metricsTable`
- `graphEntitiesTable`
- `eventsTable`

**المخرجات:**
- `project`
- `recentTasks`
- `latestMetrics`
- `graphSummary`
- `recentEvents`

**نقاط القوة:**
- هذا الملف هو القلب الحقيقي للمعرفة التي تُغذّي الـ LLM.
- يستخدم `Promise.all` لاستخراج عدة مصادر في وقت واحد.
- يقوم بتلخيص tasks/metrics/entities/events بصيغة إنسانية.

**الفجوات المهمة:**
- لا يوجد limit واضح لحجم نص `project` أو summaries الأخرى بشكل يحمي prompt budget.
- `graphSummary` يعتمد على `entities` فقط، ولا يصف العلاقات نفسها.
- لا يوجد ranking للأحداث/المهام حسب الصلة بالسياق المطلوب.
- لا يوجد فصل بين “context for chat” و“context for review” و“context for workflow”.
- إذا تغيّر schema، فإن هذا الملف سيكون أول نقطة تحتاج تحديثًا يدويًا.

**الحالة:** أهم ملف في الطبقة، لكنه ما زال summary-oriented أكثر من state-aware.

---

### 3) `src/agents/chat-agent.ts`
**الدور:** محادثة عامة عن المشروع.

**المخرجات:** `{ response, sources }`

**نمط التنفيذ:**
- System prompt يدمج project/metrics/graph/tasks/events.
- يطلب JSON:
  ```json
  { "response": "...", "sources": ["..."] }
  ```
- يستخدم `MODEL_FAST`.

**نقاط القوة:**
- مناسب للرد السريع.
- يفرض intent واضحًا: الرد بالعربية أو الإنجليزية حسب المستخدم.
- يطلب actionable ending.

**المشاكل:**
- parsing يعتمد على `JSON.parse` بعد إزالة code fences فقط.
- لا يوجد schema validation.
- لا يوجد guard إذا رجعت النماذج JSON ناقصة حقولًا أو مع أنواع خاطئة.
- fallback يرجع النص الخام، وهذا جيد للتعافي لكنه يضعف التناسق.
- system prompt كبير ومرئي جدًا للنموذج، لكنه غير مقسّم إلى contracts منفصلة.

**الحالة:** وظيفي، لكن هش أمام إخراج LLM غير المنضبط.

---

### 4) `src/agents/code-reviewer.ts`
**الدور:** إنتاج code review منظم.

**المخرجات:** score + strengths + issues + verdict.

**نقاط القوة:**
- schema أكثر نضجًا من chat-agent.
- يدعم إدخال ملفات مختارة `fileContents`.
- يحدّ عدد الملفات المستخدمة إلى 5 ويقصّ المحتوى إلى 1500 حرف، وهذا مهم جدًا.

**المشاكل:**
- لا يوجد تحقق من أن `overallScore` ضمن 0-100.
- لا يوجد enforcement لعدد issues أو شكلها.
- `fileContents` تُدرج نصيًا في prompt بدون metadata إضافية مثل language/type.
- fallback يرجع `needs_changes` دائمًا تقريبًا؛ هذا قد يربك المستهلكين.
- لا يوجد ربط مباشر بين output وبين evidence من scanner أو graph.

**الحالة:** جيدة وظيفيًا، لكنها تحتاج validation طبقي ومصادر أدلة أقوى.

---

### 5) `src/agents/scan-analyst.ts`
**الدور:** تحليل نتائج الفحص وتحويلها إلى insights.

**المخرجات:** summary + assessment + insights + priority + impact.

**نقاط القوة:**
- يركّز على priorities.
- مناسب لتحويل scan output إلى action plan.
- schema أوضح من chat-agent.

**المشاكل:**
- parsing هش بنفس النمط.
- لا يوجد enforcement لترتيب insights حسب severity.
- لا يوجد coupling مع scan metrics الفعلية أو thresholds.
- fallback يضع `overallAssessment = response.content`، وهذا قد يخلط بين raw LLM output وبين الحقول المتوقعة.
- لا يوجد اختبار على cases فشل JSON.

**الحالة:** مناسبة للتحليل الأولي، لكنها ليست محصنة من أخطاء model output.

---

### 6) `src/agents/task-agent.ts`
**الدور:** تنفيذ مهمة هندسية على مستوى LLM.

**المخرجات:** summary + steps + result + confidence + needsHumanReview.

**نقاط القوة:**
- يصف task title/priority/description/prompt/related files بوضوح.
- schema مقروء ومناسب للتخزين.
- واضح أن `needsHumanReview` عنصر مهم في الحوكمة.

**المشاكل:**
- related files تُمرّر كقائمة أسماء فقط، بلا محتوى أو خصائص.
- لا يوجد input sanitization أو prompt segmentation.
- لا يوجد enforced limit لعدد الملفات أو طولها على مستوى input.
- لا يوجد guard لمنع hallucination أو تنفيذ أوامر خارج نطاق التحقق.
- fallback ضخم النطاق ويعتمد على النص الخام.

**الحالة:** عملي، لكن يحتاج حواجز أمان وتحقق أكثر صرامة.

---

### 7) `src/agents/workflow-orchestrator.ts`
**الدور:** اتخاذ قرار حول workflow state.

**المخرجات:** action + reasoning + nextPhase + blockers + suggestions.

**نقاط القوة:**
- مناسب جدًا للمنظومة لأن workflow decision هنا حساس.
- يحول phase definitions إلى summary واضح.
- يدعم current/completed phases.

**المشاكل:**
- `condition` داخل phase هي نص حر، وليس expression قابل للتقييم.
- القرار يعتمد على LLM بدلاً من policy engine صارم.
- لا يوجد check يضمن أن `nextPhase` ضمن phase names الحقيقية.
- لا يوجد آلية deterministic fallback عندما تكون البيانات كافية لاتخاذ القرار دون LLM.
- `additionalContext` موجودة في signature لكن غير مفصّلة كوحدة سياقية.

**الحالة:** أهم ملف يحتاج تقوية إذا أردت workflow governance حقيقية.

---

### 8) `src/index.ts`
**الدور:** re-export layer.

**الملاحظات:**
- ملف نظيف ومفيد.
- لا يحتوي منطق.
- مناسب كبوابة API عامة.

**الحالة:** مكتمل تقريبًا.

---

## ما هو “المشكلة المركزية” في الطبقة
المشكلة ليست في وجود LLM، بل في **مستوى الانضباط حول LLM**:

1. **Prompt contracts** موجودة، لكن فقط كنصوص مضمّنة داخل الملفات.
2. **Parsing resilience** ضعيفة، لأنها تعتمد على `JSON.parse` + إزالة fences فقط.
3. **Validation** غير موجودة بعد parsing.
4. **Tests** شبه غائبة داخل الحزمة.
5. **Typed outputs** موجودة في TypeScript، لكن لا تُفرض runtime.
6. **Context builder** قوي، لكنه لا يطبّق segmentation حسب use case.

---

## تقييم طبقة `ai-orchestrator`
### المكتمل
- وجود بنية agents متعددة.
- وجود عميل Groq موحد.
- وجود `ProjectContext` موحّد.
- وجود outputs منظمة لكل use case.
- وجود fallback آليات تعافي أساسية.

### الجزئي
- parsing
- validation
- safety boundaries
- context sizing
- workflow determinism
- error handling/telemetry

### المفقود
- اختبارات unit/integration
- schema validation runtime
- retry policy
- timeout policy
- prompt versioning
- structured observability
- deterministic rule-based fallback paths

---

## أولويات الإغلاق العملية
1. إضافة runtime schema validation لكل agent output.
2. فصل prompt templates عن implementation.
3. إضافة tests parsing + fallback + invalid JSON.
4. تقوية `workflow-orchestrator` بحدود phase validation.
5. إدخال timeout/retry/circuit-breaker في `groq-client`.
6. تقطيع `context-builder` إلى contexts خاصة بكل use case.
7. إضافة trace IDs / correlation IDs في كل request.

---

## الخلاصة التنفيذية
هذه الطبقة ليست ضعيفة، لكنها **غير محصنة بعد**.  
هي مناسبة لمنتج قيد البناء، لكنها ما زالت تعتمد على حسن سلوك النموذج أكثر من اعتمادها على:
- contracts صارمة
- validation
- الاختبارات
- deterministic fallbacks

هذا يجعلها نقطة الاستكمال الطبيعية التالية بعد `api-server` و`scanner` و`knowledge-engine`.

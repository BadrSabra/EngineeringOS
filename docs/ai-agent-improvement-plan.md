# خطة تطوير الوكيل الذكي الداخلي — EngineeringOS

> **تاريخ الإصدار:** 2026-08-04  
> **المصادر العلمية:**  
> - *When Agents Do Not Stop: Uncovering Infinite Agentic Loops in LLM Agents* — arXiv:2607.01641 (2026)  
> - *ReAcTree: Hierarchical LLM Agent Trees with Control Flow for Long-Horizon Task Planning* — arXiv:2511.02424 (2025)  
> - *A-Mem: Agentic Memory for LLM Agents* — NeurIPS 2025  
> - *Towards Lifelong Dialogue Agents via Timeline-based Memory Management* — NAACL 2025  
> - *Agentic Reasoning Patterns (2026): ReAct, Reflexion, Plan-Execute & ToT Compared* — servicesground.com  
> - *Hierarchical Planning with Knowledge Graph-RAG and Symbolic Verification* — ICML Proceedings 2025  
> - *Enhancing LLM-Based Agents via Global Planning and Hierarchical Execution* — arXiv:2504.16563 (2025)  
> - *Step Limits for AI Agents: how to stop loops before an incident* — Agent Patterns Catalog  
> - *Unbounded Loop Pattern* — agentpatternscatalog.org  
>
> **بيانات مدخلة من الوكيل الداخلي:** 5 جلسات / 140 رسالة / مشروع `b2378e32` — 2026-08-03

---

## التشخيص — ما كشفته بيانات الجلسات

| المشكلة | الدليل من الجلسات | الكود المسؤول |
|---------|-----------------|--------------|
| **حد الخطوات يُوقف المهمة قبل اكتمالها** | 3 من 5 جلسات انتهت بـ "exhausted" | `tool-execution-engine.ts:453-464` → `kind:'exhausted'` |
| **لا تخطيط قبل بدء القراءة** | الوكيل يقرأ 24 ملفاً عشوائياً ثم ينفد من الخطوات | لا يوجد planner قبل `executeToolLoop` |
| **تفتت الجلسات** | 5 جلسات ليوم واحد لنفس المشروع | كل جلسة تبدأ من الصفر |
| **"أكمل" المتكررة** | 6 مرات في جلستين | الوكيل يُجزّئ دون استراتيجية |
| **حد ثابت للحجم** | `DEFAULT_MAX_ITERATIONS=20` لكل الأنواع | لا تمييز بين استعلام chat وتنفيذ task |

---

## الهندسة الحالية (الواقع)

```
chat-agent.ts
  └─ resolveExecutionDecision(scope)        ← تحديد النطاق
  └─ speculativePrefetch(message)           ← pre-fetch للملفات المذكورة صراحةً
  └─ executeToolLoop({maxIter=20, maxCalls=50})
       ├─ iter 0-N: model.call() → tool calls → execute → append
       ├─ soft guard @ maxToolCalls: inject "synthesize now" msg
       └─ hard guard @ maxIterations: return {kind:'exhausted'}
  └─ kind:'exhausted' → رسالة خطأ للمستخدم ❌
```

**المشكلة الجذرية:** الوكيل يعمل بنمط **Unbounded ReAct** بحد ثابت بدلاً من **Plan-then-Execute** بحد ديناميكي — وهو ما تُحذر منه أبحاث 2025/2026 صراحةً.

---

## الخطة — 5 مراحل متدرجة

---

### المرحلة 1 — إلغاء الحد الصلب واستبداله بحد ديناميكي ذكي
**الأولوية: عاجل | الجهد: يومان | الأثر: يُحل 80% من مشكلة "exhausted"**

**المرجع العلمي:**  
ورقة arXiv:2607.01641 (2026) توثّق أن الحد الصلب الذي يُعيد رسالة خطأ هو أسوأ الخيارات — يُحبط المستخدم دون أن يُقدم قيمة. البديل الموصى به: **circuit-breaker مع synthesis trigger**.

ورقة agentpatternscatalog.org تُعرّف الأنماط الثلاثة:
1. **Hard Stop** (الحالي) — مرفوض في الإنتاج
2. **Soft Limit + Synthesis** — موصى به
3. **Dynamic Budget** — الأمثل

**التغييرات:**

#### `lib/ai-orchestrator/src/tool-execution-engine.ts`
```typescript
// القيم الافتراضية الجديدة حسب النطاق
export const BUDGET_BY_SCOPE = {
  chat:           { maxIterations: 12, maxToolCalls: 30 },
  task_execution: { maxIterations: 40, maxToolCalls: 100 },
  analysis:       { maxIterations: 25, maxToolCalls: 60 },
  code_review:    { maxIterations: 20, maxToolCalls: 50 },
} as const;

// عتبة الـ soft limit: عند 75% من maxIterations
// → يُحقن تعليمات "لخّص الآن" في messages بدلاً من الإيقاف
const SOFT_LIMIT_RATIO = 0.75;
```

الحلقة تصبح:
```
iter 0..N:
  if iter >= maxIterations * SOFT_LIMIT_RATIO && !synthesisTriggerSent:
    inject({role:'user', content:'الآن لخّص ما جمعته بإيجاز. لا تستدع أدوات إضافية.'})
    synthesisTriggerSent = true
  model.call() → ...
  if iter >= maxIterations:
    // Hard stop — لكن يُرجع آخر نص اكتشفه لا رسالة خطأ
    return { kind: 'partial', result: lastTextSeen, toolSources }
```

#### `lib/ai-orchestrator/src/agents/chat-agent.ts`
```typescript
import { BUDGET_BY_SCOPE } from '../tool-execution-engine.js';

// يحدد البودجيت بناءً على taskProfile
const scope = executionPlan.taskProfile.taskType; // 'chat' | 'task_execution' | 'analysis' ...
const budget = BUDGET_BY_SCOPE[scope] ?? BUDGET_BY_SCOPE.chat;

const loopResult = await executeToolLoop({
  ...existingOpts,
  maxIterations: budget.maxIterations,
  maxToolCalls:  budget.maxToolCalls,
});
```

#### `lib/ai-orchestrator/src/agents/chat-agent.ts` — معالجة `kind:'partial'`
```typescript
// بدلاً من رسالة الخطأ:
if (loopResult.kind === 'exhausted' || loopResult.kind === 'partial') {
  // استخدام آخر نص كاملاً بدلاً من رسالة الخطأ
  const partialText = loopResult.kind === 'partial'
    ? loopResult.result.content
    : generateExhaustionSummary(toolSources); // ملخص من المصادر التي جُمعت
  return { response: partialText, sources: toolSources, pendingChanges, _partial: true };
}
```

---

### المرحلة 2 — Query Planner: التخطيط قبل التنفيذ
**الأولوية: عالية | الجهد: 3 أيام | الأثر: تقليل استهلاك الخطوات بنسبة ~60%**

**المرجع العلمي:**  
- ReAcTree (arXiv:2511.02424): يُقسم المهام الطويلة إلى شجرة هرمية — كل عقدة لها حد خطواتها الخاص  
- arXiv:2504.16563: Global Planning + Hierarchical Execution — مرحلة التخطيط العالمي تُنتج خطة منظمة، ثم كل executor يعمل في نطاقه المحدد  
- agentpatterns.tech: Plan-and-Execute يُقلل tool calls بـ 40-65% مقارنةً بـ ReAct الخالص

**الملف الجديد:** `lib/ai-orchestrator/src/agents/query-planner.ts`

```typescript
export type QueryPlan = {
  subQueries:         SubQuery[];          // الاستعلامات الفرعية المرتبة
  targetFiles:        string[];            // الملفات المرشحة للقراءة
  targetEntities:     string[];            // كيانات الـ knowledge graph المعنية
  scopeEstimate:      'narrow' | 'medium' | 'broad'; // يحدد الـ budget
  suggestedIterations: number;             // maxIterations المقترح
  requiresToolUse:    boolean;
};

export type SubQuery = {
  intent:      string;   // "اقرأ ملف X", "ابحث عن Y", "لخّص Z"
  targetPaths: string[];
  priority:    number;
};

export async function planQuery(
  message: string,
  projectContext: ProjectContext,
  model: string,
  strategy: ProviderStrategy,
  apiKey: string,
): Promise<QueryPlan>;
```

**منطق التخطيط:**
1. **استعلام fast**: يُرسل الـ message + ملخص المشروع (بدون الملفات الكاملة) للنموذج السريع
2. **طلب JSON منظم**: `{targetFiles, targetEntities, scopeEstimate, subQueries}`
3. **ضمانات**: إذا فشل التحليل JSON → يُعاد إلى نمط ReAct العادي بحد medium
4. **مدة التخطيط**: حد زمني 5 ثوانٍ — إذا تجاوزه → يتجاوزه ويبدأ التنفيذ مباشرةً

**التكامل مع `chat-agent.ts`:**
```typescript
// قبل executeToolLoop:
let plan: QueryPlan | null = null;
if (tools != null && requiresToolExecution(message)) {
  plan = await planQuery(message, projectContext, modelDecision.model, strategy, apiKey)
    .catch(() => null); // فشل التخطيط لا يوقف التنفيذ
}

const budget = plan
  ? BUDGET_BY_SCOPE[plan.scopeEstimate === 'broad' ? 'task_execution' : 'chat']
  : BUDGET_BY_SCOPE[scope];

// إضافة الملفات المخططة إلى speculative-prefetch
if (plan?.targetFiles.length) {
  // دمج مع prefetch الحالي
}
```

---

### المرحلة 3 — A-Mem: الذاكرة العابرة للجلسات
**الأولوية: متوسطة | الجهد: 3 أيام | الأثر: إلغاء إعادة اكتشاف نفس الملفات في كل جلسة**

**المرجع العلمي:**  
- A-Mem (NeurIPS 2025): نظام ذاكرة ديناميكي للوكلاء — كل اكتشاف يُحوّل إلى "ذاكرة منظمة" (ملف، كيان، علاقة) تُخزّن وتُسترجع عبر الجلسات  
- NAACL 2025 (Timeline-based): ذاكرة Lifelong مع إدارة ذكية للأهمية والتقادم

**المشكلة الحالية:** المشروع `b2378e32` أنشأ 5 جلسات في يوم واحد — كل جلسة أعادت قراءة نفس 24 ملفاً.

**جدول جديد في قاعدة البيانات:**
```sql
CREATE TABLE ai_session_memories (
  id          TEXT PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  session_id  TEXT NOT NULL REFERENCES ai_chat_sessions(id) ON DELETE CASCADE,
  memory_type TEXT NOT NULL CHECK (memory_type IN ('file_summary','entity_fact','session_summary','key_finding')),
  content     TEXT NOT NULL,
  source_path TEXT,           -- الملف أو الكيان المصدر
  relevance   FLOAT DEFAULT 1.0, -- يتراجع مع الوقت (time decay)
  created_at  TIMESTAMPTZ DEFAULT now(),
  expires_at  TIMESTAMPTZ     -- ذكريات مؤقتة تنتهي تلقائياً
);
CREATE INDEX ON ai_session_memories (project_id, memory_type, relevance DESC);
CREATE INDEX ON ai_session_memories (session_id);
```

**آلية العمل:**
```
نهاية الجلسة:
  ← استخرج من toolSources: الملفات التي قُرئت فعلاً
  ← أنشئ memory_type='file_summary' لكل ملف مهم
  ← أنشئ memory_type='session_summary' ملخص الجلسة كاملاً

بداية الجلسة التالية (نفس المشروع):
  ← اجلب آخر 20 ذاكرة مرتبة بـ relevance DESC
  ← أضفها كـ "context memories" في system prompt
  ← أضف الملفات المحفوظة في speculative-prefetch cache
```

**التكامل مع context-builder.ts:**
```typescript
// في buildProjectContext():
const memories = await fetchSessionMemories(projectId, { limit: 20 });
return {
  ...existingContext,
  sessionMemories: memories.map(m => `[${m.memory_type}] ${m.source_path}: ${m.content}`).join('\n'),
};
```

---

### المرحلة 4 — Hierarchical Executor: تنفيذ المهام الطويلة بشجرة هرمية
**الأولوية: متوسطة | الجهد: 4 أيام | الأثر: حل نهائي لـ "ملخص الـ backlog" وأمثاله**

**المرجع العلمي:**  
ReAcTree (arXiv:2511.02424): بدلاً من loop واحد بحد 40، تُنشأ **شجرة مهام** — كل عقدة تنفّذ sub-loop مستقل بحد 5-10 خطوات، ثم النتائج تُدمج في synthesizer.

```
"ملخص الـ backlog وما يجب التركيز عليه"
├─ SubAgent-1: اقرأ docs/completion-plan.md (حد: 5 خطوات)
│   └─ result: "3 مراحل متبقية: governance, tests, UI"
├─ SubAgent-2: اقرأ docs/PR_BACKLOG.md (حد: 5 خطوات)
│   └─ result: "7 PRs مفتوحة، أعلى أولوية: PR-F"
├─ SubAgent-3: اقرأ attached_assets/PR_BACKLOG_*.md (حد: 5 خطوات)
│   └─ result: "..."
└─ Synthesizer: يدمج 3 نتائج → يُنتج ملخصاً شاملاً (حد: 0 خطوات — فقط نص)
```

**الملف الجديد:** `lib/ai-orchestrator/src/agents/hierarchical-executor.ts`
```typescript
export type HierarchicalTask = {
  intent:     string;
  targetPaths: string[];
  maxIter:    number;  // صغير: 5-8
};

export async function executeHierarchical(
  tasks: HierarchicalTask[],
  opts: HierarchicalOpts,
): Promise<HierarchicalResult>;
```

**متى يُستخدم؟**
- عندما `plan.scopeEstimate === 'broad'` (من المرحلة 2)
- عندما `subQueries.length > 3`
- التعداد التلقائي: `> 5` كيانات مستهدفة في الـ plan

---

### المرحلة 5 — Knowledge Graph-Guided Navigation
**الأولوية: مستقبلية | الجهد: 3 أيام | الأثر: توجيه دقيق بدلاً من استكشاف عشوائي**

**المرجع العلمي:**  
*Hierarchical Planning with KG-RAG* (ICML 2025): استخدام knowledge graph للتوجيه قبل tool calls يُقلل الاستكشاف العشوائي بـ 70%.

المشروع يملك `lib/knowledge-engine` مع BFS وGraph queries — نستغله هنا:

```typescript
// في query-planner.ts (المرحلة 2):
import { getNeighbourhood, searchNodes } from '@workspace/knowledge-engine';

async function enrichPlanWithGraph(plan: QueryPlan, projectId: string): Promise<QueryPlan> {
  // البحث عن كيانات مذكورة في الاستعلام
  const entities = await searchNodes(projectId, plan.targetEntities);
  
  // الحصول على الجوار (depth=2) للكيانات الأكثر صلة
  const neighbourhood = await Promise.all(
    entities.slice(0, 5).map(e => getNeighbourhood(projectId, e.id, { depth: 2 }))
  );
  
  // استخراج مسارات الملفات من الـ graph
  const graphFiles = neighbourhood.flatMap(n => n.nodes.map(node => node.sourcePath)).filter(Boolean);
  
  return {
    ...plan,
    targetFiles: [...new Set([...plan.targetFiles, ...graphFiles])].slice(0, 15),
  };
}
```

---

## ملخص التأثير المتوقع

| المشكلة | قبل الخطة | بعد المرحلة 1 | بعد المرحلة 2+3 |
|---------|----------|--------------|----------------|
| جلسات "exhausted" | 60% من الجلسات | <5% | <1% |
| "أكمل" المتكررة | 6+ مرات/يوم | نادر | مُزالة |
| إعادة قراءة نفس الملفات | كل جلسة | كل جلسة | مُزالة |
| "ملخص الـ backlog" يفشل | دائماً | أحياناً | نجاح دائم |
| استهلاك tool calls لاستعلام chat بسيط | 20-30 | 5-10 | 3-5 |

---

## خريطة الملفات

```
lib/ai-orchestrator/src/
├── tool-execution-engine.ts       ← تعديل: BUDGET_BY_SCOPE، soft-limit، kind:'partial'
├── agents/
│   ├── chat-agent.ts              ← تعديل: dynamic budget، plan integration
│   ├── query-planner.ts           ← جديد (المرحلة 2)
│   └── hierarchical-executor.ts  ← جديد (المرحلة 4)
└── context-builder.ts             ← تعديل: sessionMemories injection (المرحلة 3)

lib/db/src/schema/
└── ai.ts                          ← تعديل: إضافة ai_session_memories table

artifacts/api-server/src/routes/ai/
└── chat.ts                        ← تعديل: تشغيل memory write بعد انتهاء الجلسة
```

---

## ترتيب التنفيذ الموصى به

```
الأسبوع 1:  المرحلة 1 (يومان) ← أكبر أثر، أقل تعقيداً
الأسبوع 2:  المرحلة 2 (3 أيام) ← يعتمد عليها المرحلتان 4 و 5
الأسبوع 3:  المرحلة 3 (3 أيام) ← مستقلة تماماً
الأسبوع 4:  المرحلة 4 (4 أيام) ← تعتمد على المرحلة 2
مستقبلاً:   المرحلة 5 (3 أيام) ← تعتمد على المرحلتين 2 و 4
```

---

## مراجع إضافية للتطبيق

| المرجع | الرابط | الصلة بالمشروع |
|--------|--------|---------------|
| arXiv:2607.01641 | arxiv.org/abs/2607.01641 | نمط circuit-breaker للمرحلة 1 |
| arXiv:2511.02424 | arxiv.org/abs/2511.02424 | شجرة التنفيذ الهرمية للمرحلة 4 |
| A-Mem NeurIPS 2025 | proceedings.neurips.cc | بنية الذاكرة للمرحلة 3 |
| arXiv:2504.16563 | arxiv.org/abs/2504.16563 | Global Planning للمرحلة 2 |
| KG-RAG ICML 2025 | proceedings.mlr.press/v267 | توجيه الـ knowledge graph للمرحلة 5 |
| Agent Patterns Catalog | agentpatternscatalog.org | نمط Unbounded Loop vs Soft Limit |

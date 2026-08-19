# ENGINEERINGOS_MASTER_EXECUTION_CONSTITUTION
## Engineering Truth Verification — Master Reference Built From the Current Codebase

**Purpose**  
This document converts the current repository into a single engineering reference that can support all later development. It is based on the actual code, schemas, routes, generated artifacts, provenance imports, memory notes, and operational documentation already present in the project.

**What this is**  
A canonical implementation constitution for **Engineering Truth Verification (ETV)** — the layer that keeps EngineeringOS aligned across code, docs, assets, provenance, runtime behavior, and decisions.

**What this is not**  
Not a generic architecture essay. Not a future-only vision. This is anchored in the current repository and names the real surfaces that already exist.

---

## 1) Current codebase reality

EngineeringOS already contains the raw ingredients of an engineering truth system:

### Canonical reference surfaces already present
- `lib/api-spec/openapi.yaml` — contract source for API behavior.
- `lib/api-zod/src/generated/*` — generated request/response schemas.
- `lib/api-client-react/src/generated/*` — generated client surface for the dashboard.
- `lib/db/src/schema/*` — relational model for projects, tasks, workflows, events, metrics, graph, audits, discovery, scan jobs, chats.
- `artifacts/api-server/src/routes/*` — runtime behavior and protected API surface.
- `artifacts/api-server/src/lib/audit.ts` — audit/provenance write path.
- `artifacts/api-server/src/scripts/seed-provenance.ts` — provenance import pipeline.
- `lib/scanner/src/*` — AST/file analysis and graph extraction.
- `lib/knowledge-engine/src/*` — pure graph traversal and inference.
- `artifacts/dashboard/src/pages/*` — operational UI.
- `docs/fact-record.md` — file-by-file truth registry.
- `docs/completion-plan.md` — phased sequence of what must be done next.
- `.agents/memory/*` — decision memory and execution notes.
- `attached_assets/EngineeringOS_provenance_registry_linked_*.json` — imported provenance source of truth.
- `attached_assets/EngineeringOS_provenance_registry_seed_*.json` — seed metadata supplement.

### What the current system already proves
- The project is contract-first.
- The project already has a navigable Knowledge Graph.
- The project already records audit and correlation IDs.
- The project already distinguishes source truth from generated/derived surfaces.
- The project already has a provenance import path that loaded 459 entities and 4,231 relationships.
- The project already enforces ownership on key runtime routes.
- The project already has the material to build a full truth-verification loop.

---

## 2) Engineering Truth Verification (ETV)

### Definition
Engineering Truth Verification is the continuous process of proving that the system’s important claims match reality.

A claim may concern:
- a file,
- a schema,
- an API route,
- a runtime behavior,
- a graph entity,
- a decision,
- a document,
- a generated artifact,
- or a historical record.

For each claim, ETV asks:
1. What is the subject?
2. What is its source?
3. What evidence supports it?
4. What does it depend on?
5. What does it affect?
6. Is runtime behavior consistent with the claim?
7. Has the subject drifted since the last verification?

### Non-negotiable rule
No important development artifact may be treated as authoritative unless it is:
- traceable,
- evidenced,
- classified,
- and currently verified.

---

## 3) The truth layers

EngineeringOS must be treated as six intersecting truth layers.

### 3.1 Source truth
The canonical intent.
Examples:
- OpenAPI
- DB schema
- approved constitution
- approved decision records

### 3.2 Derived truth
Generated or inferred from source truth.
Examples:
- API Zod schemas
- React Query hooks
- generated docs
- graph summaries
- scan output

### 3.3 Runtime truth
The behavior of the running system.
Examples:
- route handling
- workflow execution
- discovery import
- graph queries
- auth behavior

### 3.4 Historical truth
What existed before and should still be known.
Examples:
- prior truth registers
- archived reports
- memory notes
- attached assets

### 3.5 Decision truth
Why the system is shaped the way it is.
Examples:
- completion plan
- design decisions
- PR roadmap
- exception notes

### 3.6 Provenance truth
How evidence and origin move through the system.
Examples:
- upstream/downstream
- decision_refs
- evidence_refs
- supersedes chains
- verification state

---

## 4) What already exists in code that ETV can reuse

### 4.1 Audit and correlation
The project already has:
- `audit_logs` table
- `events` table
- `metrics` table
- `task_logs` table
- `correlationId` fields in several runtime tables

This is the backbone of traceability.

### 4.2 Graph model
The project already has:
- `graph_entities`
- `graph_relationships`
- graph provenance metadata
- graph summary / path / centrality APIs
- graph UI page

This is the backbone of knowledge representation.

### 4.3 Discovery and scanning
The project already has:
- discovery sessions
- scan jobs
- scanner AST extraction
- graph extraction
- discovery import
- job reconciliation

This is the backbone of how truth enters the system.

### 4.4 Governance documentation
The project already has:
- `docs/fact-record.md`
- `docs/completion-plan.md`
- `.agents/memory/*`

This is the backbone of truth governance.

### 4.5 Contract enforcement
The project already has:
- OpenAPI contract
- generated schemas
- generated clients
- drift check scripts

This is the backbone of contract consistency.

---

## 5) The missing layer: Engineering Truth Verification service

The repository does not yet have a dedicated ETV layer as a first-class subsystem.  
That layer must provide:
- verification rules,
- truth classification,
- evidence linkage,
- drift detection,
- verification runs,
- and synthesis of operational status.

### The ETV layer must answer:
- Is this subject current?
- What is the upstream source?
- What evidence proves it?
- What is the downstream impact?
- Has the runtime diverged?
- Does the graph still match reality?
- Does the document still match the code?

---

## 6) Proposed ETV implementation architecture

### 6.1 Truth registries
Add formal registries for:
- `truth_verification_runs`
- `truth_verification_findings`
- `truth_verification_rules`
- `truth_verification_targets`
- `truth_evidence_links`

These registries should be stored in the database so truth can be queried, audited, and surfaced in UI.

### 6.2 Verification service
Add a service that:
- reads repository/state inputs,
- classifies subjects,
- evaluates rules,
- compares source vs runtime vs docs,
- records findings,
- writes a verified snapshot.

### 6.3 Rules engine
Rules should be expressed in a simple data model:
- rule id
- subject kind
- condition
- severity
- evidence requirement
- remediation step

Examples:
- OpenAPI route exists in server.
- Generated client matches contract hash.
- DB relation exists for documented runtime operation.
- Historical asset is not misclassified as current truth.
- Graph entity has provenance metadata.
- Audit event exists for a state-changing action.

### 6.4 Verification snapshot
Each run produces a snapshot with:
- timestamp
- subject set
- score/confidence
- drifts
- findings
- remediation priorities
- pass/fail summary

### 6.5 UI surface
Expose the verification result through:
- dashboard status page,
- graph overlays,
- operational truth register view,
- drift summary page,
- decision/provenance views.

---

## 7) How ETV should connect to existing files

### Source surfaces to verify
- `lib/api-spec/openapi.yaml`
- `lib/db/src/schema/*.ts`
- `artifacts/api-server/src/routes/*.ts`
- `lib/scanner/src/*.ts`
- `lib/knowledge-engine/src/*.ts`
- `docs/fact-record.md`
- `docs/completion-plan.md`
- `.agents/memory/*.md`

### Mapped runtime responsibilities
- `routes/graph.ts` → graph truth and provenance surfaces
- `routes/discovery.ts` → import/discovery truth surfaces
- `routes/tasks.ts` and `routes/workflows.ts` → execution truth surfaces
- `routes/events.ts` and `routes/metrics.ts` → trace and evidence surfaces
- `routes/ai.ts` → AI-assisted review surfaces
- `audit.ts` → change provenance surface
- `seed-provenance.ts` → initial registry population

---

## 8) Operational truth contract

Any artifact is considered valid only if it satisfies the following contract:

### Contract fields
- `subject`
- `subject_kind`
- `layer`
- `source`
- `upstream`
- `downstream`
- `decision_refs`
- `evidence_refs`
- `runtime_check`
- `verification_state`
- `last_verified`
- `drift_risk`
- `operational_impact`

### Required states
- `source`
- `derived`
- `runtime`
- `historical`
- `decision`
- `verified`
- `drifted`
- `superseded`

---

## 9) Suggested TypeScript model

The following types represent the minimum ETV contract.

```ts
export type TruthLayer =
  | "source"
  | "derived"
  | "runtime"
  | "historical"
  | "decision"
  | "provenance";

export type VerificationState = "verified" | "partial" | "drifted" | "unknown";

export type TruthSubjectKind =
  | "file"
  | "route"
  | "schema"
  | "table"
  | "entity"
  | "relationship"
  | "document"
  | "decision"
  | "event"
  | "metric"
  | "task"
  | "workflow"
  | "scan"
  | "ui"
  | "memory";

export interface TruthRecord {
  subject: string;
  subjectKind: TruthSubjectKind;
  layer: TruthLayer;
  source?: string;
  upstream: string[];
  downstream: string[];
  decisionRefs: string[];
  evidenceRefs: string[];
  runtimeCheck?: string;
  verificationState: VerificationState;
  lastVerified?: string;
  driftRisk?: "low" | "medium" | "high" | "critical";
  operationalImpact?: string;
}
```

---

## 10) Minimum build sequence

This sequence follows the existing inside-out order in `docs/completion-plan.md`.

### Phase A — Ground truth registry
- Normalize current truth registers.
- Link fact records to actual code surfaces.
- Identify authoritative versus historical assets.
- Define verification subject taxonomy.

### Phase B — Verification storage
- Add database tables for verification runs, findings, and rules.
- Wire creation/update of verification records into audit flow.

### Phase C — Verification service
- Implement rule evaluation against code, docs, graph, and runtime snapshots.
- Persist findings and scores.

### Phase D — Drift detection
- Compare contract vs implementation.
- Compare docs vs runtime.
- Compare provenance graph vs imported registry.
- Compare historical assets vs current truth.

### Phase E — UI exposure
- Add pages or panels for truth state, verification runs, and drift findings.

### Phase F — Enforcement
- Block promotion of high-risk work if truth is incomplete or drifted.
- Require verification before a build is considered stable.

---

## 11) Acceptance criteria

ETV is real only when all of the following are true:

1. A subject can be traced to its source.
2. A subject can be linked to supporting evidence.
3. A subject can be classified by truth layer.
4. A subject can be checked against runtime behavior.
5. Drift can be reported automatically.
6. A verification snapshot can be regenerated.
7. Historical documents are not mistaken for current truth.
8. Development decisions can reference the verification record.
9. The graph can expose provenance and operational impact.
10. Future work can use this document as the baseline authority.

---

## 12) Practical definition of success

When ETV is in place, EngineeringOS will no longer be a collection of files that merely happen to work together. It will be a **verified engineering system** where every major change is grounded in evidence, visible in the graph, auditable in the runtime, and comparable to the documented intent.

That is the reference the project should build on next.

## 11. Truth Flow Matrix — Current Status

> **ملاحظة:** هذه الحالة مبنية على الأرشيف والكود والوثائق الموجودة فعليًا داخل المستودع، وهي تصف النضج الحالي لا النية النظرية.

| node | status | confidence | next action | exact repo paths |
|---|---|---:|---|---|
| **Source Contracts** | **جزئي** | 0.90 | تثبيت contract drift checks كحارس إلزامي بين OpenAPI/DB/docs والـ runtime، وإقفال أي اختلاف قبل الاعتماد. | `lib/api-spec/openapi.yaml`, `lib/db/src/schema/*`, `docs/fact-record.md`, `docs/completion-plan.md` |
| **Codegen Layer** | **جزئي** | 0.92 | ربط أي تغيير في العقد بإعادة توليد تلقائية، ثم إضافة تحقق hash/shape يمنع بقاء generated artifacts قديمة. | `lib/api-spec/orval.config.ts`, `lib/api-zod/src/generated/*`, `lib/api-client-react/src/generated/*` |
| **Dashboard Consumption** | **جزئي** | 0.85 | التحقق أن كل صفحة/Hook يستهلك generated client فقط، وإضافة فحص يمنع الاستدعاءات غير المعرّفة بالعقد. | `artifacts/dashboard/src/pages/*`, `artifacts/dashboard/src/components/*`, `lib/api-client-react/src/generated/*` |
| **API Runtime** | **جزئي** | 0.88 | توسيع تغطية المسارات الحرجة باختبارات contract/runtime parity، وربط أي route جديد بمراجعة auth/access/audit. | `artifacts/api-server/src/app.ts`, `artifacts/api-server/src/index.ts`, `artifacts/api-server/src/routes/*`, `artifacts/api-server/src/middlewares/requireAuth.ts`, `artifacts/api-server/src/middlewares/requireProjectAccess.ts` |
| **Audit / Event Trace** | **جزئي** | 0.84 | فرض correlation ID إلزامي لكل عملية متغيرة للحالة، وإضافة تحقق بأن كل action حرجة تترك أثرًا في audit/event/metric. | `artifacts/api-server/src/lib/audit.ts`, `artifacts/api-server/src/routes/events.ts`, `artifacts/api-server/src/routes/metrics.ts`, `artifacts/api-server/src/routes/tasks.ts` |
| **Discovery / Scan** | **جزئي** | 0.87 | تحويل discovery إلى pipeline قابل لإعادة التشغيل مع قياس completeness، وتسجيل أي file classification drift. | `artifacts/api-server/src/routes/discovery.ts`, `artifacts/api-server/src/lib/scan-runner.ts`, `lib/scanner/src/*` |
| **Knowledge Graph** | **جزئي** | 0.89 | رفع الجراف من Graph ملفات إلى Graph معرفة هندسية، وإضافة فحص consistency للعلاقات والنوع والاتجاه والنسخ الزمنية. | `artifacts/api-server/src/routes/graph.ts`, `lib/knowledge-engine/src/*`, `lib/db/src/schema/*` |
| **Provenance Import** | **مكتمل** | 0.98 | تثبيت import pipeline كعملية رسمية قابلة للإعادة مع versioning للسجلات ومقارنة بين seed/linked/current snapshots. | `artifacts/api-server/src/scripts/seed-provenance.ts`, `attached_assets/EngineeringOS_provenance_registry_seed_*.json`, `attached_assets/EngineeringOS_provenance_registry_linked_*.json` |
| **Decision Memory** | **جزئي** | 0.82 | تحويل memory notes إلى decision registry رسمي، وربط كل قرار بمرجع وأثر وحالة supersession. | `.agents/memory/*`, `docs/completion-plan.md`, `docs/fact-record.md` |
| **Historical Archive** | **مكتمل** | 0.95 | تصنيف الأصول التاريخية رسميًا كـ historical-only أو evidence-supporting، ومنع خلطها بالحقيقة الحالية. | `attached_assets/*`, `docs/*`, archived reports and exported analysis files |
| **AI Orchestration** | **جزئي** | 0.80 | ربط AI context حصريًا بالحقائق الموثقة من الجراف والـ provenance، وإضافة guardrails تمنع reasoning على بيانات قديمة. | `lib/ai-orchestrator/src/*`, `artifacts/api-server/src/routes/ai.ts` |
| **Truth Governance / ETV** | **مفقود كطبقة تنفيذية** | 0.93 | بناء خدمة Engineering Truth Verification كطبقة تشغيلية فعلية: rules, runs, findings, drift register, verification snapshots. | `docs/ENGINEERINGOS_MASTER_EXECUTION_CONSTITUTION.md`, `docs/fact-record.md`, `docs/completion-plan.md`, truth registry artifacts |

### قراءة سريعة للحالة

- **أقوى نقطة نضج:** Provenance Import وHistorical Archive.
- **أكبر مناطق drift المحتملة:** Source Contracts، Codegen Layer، API Runtime، Knowledge Graph.
- **أهم فجوة معمارية:** غياب طبقة ETV التنفيذية كخدمة/نظام حاكم.
- **النتيجة العملية:** المشروع يملك المادة الخام الكاملة تقريبًا، لكنه يحتاج الآن طبقة توحيد وحوكمة تمنع الانفصال بين الحقيقة المعلنة والحقيقة المنفذة.

### قاعدة اعتماد عامة

لا يُعتبر أي node مكتملًا فعليًا إلا إذا توفّر له:
1. مصدر واضح،
2. أثر تشغيلي،
3. دليل قابل للمراجعة،
4. مسار upstream/downstream،
5. آلية كشف drift،
6. وخطوة تصحيح واضحة عند الانحراف.


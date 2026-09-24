# سجل تقدم خطة تعميم الوكيل الهندسي

> هذا السجل جزء من `docs/agent-generalization-execution-plan.md`.
> يجب على الوكيل التالي تحديثه بعد كل خطوة مكتملة، وقبل الانتقال إلى الخطوة
> التالية. لا تعتبر المرحلة منجزة من دون إدخال يثبت معيار الخروج والتحقق.

## الحالة الحالية

**آخر تحديث:** 2026-09-24  
**الوضع:** Shadow/read-only في طبقات Episode وObservation وWorld State  
**المصدر الرئيسي:** `docs/agent-generalization-execution-plan.md`

| المرحلة | الحالة | النطاق المنجز أو المتبقي |
|---|---|---|
| P0 — Contracts, baseline, threat model | `done` | عقود agent-state واختبارات parsing/hash/redaction موجودة. |
| P1 — Episode schema + ledger | `done` | جداول Episode/Observation/Effect/World/Strategy والـledger واختبارات ownership/idempotency/replay موجودة. |
| P2 — Episode integration in Chat/Mission | `partial` | Chat وTask/Recipe متكاملة؛ تكامل Mission/Workflow يحتاج تأكيدًا أو استكمالًا قبل إغلاق المرحلة. |
| P3 — Observation materialization | `done` | مصادر server-owned مع completeness/freshness/revision وربط بالـepisode. |
| P4 — World facts + materialized reader | `partial` | read model، contradictions، supersession، world revision، endpoint محمي وContext projection منجزة؛ تغطية effect/browser/Git الكاملة ليست منجزة بعد. |
| P5 — Effect contract for candidate validation | `not_started` | يلزم before/after effect bundle وربطه بالـacceptance في نفس المعاملة. |
| P6 — Runtime/browser/delivery observers | `not_started` | يلزم توحيد observers والتحقق من الأثر بعد التنفيذ. |
| P7 — Failure diagnosis | `not_started` | تصنيف server-owned للفشل وربطه بالـnext action. |
| P8 — Bounded hypothesis-aware replan | `not_started` | ربط diagnosis بـobjective/Mission replanning مع no-progress guard. |
| P9 — Strategy candidate extraction | `not_started` | استخراج strategy من episodes المقبولة دون منحها صلاحية. |
| P10 — Replay and generalization benchmark | `not_started` | current/held-out/cross-project evaluation وlearning delta. |
| P11 — Strategy canary/promotion/revocation | `not_started` | promotion مضبوط وrollback/revocation. |
| P12 — Capability composition | `not_started` | composition آمن عبر contracts وsandbox وshadow replay. |
| P13 — Multimodal extension | `not_started` | مؤجل إلى ما بعد effect/evidence loop. |

## سجل الخطوات

### 2026-09-24 — World State read-only وContext projection

- **phase/step:** P4 / World State read model
- **status:** `partial`
- **what changed:** materialized read-only facts من observations الموثوقة، world
  revision deterministic، contradictions وsupersession، endpoint محمي،
  وbounded `worldState` context slice مع cache invalidation مخصص.
- **files/schema/contracts touched:** `artifacts/api-server/src/lib/agent-state`,
  `artifacts/api-server/src/routes/projects.ts`,
  `lib/ai-orchestrator/src/context-*`,
  `lib/ai-orchestrator/src/schemas/context.schema.ts`.
- **validation:** API typecheck؛ اختبارات World State والroute (11)؛ اختبارات
  Context Builder/Loader (81)؛ `git diff --check`؛ `/api/healthz` أعاد `ok`.
- **authority/safety impact:** read-only؛ لا يغير acceptance أو proof أو planner
  أو permissions؛ provider prose لا يدخل materialization.
- **next step:** إغلاق تكامل Episode مع Mission/Workflow، ثم بدء P5 Effect
  Observation.

## قالب إلزامي لكل خطوة لاحقة

انسخ هذا القالب وأكمله بعد كل خطوة، قبل تنفيذ الخطوة التالية:

```md
### YYYY-MM-DD — [اسم الخطوة]

- **phase/step:** [P# / step]
- **status:** `done` | `partial` | `blocked`
- **what changed:** [وصف قابل للتحقق]
- **files/schema/contracts touched:** [المسارات أو الجداول]
- **validation:** [الأوامر والنتائج]
- **authority/safety impact:** [proof/acceptance/permissions/planner]
- **remaining/blocker:** [ما بقي أو `none`]
- **next step:** [الخطوة التالية المسموح بها]
```

لا تحذف الإدخالات التاريخية. إذا تغير الحكم، أضف إدخال تصحيحًا يوضح سبب
التغيير بدل تعديل السجل بصمت.
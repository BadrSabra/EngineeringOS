# Truth Flow Matrix — PR-ready Checklist

## الهدف
تحويل Truth Flow Matrix إلى checklist تنفيذية قابلة للإغلاق عبر PRs متسلسلة.

## تعريف الفئات الأربع (مرجع الـ schema)

| الفئة | التعريف | المصدر |
|---|---|---|
| **baseline** | الحقيقة المجمّدة في `EXPECTED_CURRENT_TRUTH_FLOW_MATRIX`. لا تتغيّر إلا بقرار هندسي مراجَع. | `lib/api-zod/src/truth-flow-matrix.schema.ts` |
| **derived** | إشارات drift تنتجها `listTruthFlowDriftSignals()` عند المقارنة بين الـ baseline والـ JSON الحيّ. مؤقتة ولا تُخزَّن. | `scripts/validate-truth-flow.ts` |
| **historical** | ملفات `attached_assets/*` والوثائق الأرشيفية. صالحة كسياق/دليل، لكنها ليست الحقيقة الحالية أبداً. | `attached_assets/*` |
| **runtime** | ما ينتجه pipeline الفعلي (scan/graph/provenance) أثناء التشغيل. يُعلم تحديثات الـ baseline لكن لا يُحدّثها تلقائياً. | DB rows + scan jobs |

## قواعد الإغلاق

- إغلاق node يعني: (1) تحديث `EXPECTED_CURRENT_TRUTH_FLOW_MATRIX` في الـ schema، (2) تحديث الـ JSON baseline، (3) نجاح `pnpm run truth:validate`.
- أي node بلا `exactRepoPaths` حقيقية (min 1 مسار موثوق) لا يُعدّ مُغلَقاً.
- الحالات الصالحة للـ status: `complete` | `partial` | `missing` (من `TruthFlowNodeStatusSchema`).
- drift signals من `listTruthFlowDriftSignals()` هي: `missing` | `unexpected` | `status-mismatch` | `confidence-mismatch` | `repo-path-mismatch` | `duplicate-node` | `duplicate-path`.

## Baseline update safeguards

The exported `EXPECTED_CURRENT_TRUTH_FLOW_MATRIX` in
`lib/api-zod/src/truth-flow-matrix.schema.ts` is the single authority for the
current baseline. The checked-in JSON is a deterministic, reviewable
representation of that constant; the schema and JSON must move together.

Maintainer workflow:

1. Make an intentional, reviewed change to the schema baseline. Do not derive
   status, confidence, paths, node names, or actions from runtime or historical
   evidence automatically.
2. Run `pnpm run truth:baseline:materialize`. This explicit command writes the
   JSON from the exported schema constant using stable formatting and ordering.
3. Inspect the diff. The changed node fields must be explainable by the review
   decision; unrelated changes indicate a problem and must be corrected.
4. Run `pnpm run truth:baseline:check` to compare the checked-in JSON byte-for-byte
   with the schema representation.
5. Run `pnpm run truth:validate`. This remains the blocking structural and
   provider-free parity gate.

`truth:baseline:check` fails clearly when the JSON is missing or diverges. It
never falls back to historical files, runtime output, or inferred values.

## 1) Source Contracts
- [ ] إضافة contract drift check بين OpenAPI وDB schema والـ runtime routes.
- [ ] منع merge إذا وُجد mismatch غير مبرر.
- [ ] توثيق source-of-truth لكل endpoint/table/field.

## 2) Codegen Layer
- [ ] ربط أي تعديل في العقد بإعادة توليد تلقائية.
- [ ] إضافة hash/shape verification للـ generated artifacts.
- [ ] منع commit إذا كانت generated outputs قديمة.

## 3) Dashboard Consumption
- [ ] حصر استهلاك dashboard على generated clients فقط.
- [ ] فحص أي direct API usage خارج generated surface.
- [ ] التحقق من consistency بين UI routes وtyped APIs.

## 4) API Runtime
- [ ] إضافة parity tests بين routes والعقود.
- [ ] إلزام كل route جديد بمراجعة auth/access/audit.
- [ ] التحقق من أن كل state-changing handler يمر عبر audit.

## 5) Audit / Event Trace
- [ ] فرض correlation ID إلزامي لكل عملية حرجة.
- [ ] تسجيل كل action مؤثرة في audit/event/metric.
- [ ] إضافة test يثبت trace completeness.

## 6) Discovery / Scan
- [ ] جعل discovery pipeline قابلة لإعادة التشغيل.
- [ ] تسجيل completeness وclassification drift لكل scan.
- [ ] التحقق من أن scan يلتقط الملفات/العُقد المتوقعة.

## 7) Knowledge Graph
- [ ] توسيع graph من file graph إلى engineering knowledge graph.
- [ ] فحص consistency للعلاقات والاتجاهات والنسخ الزمنية.
- [ ] ربط graph entities بـ provenance/evidence.

## 8) Provenance Import
- [ ] تثبيت seed/import pipeline كعملية رسمية قابلة للإعادة.
- [ ] مقارنة seed/linked/current snapshots.
- [ ] توثيق نسب العلاقات: feeds / decision_ref / evidence_ref.

## 9) Decision Memory
- [ ] تحويل memory notes إلى decision registry رسمي.
- [ ] ربط كل قرار بمرجع وأثر وحالة supersession.
- [ ] منع استخدام قرار stale كمرجع current.

## 10) Historical Archive
- [ ] تصنيف الأصول التاريخية كـ historical-only أو evidence-supporting.
- [ ] منع خلط historical artifacts بالحقيقة الحالية.
- [ ] إضافة metadata يوضح current vs archived.

## 11) AI Orchestration
- [ ] تقييد AI context بالحقائق الموثقة فقط.
- [ ] إضافة guardrails ضد reasoning على بيانات stale.
- [ ] ربط توصيات AI بمصادر evidence محددة.

## 12) Truth Governance / ETV
- [ ] بناء خدمة تنفيذية لـ Engineering Truth Verification.
- [ ] إضافة truth verification rules/runs/findings/drift register.
- [ ] إنتاج verification snapshots قابلة للاستهلاك من UI والـ CI.

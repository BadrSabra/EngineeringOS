# Truth Flow Matrix — PR-ready Checklist

## الهدف
تحويل Truth Flow Matrix إلى checklist تنفيذية قابلة للإغلاق عبر PRs متسلسلة.

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

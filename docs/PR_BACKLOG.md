# PR Backlog — EngineeringOS Execution Alignment

> الترتيب التالي محسوب ليغلق أعلى المخاطر أولًا: الحقيقة المرجعية، ثم سلسلة التنفيذ، ثم الديمومة، ثم UX، ثم الحوكمة والاختبارات.

## PR 01 — Truth Baseline Sync

**PR:** 01
**scope:** مزامنة سجل الحقيقة مع الشجرة الفعلية الحالية، وإضافة أي ملفات جديدة/غير مسجلة، وتحديث مؤشرات الحالة في الوثائق المرجعية.
**files:** `docs/fact-record.md`, `docs/completion-plan.md`, `docs/ENGINEERINGOS_MASTER_EXECUTION_CONSTITUTION.md`, أي ملفات truth/register مرتبطة.
**risk:** مرتفع — أي انحراف هنا يضلل كل القرارات التالية.
**acceptance:**

* لا يوجد ملف فعلي جديد خارج الحقيقة المسجلة.
* كل ملف جديد له role/status/evidence/gap/priority/next action.
* لا توجد claims قديمة متعارضة مع الكود الحالي.
  **dependency:** لا شيء.

**status:** ✅ مُغلق 2026-07-15 — 19 ملفًا جديدًا أُضيف، P0 authorization مُعلَّم مُغلق، fact-record count = 423.

## PR 02 — Execution Alignment Inventory

**PR:** 02
**scope:** إنشاء جرد تنفيذي طبقي ثابت: Purpose / Implemented / Partial / Missing / Evidence / Risk / Next PR لكل طبقة رئيسية.
**files:** `docs/EXECUTION_ALIGNMENT_REPORT.md`, `docs/RUNTIME_EXECUTION_MATRIX.md`, `docs/PLACEHOLDER_REGISTER.md`.
**risk:** مرتفع — هذا هو خط الأساس الذي سيُبنى عليه كل إصلاح لاحق.
**acceptance:**

* كل طبقة موثقة بدليل واضح.
* كل feature لها حالة تشغيلية محددة.
* لا توجد طبقة "غامضة" أو غير مصنفة.
  **dependency:** PR 01.

**status:** ✅ مُغلق 2026-07-15 — EXECUTION_ALIGNMENT_REPORT, RUNTIME_EXECUTION_MATRIX, PLACEHOLDER_REGISTER أُضيفت إلى docs/.

## PR 03 — OpenAPI → Route → Handler Chain Audit

**PR:** 03
**scope:** التحقق من سلسلة الاعتماد لكل API: OpenAPI, route, handler, DB, audit, frontend, generated client, tests؛ وإخراج أي انقطاع.
**files:** `lib/api-spec/openapi.yaml`, `artifacts/api-server/src/routes/*`, `artifacts/api-server/src/lib/*`, `lib/api-client-react/src/generated/*`, `lib/api-zod/src/generated/*`, `artifacts/dashboard/src/pages/*`, `tests/*`.
**risk:** مرتفع — أي كسر في السلسلة يخلق drift تشغيلي بين العقد والتنفيذ.
**acceptance:**

* كل endpoint له مسار كامل واضح.
* كل انقطاع documented with reason.
* generated client and Zod match spec.
  **dependency:** PR 01, PR 02.

**status:** 🔲 مفتوح

## PR 04 — Placeholder / Stub / Dead-Code Cleanup

**PR:** 04
**scope:** إزالة أو توضيح كل Placeholder, Stub, Mock, Fake, Temporary, TODO, FIXME, dead code, unused exports, unused APIs/routes.
**files:** كل الملفات المُدرجة في `docs/PLACEHOLDER_REGISTER.md` مع أي ملفات مرتبطة.
**risk:** متوسط إلى مرتفع — قد يكشف أجزاء غير مكتملة أو مسارات غير مستخدمة تؤثر على الثقة.
**acceptance:**

* لا يبقى placeholder صامت في مسار production-critical.
* كل TODO/FIXME له owner/plan أو أُزيل.
* dead code إمّا حذف أو تبرير.
  **dependency:** PR 02, PR 03.

**status:** 🔲 مفتوح

## PR 05 — Scanner / Discover Project Hardening

**PR:** 05
**scope:** جعل اكتشاف المشروع مسارًا تنفيذيًا محكومًا من المصدر إلى الفهرسة إلى الملخص بدل كونه wizard فقط.
**files:** `artifacts/dashboard/src/pages/Projects.tsx`, `artifacts/dashboard/src/components/*`, `lib/scanner/src/*`, `artifacts/api-server/src/routes/*` الخاصة بالاكتشاف.
**risk:** مرتفع — هذا هو مدخل النظام، وأي ضعف فيه يضرب جودة كل التحليلات التالية.
**acceptance:**

* source selection واضح.
* scan/validate/import/summarize/approve مترابطة.
* failures تظهر كحالات مفهومة لا كصمت.
  **dependency:** PR 03, PR 04.

**status:** 🔲 مفتوح

## PR 06 — AI Chat / Orchestrator UX Fixes

**PR:** 06
**scope:** إنهاء صمت الإرسال، تحسين error classification، وتوحيد رسائل الفشل/النجاح في AI chat ومسارات orchestration.
**files:** `artifacts/dashboard/src/pages/AiChat.tsx`, `artifacts/api-server/src/routes/ai.ts`, `lib/ai-orchestrator/src/*`, `artifacts/api-server/src/lib/credentials-crypto.ts`.
**risk:** متوسط إلى مرتفع — أخطاء AI غالبًا تربك المستخدم وتخفي المشكلة الحقيقية.
**acceptance:**

* no silent send failure.
* unauthorized/forbidden/validation/provider errors مصنفة.
* كل مسار AI يعرض state مفهومًا.
  **dependency:** PR 03, PR 05.

**status:** ⚡ مُنجَز جزئيًا 2026-07-15 — AiChat.tsx: onError يستخدم classifyProjectError، handleSend يُظهر toast عند غياب المشروع. الباقي مرتبط بـ PR 03/05.

## PR 07 — Runtime Durability & Job Queue Recovery

**PR:** 07
**scope:** ترقية job processing من in-process bounded queue إلى مسار أكثر ديمومة أو على الأقل إضافة recovery/retry semantics واضحة.
**files:** `artifacts/api-server/src/lib/job-queue.ts`, `artifacts/api-server/src/lib/*`, أي routes/consumers تعتمد على queue.
**risk:** مرتفع — أي restart قد يضيع عملًا قائمًا أو يخلق state غير موثوق.
**acceptance:**

* retry/backoff واضح.
* job state measurable.
* restart behavior documented.
* no silent job loss in critical paths.
  **dependency:** PR 03, PR 02.

**status:** 🔲 مفتوح

## PR 08 — Audit / Metrics / Event Consistency

**PR:** 08
**scope:** توحيد التسجيل بين events, metrics, audit logs, task logs, correlation IDs، والتأكد أن كل حدث مهم له أثر يمكن تتبعه.
**files:** `artifacts/api-server/src/lib/*`, `artifacts/api-server/src/routes/*`, `lib/db/src/schema/*`, أي audit/event handlers.
**risk:** متوسط إلى مرتفع — بدونها تفقد المنصة صفة "قابلة للتدقيق".
**acceptance:**

* event → audit → metric chain واضح.
* correlation IDs موجودة في المسارات الحرجة.
* لا توجد عمليات مهمة بلا trace.
  **dependency:** PR 03, PR 02.

**status:** 🔲 مفتوح

## PR 09 — Tests & Gate Enforcement

**PR:** 09
**scope:** فرض بوابات التنفيذ: typecheck, tests, codegen drift, truth validation, and execution alignment checks ضمن CI أو ما يعادلها.
**files:** `package.json`, `scripts/*`, `.github/*` أو أي CI config، `tests/*`.
**risk:** متوسط — هذا هو ما يمنع رجوع الـ drift بعد إصلاحه.
**acceptance:**

* أي drift يفشل البوابة.
* أي schema/client mismatch يفشل البوابة.
* truth validation تعمل تلقائيًا.
  **dependency:** PR 01, PR 02, PR 03.

**status:** ⚡ مُنجَز جزئيًا 2026-07-15 — `truth:validate` + `codegen:check` + `typecheck` + `test` أوامر جاهزة كـ root scripts. CI config غير موجود بعد.

## PR 10 — Final UI Consistency Pass

**PR:** 10
**scope:** مراجعة نهائية للواجهة للتأكد أن كل status/state/error/message يعكس الحقيقة التشغيلية الجديدة دون wording قديم أو misleading labels.
**files:** `artifacts/dashboard/src/pages/*`, `artifacts/dashboard/src/components/*`.
**risk:** متوسط — أقل خطورة من core execution لكنه مهم لثقة المستخدم.
**acceptance:**

* UI reflects actual state.
* no stale labels like "placeholder" for finished flows.
* error messages are actionable.
  **dependency:** PR 05, PR 06, PR 08.

**status:** 🔲 مفتوح

## PR 11 — Documentation Finalization

**PR:** 11
**scope:** إعادة كتابة الوثائق العليا لتطابق المنصة بعد الإغلاق: architecture, execution alignment, truth register, onboarding, runtime behavior.
**files:** `docs/*` الأساسية.
**risk:** متوسط — يضمن أن الفريق لا يعود إلى وصف قديم.
**acceptance:**

* docs match code.
* no stale claims.
* one source of truth واضح للمراجعة المستقبلية.
  **dependency:** PR 01 إلى PR 10.

**status:** 🔲 مفتوح

## PR 12 — Release Hardening / Merge Readiness

**PR:** 12
**scope:** تجميع ما سبق في readiness checklist نهائي: release notes, smoke checks, rollback assumptions, merge policy.
**files:** `docs/*`, CI/config files, any release checklist artifacts.
**risk:** منخفض إلى متوسط — آخر طبقة قبل الاعتماد الواسع.
**acceptance:**

* release gate واضح.
* rollback path documented.
* no open critical gaps.
  **dependency:** PR 09, PR 11.

**status:** 🔲 مفتوح

---

## التسلسل المقترح للتنفيذ

1. PR 01 ✅
2. PR 02 ✅
3. PR 03
4. PR 04
5. PR 05
6. PR 06
7. PR 07
8. PR 08
9. PR 09
10. PR 10
11. PR 11
12. PR 12

## ملاحظة تشغيلية

إذا ظهر أثناء PR 03 أو PR 05 انقطاع في مسار API أو discovery، فالأولوية تُعاد فورًا إلى إصلاح ذلك الانقطاع قبل أي تحسين UX أو توثيق إضافي.

# EngineeringOS — الدفعة الثالثة (وثائق/إعدادات/سكربتات/ذاكرة القرار)


## 1) الملخص التنفيذي


[حقيقة] تمت مراجعة 77 ملفًا في هذه الدفعة: 41 ملف ذاكرة/قرارات، 15 ملف توثيق، 12 ملف إعدادات، 8 سكربتات، و1 ملف CI.


[استنتاج مدعوم] هذه الدفعة لا تضيف كودًا وظيفيًا جديدًا بقدر ما تكشف طبقة الحوكمة حول المشروع: هناك مرجع معماري حالي، وسجلات تاريخية معلنة، وبوابات drift في السكربتات وCI، وذاكرة قرار غير مهيكلة نسبيًا.

[حقيقة] `docs/architecture.md` يعرّف نفسه كـ current truth baseline ويذكر أنه آخر ما تم التحقق منه في 2026-07-20، بينما `docs/fact-record.md` و`docs/completion-plan.md` يصرّحان بأنهما سجلات تاريخية لا يجب قراءتها كمرجع حالي.

[استنتاج مدعوم] أقوى نقطة في هذا الجزء من المشروع هي وجود بوابات تحقق فعلية (`check-codegen-drift.ts` و`validate-truth-flow.ts` وCI)، وأكبر فجوة هي تعدد الوثائق التي قد تُقرأ خطأً كحالة حالية إن لم تُوسم بوضوح.


## 2) فهرس الملفات التي تمت قراءتها


[حقيقة] تم تحليل 77 ملفًا في هذا الجزء، وأهم التجمعات كانت: ذاكرة/قرارات 41، توثيق 15، إعدادات 12، سكربتات 8، وCI 1.

الفهرس الكامل موجود في ملف CSV المرفق، ويحتوي على المسار الكامل، النوع، الفئة، الغرض المتوقع، وحالة القراءة لكل ملف.


## 3) تحليل المشروع


[حقيقة] من هذه الدفعة وحدها يظهر أن EngineeringOS لا يعتمد فقط على runtime code، بل على نظام حوكمة مكتوب: مرجع معماري، سجل حقائق تاريخي، backlog، matrix، checklists، وذكريات قرارات تشغيلية.

[استنتاج] المشروع يحاول بناء "system of proof" حول نفسه: كل claim مهم يُفترض أن يكون قابلاً للرجوع إلى ملف، سكربت، أو baseline.

[غير مؤكد] هذه الدفعة لم تُعد فحص الطبقات التنفيذية نفسها؛ لذلك أي حكم على صحة runtime الفعلية هنا محدود بما تقوله المستندات والسكربتات فقط.


## 4) تحليل المعمارية


```text
docs/architecture.md (current baseline)
        ↓
historical logs (fact-record / completion-plan / alignment snapshots)
        ↓
truth gates (check-codegen-drift / validate-truth-flow)
        ↓
CI workflow (.github/workflows/ci.yml)
        ↓
workspace bootstrap (.replit / replit.md / post-merge / verify-setup)
        ↓
runtime dependencies (pnpm-lock / pnpm-workspace / package.json)
```


[استنتاج] هنا المعمارية ليست API/database فقط؛ هناك معمارية حوكمة تعمل فوق المشروع كله وتحدد ما يعتبر حقيقة حالية وما يعتبر تاريخًا أو مشتقًا.


## 5) تحليل الطبقات


- **طبقة الحقيقة الحالية** — architecture.md + master constitution: تعريف baseline الحالي والطبقات الدلالية للحقيقة.

- **طبقة الأرشيف التاريخي** — fact-record.md + completion-plan.md + EXECUTION_ALIGNMENT_REPORT.md + RUNTIME_EXECUTION_MATRIX.md: Snapshots وسجلات مراحل قديمة.

- **طبقة الحوكمة/التحقق** — truth-flow checklist/review plan + scripts/check-codegen-drift.ts + scripts/validate-truth-flow.ts + CI: منع drift وإجبار الاتساق.

- **طبقة ذاكرة القرار** — .agents/memory/*: ملاحظات تنفيذية وقرارات ومخاطر وخيارات تم تثبيتها نصيًا.

- **طبقة bootstrap / ops** — .replit + replit.md + post-merge.sh + verify-setup.sh: تشغيل المشروع والتحقق من جاهزية البيئة.

- **طبقة الاعتماديات** — package.json + pnpm-workspace.yaml + pnpm-lock.yaml + tsconfig files: إطار workspace والاعتماديات وإعدادات الترجمة.


## 6) تحليل المكوّنات


| المكوّن | الطبقة | الحالة | نسبة الإنجاز | الأولوية | المخاطر | الاعتماديات | الملفات المرجعية |
|---|---|---|---|---|---|---|---|
| docs/architecture.md | توثيق الحقيقة الحالية | مكتمل كمرجع | 90% | P0 | أي تضارب معه يخلط الحقيقة الحالية بالتاريخية | fact-record.md / completion-plan.md / scripts truth gates | EngineeringOS-main/docs/architecture.md |
| docs/fact-record.md + completion-plan.md | سجل تاريخي | مكتمل كأرشيف | 95% | P1 | قد يُقرأ كمرجع حالي رغم وسمه التاريخي | architecture.md | EngineeringOS-main/docs/fact-record.md; EngineeringOS-main/docs/completion-plan.md |
| scripts/check-codegen-drift.ts | بوابة بناء/عقد | مكتمل | 90% | P0 | لو تعطّل، يتسرّب drift إلى generated surfaces | pnpm workspace + git | EngineeringOS-main/scripts/check-codegen-drift.ts |
| scripts/validate-truth-flow.ts | بوابة baseline drift | مكتمل | 90% | P0 | أي تغيير في baseline/schema دون تحديث متزامن سيُرفض | lib/api-zod truth-flow schema + attached_assets baseline JSON | EngineeringOS-main/scripts/validate-truth-flow.ts |
| scripts/trigger-scan.mts | أداة تشغيل يدوية للمسح | مكتمل جزئيًا | 70% | P2 | يتجاوز طبقة HTTP/المصادقة/التفويض ويكتب مباشرة إلى DB | db + scanner libraries | EngineeringOS-main/scripts/trigger-scan.mts |
| scripts/verify-setup.sh | تحقق بيئة | مكتمل | 85% | P1 | قد يعطي إحساسًا زائفًا بالاكتفاء إذا كانت خدمات الخلفية سليمة شكليًا فقط | curl, psql, env vars | EngineeringOS-main/scripts/verify-setup.sh |
| docs/PLACEHOLDER_REGISTER.md | جودة/تنظيف توثيق | مكتمل جزئيًا | 75% | P2 | False positives قد تؤخر التنظيف إذا لم تُراجع يدويًا | scan heuristics / manual review | EngineeringOS-main/docs/PLACEHOLDER_REGISTER.md |
| .replit + replit.md | تشغيل/نشر | مكتمل | 85% | P1 | اختلاف إعدادات التشغيل عن الواقع الفعلي للبيئة | workspace secrets + ports | EngineeringOS-main/.replit; EngineeringOS-main/replit.md |
| tsconfig.base.json.bak | أثر جانبي/نسخة احتياطية | غير معروف كعنصر فعّال | غير مناسب | P3 | يشوش على فهم الإعداد النشط | none | EngineeringOS-main/tsconfig.base.json.bak |


## 7) تحليل الكود


[حقيقة] `scripts/check-codegen-drift.ts` يعيد توليد مخرجات OpenAPI ثم يستخدم `git diff` و`git ls-files` لاكتشاف أي drift في `lib/api-zod/src/generated` و`lib/api-client-react/src/generated`.

[حقيقة] `scripts/validate-truth-flow.ts` يطبّق بوابتين: بوابة بنيوية تتحقق من شكل JSON، ثم بوابة baseline drift تقارن JSON الحالي بـ `EXPECTED_CURRENT_TRUTH_FLOW_MATRIX` عبر `safeValidateCurrentTruthFlowMatrix` و`listTruthFlowDriftSignals`.

[حقيقة] `scripts/trigger-scan.mts` يختار أحدث project، يتأكد من وجود `rootPath`، ينشئ scan job، يشغّل `walkProject` و`matchRules` و`computeMetrics` و`extractGraph`، ثم يحذف graph القديم ويعيد إدراج entities/relationships ويكتب event نجاح.

[استنتاج] هذا السكربت الأخير مفيد كأداة صيانة، لكنه يختلف جوهريًا عن المسار الرسمي لأنه يكتب مباشرةً إلى DB؛ لذا يجب التعامل معه كأداة dev-only أو تشغيل داخلي مراقب.

[حقيقة] `verify-setup.sh` يفحص: وجود `node_modules`، secrets الخاصة بـ Clerk، `DATABASE_URL`، صحة `/api/healthz`، صحة `/dashboard/`، ووجود جدول `projects` في القاعدة.

[حقيقة] `ci.yml` يحتوي job سريعًا لالتقاط codegen drift عند تغيّر spec/generated surfaces، ثم job كاملًا يشغّل codegen check وtypecheck والاختبارات.

[حقيقة] `pnpm-workspace.yaml` يفرض minimumReleaseAge=1440 دقيقة ويستثني حزمًا موثوقة، ما يعني أن هناك حاجز supply-chain مقصودًا على مستوى workspace.

[حقيقة] `pnpm-lock.yaml` هو لقطة اعتماديات كبيرة: version 9.0، 12 importers، و661 packages/snapshots.


## 8) تحليل الوثائق


| الملف | ماذا يشرح | هل يعكس الواقع الحالي | ملاحظة |
|---|---|---|---|
| architecture.md | current baseline | نعم | لا توجد إشارة قوية هنا لتعارض داخلي |
| fact-record.md | historical log | نعم | موسوم بوضوح كتاريخي |
| completion-plan.md | historical phased plan | نعم | موسوم بوضوح كتاريخي |
| EXECUTION_ALIGNMENT_REPORT.md | snapshot report | لا | أرقام أقدم من أرشيف الدفعة الحالية |
| RUNTIME_EXECUTION_MATRIX.md | snapshot matrix | لا | snapshot بتاريخ 2026-07-15 |
| PR_BACKLOG.md | active/working backlog | جزئيًا | يجمع مغلقًا ومفتوحًا ويحتاج قراءة مع التاريخ |
| truth-flow-pr-checklist.md | execution checklist | نعم | تعريفات baseline/derived/historical/runtime واضحة |
| truth-flow-pr-review-plan.md | review plan | نعم | يعطي snapshot counts ويحتاج تحديثًا دوريًا |
| PLACEHOLDER_REGISTER.md | scan register | نعم | يتضمن false positives مُعترفًا بها |
| ENGINEERINGOS_MASTER_EXECUTION_CONSTITUTION.md | governance manifesto | نعم | أقوى وثيقة حوكمة في هذه الدفعة |


## 9) تحليل الجودة


| المعيار | التقييم | السبب |
|---|---|---|
| جودة المعمارية | مرتفعة | وجود طبقات truth/validation/CI واضحة ومترابطة. |
| جودة التنظيم | مرتفعة-متوسطة | التقسيم جيد، لكن كثرة المستندات التاريخية تحتاج حوكمة أسماء/حالة. |
| جودة التوثيق | مرتفعة | تفصيل غني جدًا، لكنه متداخل بين current وhistorical snapshots. |
| جودة السكربتات | مرتفعة | السكربتات واضحة الغرض وتفشل بصوت عالٍ. |
| سهولة الصيانة | متوسطة-مرتفعة | الأساس قوي، لكن التوثيق المكرر يضيف حملًا معرفيًا. |
| الأمان | متوسطة | يوجد supply-chain hardening وCI، لكن trigger-scan اليدوي ومسارات التمهيد تحتاج ضبطًا أوضح. |
| الاختبارات | متوسطة-مرتفعة | يوجد CI check وعدة بوابات تحقق، لكن هذه الدفعة لم تفحص تغطية الاختبارات الفعلية. |
| جاهزية الإنتاج | متوسطة-مرتفعة | التشغيل مضبوط إلى حد كبير، لكن صحة truth metadata والتنظيف النهائي ما زالا مهمين. |


## 10) تحليل الفجوات


| العنصر | الموجود فعليًا | المتوقع أو المستهدف | الفجوة | مستوى الخطورة | الأولوية | الدليل |
|---|---|---|---|---|---|---|
| مصدر حقيقة واحد لحالة المستندات | architecture.md current، بينما fact-record/completion-plan/EXECUTION_ALIGNMENT_REPORT وغيرها تاريخية أو snapshot | سجل metadata رسمي يعرّف current vs historical vs derived | التصنيف موجود نصيًا لكن ليس مفروضًا آليًا | عالي | P0 | architecture.md + fact-record.md + completion-plan.md + PR_BACKLOG.md + truth-flow docs |
| استمرارية drift gates | check-codegen-drift.ts و validate-truth-flow.ts و CI workflow | تغطية كاملة لكل surfaces المولدة والبلاينات المرجعية | الحماية موجودة لكن تعتمد على التزام التشغيل والـ CI فقط | متوسط | P1 | scripts/check-codegen-drift.ts; scripts/validate-truth-flow.ts; .github/workflows/ci.yml |
| توثيق snapshots القديمة | EXECUTION_ALIGNMENT_REPORT و RUNTIME_EXECUTION_MATRIX بأرقام وتواريخ أقدم | تمييز آلي أو واضح جدًا بأنها snapshots تاريخية | قد تُقرأ كحالة حالية رغم كونها لقطات زمنية | متوسط | P1 | EXECUTION_ALIGNMENT_REPORT.md; RUNTIME_EXECUTION_MATRIX.md |
| استخدام trigger-scan اليدوي | سكريبت تشغيل مباشر يكتب إلى DB ويولد graph/metrics | حصره كأداة dev-only مع تحذير صريح وربط أوضح بالحزمة الرسمية | يتجاوز مسار HTTP/auth/audit | عالي | P1 | scripts/trigger-scan.mts |
| تنظيم memory notes | 41 ملف Markdown بقرارات/ملاحظات/فواصل زمنية | registry مهيكل مع حالة superseded/current وتاريخ تحديث | المعرفة مهمة لكنها غير مفروضة بالهيكل | متوسط | P2 | .agents/memory/* |
| تضخم lockfile | pnpm-lock.yaml v9 مع 12 importer و 661 packages/snapshots | إبقاء أثره ضمن إدارة الاعتماديات فقط | ليس مصدر حقيقة وظيفي لكنه كبير وحرِج للصيانة | منخفض | P2 | pnpm-lock.yaml |
| النسخة الاحتياطية tsconfig.base.json.bak | ملف backup في الجذر | إزالته أو توثيقه كأثر تاريخي | قد يربك من يفتش عن الإعداد الفعلي | منخفض | P3 | tsconfig.base.json.bak + tsconfig.base.json |


## 11) إطار متابعة المشروع


1. عند تغيير claim مهم، حدّث الملف المرجعي المناسب أولًا: architecture للـ baseline الحالي، أو fact-record/completion-plan إذا كان التغيير تاريخيًا.
2. إذا أثّر التغيير على generated outputs، شغّل `check-codegen-drift.ts` ثم `validate-truth-flow.ts`.
3. إذا كان التغيير تشغيليًا، حدّث `verify-setup.sh` أو `replit.md` أو `post-merge.sh` بحسب موضعه.
4. إذا كانت المعرفة قرارًا أو استثناءً تشغيليًا، سجله في `.agents/memory/*` لكن مع وسم واضح للحالة (current/historical/superseded).
5. إذا تغيرت الحقيقة الحالية، حدّث `docs/architecture.md` ثم اربط ذلك بـ CI أو checklist مناسب.


## 12) خطة الاستكمال


### قصير المدى
- توحيد وسم current/historical/derived في التوثيق الأكثر استخدامًا.
- وضع `tsconfig.base.json.bak` تحت الأرشيف أو حذفه إذا لم يعد مطلوبًا.
- إضافة تنبيه صريح بأن `scripts/trigger-scan.mts` أداة صيانة/dev-only.
- تحديث `EXECUTION_ALIGNMENT_REPORT` و`RUNTIME_EXECUTION_MATRIX` أو الإشارة إليهما كسnapshots فقط.

### متوسط المدى
- تحويل `.agents/memory/*` إلى سجل قرارات مهيكل أو registry قابل للبحث.
- إضافة ملف فهرسة واحد يربط بين المستندات الحالية والتاريخية والمشتقة.
- ربط الملاحظات التاريخية بآلية تحديث/إبطال تلقائية عندما يتغير truth baseline.

### طويل المدى
- تجميع docs/ memory / validation في طبقة truth registry واحدة مولّدة من metadata.
- أتمتة إنتاج التقارير من schema وmanifest بدل تحديثات يدوية متفرقة.
- تقليل التداخل بين snapshots التاريخية والمرجع الحالي إلى حد أدنى واضح.


## 13) سجل المخاطر


| الخطر | الأثر | التخفيف |
|---|---|---|
| قراءة snapshot قديم كأنه current | قرارات مبنية على حالة غير حديثة | وضع label واضح current/historical في كل doc وCI |
| drift في generated artifacts | API/client mismatch | الحفاظ على check-codegen-drift وvalidate-truth-flow |
| الاعتماد على trigger-scan اليدوي | تجاوز ضوابط التشغيل | وضعه كأداة صيانة فقط وتحذير صريح |
| memory notes غير المهيكلة | صعوبة التتبع والـ supersession | تحويلها إلى سجل قرارات منظم |
| أثر احتياطي tsconfig في الجذر | تشويش أثناء المراجعة | حذفه أو وسمه أرشيفيًا |


## 14) قائمة الافتراضات غير المؤكدة


- لم أعد فحص ملفات attached_assets الكبيرة أو الصور/الوثائق الثنائية في هذه الدفعة.

- لم أعد تحليل كل ملفات الكود التنفيذية هنا؛ لذلك أي حكم على runtime نفسه يظل معتمدًا على المستندات والسكربتات فقط.

- نقاط التوافق بين الوثائق والواقع التشغيلي تحتاج batch لاحقًا على ملفات التنفيذ نفسها للتأكيد.


## 15) ملحق الملفات التي تم تحليلها


الفهرس الكامل موجود في ملف CSV المرفق. يشمل هذه التجمعات: root configs، `.github/workflows/ci.yml`، جميع ملفات `scripts/`، جميع ملفات `docs/`، وجميع ملفات `.agents/memory/`.

هذه الدفعة تؤكد أن طبقة الحوكمة قوية، لكن يجب عدم الخلط بين snapshots التاريخية والمرجع الحالي.
# EngineeringOS — سلسلة 29: سجل حدود الثقة والحوكمة

## الخلاصة التنفيذية

المشروع **مُصادَق عليه** على مستوى الخادم، لكنه **غير مُخوَّل** بعد على مستوى المِلْكية أو الأدوار أو حدود المشروع.  
هذا ليس خللًا خفيًا؛ بل هو **سياسة مرحلية موثّقة داخل الكود والوثائق**: أي مستخدم مسجّل عبر Clerk يصل إلى جميع مسارات `/api/*` ما عدا `/api/healthz`، ولا توجد حتى الآن طبقة RBAC أو ACL أو membership داخل النموذج البياني للبيانات.

بعبارة أدق:  
- **حدّ الثقة الحالي = "مستخدم مُسجّل"**  
- **ليس** "مالك مشروع"  
- **وليس** "عضو فريق"  
- **وليس** "صاحب دور إداري"

هذا يجعل EngineeringOS اليوم منصة تشغيل قوية من الداخل، لكن داخل **نطاق ثقة واحد**. وهي مناسبة جدًا لمرحلة البناء الفردي/الفريق الصغير، لكنها تحتاج إغلاقًا حاسمًا قبل أن تصبح متعددة المستخدمين أو متعددة الفرق.

---

## ما ثبت من داخل الملفات

### 1) الخادم يفرض Authentication على مستوى `/api` كله
في `artifacts/api-server/src/app.ts` تم تركيب Clerk middleware ثم جعل:
- `/api/healthz` مفتوحًا للمراقبة
- وكل ما تحت `/api` يمر عبر `requireAuth`
- مع تعليق صريح يوضح أنه **لا يوجد فرق أدوار بعد** وأن جميع المستخدمين الموثقين يملكون الوصول الكامل

**الدلالة:** المنصة ليست مكشوفة خارجيًا، لكنها أيضًا ليست مقسمة داخليًا بحسب المالك أو الفريق.

### 2) `requireAuth` هو حارس جلسة فقط
في `artifacts/api-server/src/middlewares/requireAuth.ts`:
- يتحقق من وجود `userId`
- لا يفحص role
- لا يفحص project membership
- لا يفحص ownership
- لا يربط userId بأي ACL

وفي تعليق الملف نفسه، يذكر النص بوضوح:
- لا توجد طبقة per-role
- لا توجد طبقة per-project
- جميع المستخدمين الموثقين لديهم صلاحية كاملة على المشاريع والمهام والـ workflows والـ plugins والـ metrics

**الدلالة:** هذا ليس تفويضًا granular authorization؛ إنه gate للدخول فقط.

### 3) نموذج البيانات لا يحتوي أصلًا على ملكية/عضوية
في `lib/db/src/schema/projects.ts` جدول `projects` يحتوي على:
- `id`
- `name`
- `description`
- `rootPath`
- `language`
- `framework`
- `status`
- `qualityScore`
- `lastScanAt`
- timestamps

ولا يحتوي على:
- `ownerId`
- `createdBy`
- `teamId`
- `tenantId`
- `visibility`
- `acl`

وبفحص مخطط الجداول الظاهرة، لا توجد جداول membership/roles/acl في طبقة الـ DB الحالية.

**الدلالة:** حتى لو أردنا إضافة authorization لاحقًا، فالبنية الحالية تحتاج توسعة مخططة، لا مجرد سطر middleware.

### 4) مسارات القراءة/التعديل تعمل على IDs ومعايير استعلام، لا على ACL
في `artifacts/api-server/src/routes/projects.ts`, `tasks.ts`, `workflows.ts`, `metrics.ts`, `events.ts`, `plugins.ts`:
- الاستعلامات تعتمد على `projectId` أو `entityId`
- التصفية ناتجة عن نوع الكيان أو المشروع
- لا يوجد ربط بين `req.userId` وبين البيانات المطلوبة
- لا يوجد check مثل “هل هذا المستخدم يملك المشروع؟”
- لا يوجد check مثل “هل هذا المستخدم ضمن الفريق؟”

**الدلالة:** العزل هنا **بياني/وظيفي** وليس **هوية/صلاحية**.

### 5) الوثائق تصف هذه السياسة كحقيقة معتمدة
في `docs/fact-record.md` وداخل تعليقات `app.ts` و`requireAuth.ts` يظهر نفس الخط:
- authenticated users have full access
- no per-role distinction yet
- extend later with per-project access, roles

**الدلالة:** هذا قرار مرحلي موثّق، لا غفلة غير معروفة.

### 6) الاختبارات تدعم bypass مقصودًا للتوثيق
في `.agents/memory/clerk-auth-testing.md` تم توثيق أن:
- vitest يضع `NODE_ENV=test`
- و`requireAuth` يتجاوز Clerk في الاختبارات ويضع `test-user`
- الهدف هو اختبار المنطق الداخلي، لا plumbing الخاص بـ Clerk

**الدلالة:** هذا يؤكد أن طبقة المصادقة الحالية **session-based**، لكنها لا تحمل معها بعد نموذج الصلاحيات داخل البيانات.

---

## ما هو مكتمل الآن

| الطبقة | الحالة | الدليل | الأثر |
|---|---|---|---|
| Authentication | مكتمل | Clerk middleware + `requireAuth` | يمنع الوصول غير الموثق |
| Perimeter hardening | مكتمل | `helmet` + `rateLimit` + `trust proxy` + `no-store` + disable `etag` | يحسن أمن الحافة وسلوك التصفح |
| Health probe exception | مكتمل | `GET /api/healthz` غير محمي | يسمح بمراقبة المنصة |
| Policy documentation | مكتمل | `docs/fact-record.md` و تعليقات الكود | يحدد الحقيقة الحالية بلا لبس |

---

## ما هو جزئي

| الطبقة | الحالة | الدليل | الأثر |
|---|---|---|---|
| Authorization | جزئي جدًا | لا توجد roles أو memberships أو ACL | كل مستخدم موثق يملك نفس مستوى الوصول |
| Project isolation | جزئي | لا يوجد owner/team/tenant في schema | العزل يعتمد على “نفس الجلسة” لا “نفس المشروع” |
| Multi-user governance | جزئي | لا يوجد check بين `userId` و`projectId` | غير مناسب بعد لفرق متعددة بصلاحيات مختلفة |

---

## ما هو مفقود

| الطبقة | الحالة | الدليل | الأثر |
|---|---|---|---|
| RBAC | مفقود | لا حقول ولا middleware ولا policy engine | لا يمكن تمييز admin/editor/viewer |
| Project membership | مفقود | لا ownerId ولا teamId ولا join table | لا يمكن منع مستخدم من مشروع بعينه |
| ACL / tenant boundary | مفقود | لا tenantId ولا visibility layer | لا يوجد حد فصل متعدد المستأجرين |
| Central permission service | مفقود | لا توجد طبقة authorize موحدة | تتكرر Checks مستقبلًا إذا أضيفت يدويًا |
| Ownership auditing | مفقود | audit موجود، لكن ليس ownership-aware | يصعب إثبات من يملك الحق على ماذا |

---

## الأثر المعماري

المنصة اليوم تُدار داخل **trust domain واحد**:
- ممتاز للـ single operator
- جيد لبناء product core
- مناسب للتجارب والـ proof-of-concept
- غير كافٍ بعد لبيئة متعددة المستخدمين أو متعددة الفرق

المهم هنا أن هذا ليس عيبًا مخفيًا في التنفيذ؛ بل **حدّ معماري معروف**.  
وهذا يغيّر ترتيب الاستكمال: قبل أي توسع في التعاون أو المشاركة، يجب أولًا بناء **authorization model** حقيقي.

---

## الخطوة التالية العملية

### P0
1. إضافة `ownerId` أو `createdBy` إلى `projects`
2. إضافة `project_members` أو `project_acl`
3. إنشاء middleware موحد مثل `authorizeProjectAccess(projectId, action)`
4. ربط `req.userId` بقرارات الوصول بدل الاكتفاء بإثبات الجلسة

### P1
1. تمييز الأدوار: `owner`, `editor`, `viewer`, `admin`
2. تطبيق policy checks على المشاريع والمهام والـ workflows والـ plugins
3. إضافة اختبارات تمنع cross-project access

### P2
1. إضافة tenant boundary إذا كانت المنصة ستخدم أكثر من فريق/جهة
2. دعم visibility modes مثل private/shared/org
3. توحيد auditing بحيث يسجل “من حاول الوصول ولماذا مُنع”

---

## قراءة نهائية

EngineeringOS ليس ناقصًا في الحماية العامة؛ هو **ناقص في الحوكمة الدقيقة**.  
المدخلات محمية، لكن الحقوق غير مُقسّمة.  
المنصة آمنة نسبيًا كحاوية تشغيل واحدة، لكنها لم تُصبح بعد نظامًا متعدد المستخدمين بحقوق متباينة.

هذه السلسلة تثبت أن:
- **الأمن المحيطي موجود**
- **الهوية موجودة**
- **التخويل الدقيق مفقود**
- **ونقطة الإغلاق واضحة جدًا**


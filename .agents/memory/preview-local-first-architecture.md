---
name: Preview محلي أولًا
description: تسلسل UXW-03 المعتمد وحدود فصل مزودي التخزين والتشغيل والنقل عن إثبات Candidate.
---

نفّذ Preview بترتيب محلي ومحايد للمزود: العقود، ثم Local Artifact Store، ثم Builder مع Attestor مستقل، ثم Runtime وGateway محليان، ثم Local Agent للتطبيق المستضاف، وأخيرًا adapters اختيارية مثل AWS وCloudflare.

**Why:** طلب المستخدم هذا الترتيب لتقليل مخاطر التراجع الأمني وتكرار الأنظمة. قواعد إثبات Candidate الحالية لا تتغير: Artifact Store يحفظ بايتات فقط، Builder ينفذ فقط، Attestor يثبت الناتج، والخادم القائم وحده يقرر القبول.

**How to apply:** لا تجعل S3/ECS أو مزود cloud شرطًا لمسار UXW-03 الأساسي. أعد استخدام تنفيذ AWS القائم كـadapter بعد تثبيت العقود؛ لا تنشئ مصادر Candidate أو إثبات أو جلسات موازية. لا تنشر موارد cloud دون خطة تكلفة/موارد وموافقة منفصلة.

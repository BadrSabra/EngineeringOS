# EngineeringOS

منصة هندسية مستقلة تعتمد على الذكاء الاصطناعي لمتابعة مشاريع البرمجيات وإدارة المهام والقواعد والسير العمل وتحليل الجودة.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — تشغيل خادم API (port 8080)
- `pnpm --filter @workspace/dashboard run dev` — تشغيل لوحة التحكم (port 23183)
- `pnpm run typecheck` — فحص TypeScript الكامل لجميع الحزم
- `pnpm run build` — typecheck + build لجميع الحزم
- `pnpm --filter @workspace/api-spec run codegen` — إعادة توليد hooks و Zod schemas من OpenAPI spec
- `pnpm --filter @workspace/db run push` — دفع تغييرات مخطط قاعدة البيانات (dev فقط)
- Required env: `DATABASE_URL` — Postgres connection string

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- Frontend: React 19 + Vite 7 + TailwindCSS 4 + wouter
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)
- Scanner: lib/scanner (file walk, rule matching, graph extraction, metrics)

## Where things live

- `lib/api-spec/openapi.yaml` — مصدر الحقيقة الوحيد لعقد API
- `lib/db/src/schema/` — مخطط Drizzle لقاعدة البيانات
- `lib/scanner/src/` — مكتبة فحص المشاريع (walker، rule-matcher، graph-extractor، metrics-calc)
- `lib/api-client-react/src/generated/` — React Query hooks (مولّدة تلقائياً)
- `lib/api-zod/src/generated/` — Zod schemas للخادم (مولّدة تلقائياً)
- `artifacts/api-server/src/routes/` — مسارات Express API
- `artifacts/dashboard/src/pages/` — صفحات لوحة التحكم
- `artifacts/dashboard/src/components/layout/` — Shell و Sidebar

## Architecture decisions

- عقد OpenAPI-first: جميع الأنواع والـ hooks مولّدة من `openapi.yaml`
- Dark mode افتراضي في لوحة التحكم (engineering command center aesthetic)
- Scanner library منفصلة عن API server للاستخدام المستقل
- Audit logs و events لتتبع جميع العمليات

## Product

- **Dashboard**: نظرة عامة على المشاريع، المهام النشطة، الأحداث الأخيرة، نقاط الجودة
- **Projects**: إنشاء وإدارة المشاريع ومتابعة جودتها
- **Tasks**: إدارة المهام مع أولويات وحالات وتنفيذ عبر AI pipeline
- **Rules**: قواعد جودة الكود مع تقييم تلقائي
- **Workflows**: تعريف وتنفيذ سير العمل متعدد المراحل
- **Events**: سجل أحداث النظام
- **Metrics**: مقاييس جودة الكود عبر الزمن (architecture، security، performance، reliability)
- **Graph**: شبكة معرفة الكيانات والعلاقات (Knowledge Graph)

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

- بعد أي تغيير في `openapi.yaml` يجب تشغيل codegen قبل أي شيء آخر
- `pnpm run typecheck:libs` يجب أن يُشغّل بعد تغيير أي حزمة في `lib/*`
- لا تُشغّل `pnpm run dev` من جذر المستودع — استخدم workflows

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details

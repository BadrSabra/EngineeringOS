import { Network, Target, Activity, ShieldCheck } from 'lucide-react';
import { Link } from 'wouter';

const WORKFLOW_STEPS = [
  {
    number: '١',
    icon: Target,
    title: 'اكتب هدفك',
    description: 'صف النتيجة التي تريدها بلغتك، دون اختيار أدوات برمجية.',
  },
  {
    number: '٢',
    icon: Activity,
    title: 'تابع الخطوات',
    description: 'اعرف ما يجري في مشروعك وما يحتاج قرارًا أو مراجعة منك.',
  },
  {
    number: '٣',
    icon: ShieldCheck,
    title: 'راجع ما اكتمل',
    description: 'اطّلع على النتائج وبيانات التحقق المتاحة قبل اعتماد العمل.',
  },
];

export default function Landing() {
  return (
    <div dir="rtl" lang="ar" className="min-h-[100dvh] bg-background text-foreground flex flex-col">
      <header className="h-14 flex items-center px-6 border-b border-border">
        <div className="flex items-center gap-2 text-primary font-bold text-lg tracking-tight">
          <div className="w-6 h-6 bg-primary rounded flex items-center justify-center text-primary-foreground">
            <Network className="w-4 h-4" />
          </div>
          <span dir="ltr">EngineeringOS</span>
        </div>
      </header>

      <main className="flex-1 flex items-center justify-center px-6">
        <div className="max-w-4xl w-full text-center space-y-8 py-14">
          <div className="space-y-3">
            <div className="text-xs font-mono text-muted-foreground tracking-wider">
              مساحة عمل لمشاريعك البرمجية
            </div>
            <h1 className="text-4xl font-bold tracking-tight">
              ابدأ بهدفك، ونساعدك على متابعة الطريق إليه
            </h1>
            <p className="text-muted-foreground text-base max-w-lg mx-auto">
              اكتب ما تريد تحقيقه في مشروعك، ثم تابع الخطوات والنتائج والملاحظات
              في مكان واحد، وراجع القرارات التي تحتاج موافقتك.
            </p>
          </div>

          <div className="flex items-center justify-center gap-3">
            <Link
              href="/sign-in"
              className="inline-flex items-center justify-center rounded-md bg-primary text-primary-foreground border border-primary-border px-6 py-2.5 text-sm font-medium hover-elevate active-elevate-2"
            >
              تسجيل الدخول
            </Link>
            <Link
              href="/sign-up"
              className="inline-flex items-center justify-center rounded-md border bg-secondary text-secondary-foreground border-secondary-border px-6 py-2.5 text-sm font-medium hover-elevate active-elevate-2"
            >
              إنشاء حساب
            </Link>
          </div>

          <section aria-labelledby="landing-workflow-title" className="space-y-4 pt-4 text-right">
            <div className="space-y-1">
              <h2 id="landing-workflow-title" className="text-lg font-semibold">
                رحلتك تبدأ بهدفك
              </h2>
              <p className="text-sm text-muted-foreground">
                من وصف ما تريده إلى متابعة ما اكتمل، في مساحة واحدة.
              </p>
            </div>
            <ol
              aria-label="خطوات العمل في EngineeringOS"
              className="grid grid-cols-1 gap-3 text-start sm:grid-cols-3"
            >
              {WORKFLOW_STEPS.map((step) => (
                <li
                  key={step.number}
                  className="rounded-md border border-border bg-card p-4"
                >
                  <div className="flex items-center gap-2 text-primary">
                    <span aria-hidden="true" className="text-xs font-mono">{step.number}</span>
                    <step.icon className="h-4 w-4" aria-hidden="true" />
                  </div>
                  <h3 className="mt-3 text-sm font-semibold">{step.title}</h3>
                  <p className="mt-1 text-sm leading-6 text-muted-foreground">
                    {step.description}
                  </p>
                </li>
              ))}
            </ol>
          </section>
        </div>
      </main>
    </div>
  );
}

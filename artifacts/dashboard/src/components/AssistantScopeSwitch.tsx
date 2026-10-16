import { FolderKanban, MessageSquareText } from 'lucide-react';
import { Link } from 'wouter';

type AssistantScope = 'general' | 'project';

export function AssistantScopeSwitch({
  currentScope,
  hasUnsentMessage = false,
  compact = false,
}: {
  currentScope: AssistantScope;
  hasUnsentMessage?: boolean;
  compact?: boolean;
}) {
  const target = currentScope === 'general' ? '/' : '/general-chat';
  const label = currentScope === 'general' ? 'اختر مشروعًا' : 'اسأل سؤالًا عامًا';
  const confirmation = 'تبديل مساحة المساعد سيغادر النص غير المرسل هذه الصفحة. هل تريد المتابعة؟';

  return (
    <nav aria-label="الانتقال بين السؤال العام والعمل داخل مشروع">
      <Link
        href={target}
        data-testid={currentScope === 'general' ? 'link-switch-to-project' : 'link-switch-to-general'}
        title={currentScope === 'general'
          ? 'العودة لاختيار مشروع قبل بدء العمل داخله'
          : 'فتح محادثة عامة منفصلة عن ملفات المشاريع'}
        onClick={(event) => {
          if (hasUnsentMessage && !window.confirm(confirmation)) event.preventDefault();
        }}
        className="inline-flex min-h-8 shrink-0 items-center gap-1.5 rounded-md border border-border bg-background/70 px-2.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {currentScope === 'general'
          ? <FolderKanban className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          : <MessageSquareText className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />}
        <span className={compact ? 'hidden sm:inline' : undefined}>{label}</span>
        {compact && (
          <span className="sm:hidden">{currentScope === 'general' ? 'مشروع' : 'عام'}</span>
        )}
      </Link>
    </nav>
  );
}

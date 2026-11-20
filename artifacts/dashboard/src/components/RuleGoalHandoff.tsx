import { useState } from 'react';
import { useUser } from '@clerk/react';
import type { Rule } from '@workspace/api-client-react';
import { Sparkles } from 'lucide-react';
import { useLocation } from 'wouter';
import { storeHomeGoalDraft } from '@/lib/home-goal-handoff';

function ruleGoalText(rule: Rule): string {
  const description = rule.description?.trim().slice(0, 500);
  const fixDescription = rule.fixDescription?.trim().slice(0, 500);
  return [
    `راجع قاعدة الفحص «${rule.title}» (${rule.code}) في هذا المشروع.`,
    description ? `وصف القاعدة: ${description}` : null,
    fixDescription ? `الإصلاح المقترح المسجل: ${fixDescription}` : null,
    'اشرح ما ينبغي التحقق منه واقترح الخطوة التالية. لا تغيّر ملفات المشروع قبل موافقتي.',
  ].filter((part): part is string => Boolean(part)).join('\n\n');
}

export default function RuleGoalHandoff({ rule }: { rule: Rule }) {
  const { isLoaded, user } = useUser();
  const [, setLocation] = useLocation();
  const [saveError, setSaveError] = useState<string | null>(null);
  const projectId = typeof rule.projectId === 'string' ? rule.projectId.trim() : '';

  if (!projectId || !isLoaded || !user?.id) return null;

  const openAssistant = () => {
    const draft = storeHomeGoalDraft(ruleGoalText(rule), user.id, projectId);
    if (!draft) {
      setSaveError('تعذر حفظ سياق القاعدة. لم نفتح المساعد حتى لا يضيع النص.');
      return;
    }

    setLocation(
      `/projects/${encodeURIComponent(projectId)}/workspace?goalDraftId=${encodeURIComponent(draft.id)}#workspace-panel-agent`,
    );
  };

  return (
    <div className="mt-3 rounded-lg border border-border/60 bg-background/40 p-3">
      <p className="mb-2 text-xs leading-relaxed text-muted-foreground">
        افتح مساعد المشروع مع سياق القاعدة، ثم راجع المسودة قبل إرسالها.
      </p>
      <button
        type="button"
        onClick={openAssistant}
        className="inline-flex items-center gap-2 rounded-md border border-primary/35 bg-primary/10 px-3 py-2 text-xs font-medium text-primary transition-colors hover:bg-primary/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        aria-label={`مناقشة القاعدة ${rule.title} مع مساعد المشروع`}
        data-testid={`button-rule-goal-handoff-${rule.id}`}
      >
        <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
        ناقش هذه القاعدة مع مساعد المشروع
      </button>
      {saveError && (
        <p className="mt-2 text-xs text-destructive" role="alert">
          {saveError}
        </p>
      )}
    </div>
  );
}

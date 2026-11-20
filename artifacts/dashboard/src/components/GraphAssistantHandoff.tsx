import { useState } from 'react';
import { useUser } from '@clerk/react';
import { Sparkles } from 'lucide-react';
import { useLocation } from 'wouter';
import { storeHomeGoalDraft } from '@/lib/home-goal-handoff';

type GraphEntityContext = {
  id: string;
  projectId: string;
  type: string;
  name: string;
  path?: string;
};

function safeContextValue(value: string | undefined, maxLength: number): string {
  const withoutControlCharacters = Array.from(value ?? '', (character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint < 32 || (codePoint >= 127 && codePoint <= 159) ? ' ' : character;
  }).join('');

  return withoutControlCharacters
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

function graphGoalText(entity: GraphEntityContext): string {
  const name = safeContextValue(entity.name, 200) || 'العنصر المحدد';
  const type = safeContextValue(entity.type, 80) || 'غير محدد';
  const path = safeContextValue(entity.path, 300);

  return [
    `اشرح لي العنصر «${name}» الذي اخترته في الرسم البياني لهذا المشروع.`,
    `نوع العنصر: ${type}.`,
    path ? `مساره: ${path}.` : null,
    'قد يكون سياق الرسم جزئيًا أو غير حديث؛ تحقق من ملفات المشروع قبل الاستنتاج.',
    'اقترح خطوة تالية واضحة بلغة بسيطة. لا تغيّر ملفات المشروع ولا تبدأ التنفيذ قبل موافقتي.',
  ].filter((part): part is string => Boolean(part)).join('\n\n');
}

export default function GraphAssistantHandoff({
  entity,
  projectId,
}: {
  entity: GraphEntityContext;
  projectId: string;
}) {
  const { isLoaded, user } = useUser();
  const [, setLocation] = useLocation();
  const [saveError, setSaveError] = useState<string | null>(null);

  if (!projectId || entity.projectId !== projectId || !isLoaded || !user?.id) return null;

  const openAssistant = () => {
    const draft = storeHomeGoalDraft(graphGoalText(entity), user.id, projectId);
    if (!draft) {
      setSaveError('تعذر حفظ سياق العنصر. لم نفتح المساعد حتى لا يضيع النص.');
      return;
    }

    setLocation(
      `/projects/${encodeURIComponent(projectId)}/workspace?goalDraftId=${encodeURIComponent(draft.id)}#workspace-panel-agent`,
    );
  };

  return (
    <section
      data-testid="graph-assistant-handoff"
      className="mb-4 rounded-lg border border-border/60 bg-background/40 p-3"
    >
      <p
        data-testid="text-graph-handoff-description"
        className="mb-2 text-xs leading-relaxed text-muted-foreground"
      >
        افتح مساعد المشروع بمسودة تشرح هذا العنصر؛ راجعها قبل إرسالها.
      </p>
      <button
        type="button"
        onClick={openAssistant}
        className="inline-flex items-center gap-2 rounded-md border border-primary/35 bg-primary/10 px-3 py-2 text-xs font-medium text-primary transition-colors hover:bg-primary/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        aria-label={`اسأل مساعد المشروع عن ${safeContextValue(entity.name, 120) || 'العنصر المحدد'}`}
        data-testid={`button-graph-assistant-handoff-${entity.id}`}
      >
        <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
        اسأل مساعد المشروع عن هذا العنصر
      </button>
      {saveError && (
        <p className="mt-2 text-xs text-destructive" role="alert" data-testid="status-graph-handoff-error">
          {saveError}
        </p>
      )}
    </section>
  );
}

import { FolderKanban, MessageSquareText } from 'lucide-react';
import { Link } from 'wouter';

type AssistantScope = 'general' | 'project';
type ProjectOption = { id: string; name: string };

export function AssistantScopeSwitch({
  currentScope,
  projects = [],
  projectsLoading = false,
  projectsError = false,
  onRetryProjects,
  onSelectProject,
  generalHref = '/general-chat',
  onSwitchToGeneral,
  compact = false,
}: {
  currentScope: AssistantScope;
  projects?: ProjectOption[];
  projectsLoading?: boolean;
  projectsError?: boolean;
  onRetryProjects?: () => void;
  onSelectProject?: (projectId: string) => void;
  generalHref?: string;
  onSwitchToGeneral?: () => boolean;
  compact?: boolean;
}) {
  return (
    <nav aria-label="الانتقال بين السؤال العام والعمل داخل مشروع">
      {currentScope === 'general' ? (
        <div className="flex items-center gap-2">
          {projectsLoading ? (
            <span role="status" className="text-xs text-muted-foreground">جارٍ تحميل المشاريع…</span>
          ) : projectsError ? (
            <div className="flex items-center gap-2">
              <span role="alert" className="text-xs text-muted-foreground">تعذر تحميل المشاريع.</span>
              <button
                type="button"
                onClick={onRetryProjects}
                className="min-h-8 rounded-md border border-border px-2 text-xs font-medium text-foreground hover:bg-secondary"
                data-testid="button-retry-scope-projects"
              >
                إعادة المحاولة
              </button>
            </div>
          ) : projects.length === 0 ? (
            <Link
              href="/projects?create=1"
              className="inline-flex min-h-8 shrink-0 items-center gap-1.5 rounded-md border border-border bg-background/70 px-2.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              data-testid="link-create-scope-project"
            >
              <FolderKanban className="h-3.5 w-3.5" aria-hidden="true" />
              أنشئ مشروعًا
            </Link>
          ) : (
            <div className="flex items-center gap-1.5">
              <FolderKanban className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
              <select
                aria-label="اختر مشروعًا للعمل داخله"
                data-testid="select-scope-project"
                defaultValue=""
                onChange={(event) => {
                  const projectId = event.currentTarget.value;
                  if (projects.some((project) => project.id === projectId)) onSelectProject?.(projectId);
                }}
                className="min-h-8 max-w-48 rounded-md border border-border bg-background/70 px-2 text-xs text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <option value="" disabled>اختر مشروعًا…</option>
                {projects.map((project) => (
                  <option key={project.id} value={project.id}>{project.name}</option>
                ))}
              </select>
            </div>
          )}
        </div>
      ) : (
        <Link
          href={generalHref}
          data-testid="link-switch-to-general"
          title="فتح محادثة عامة منفصلة عن ملفات المشاريع"
          onClick={(event) => {
            if (onSwitchToGeneral?.() === false) event.preventDefault();
          }}
          className="inline-flex min-h-8 shrink-0 items-center gap-1.5 rounded-md border border-border bg-background/70 px-2.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <MessageSquareText className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span className={compact ? 'hidden sm:inline' : undefined}>اسأل سؤالًا عامًا</span>
          {compact && <span className="sm:hidden">عام</span>}
        </Link>
      )}
    </nav>
  );
}

import { useState } from 'react';
import { FolderKanban, MessageSquareText, Search } from 'lucide-react';
import { Link } from 'wouter';

type AssistantScope = 'general' | 'project';
type ProjectOption = { id: string; name: string };

function normalizeProjectSearch(value: string): string {
  return value
    .normalize('NFKC')
    .toLocaleLowerCase('ar')
    .replace(/[\u0640\p{M}]/gu, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .trim()
    .replace(/\s+/g, ' ');
}

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
  const [projectSearch, setProjectSearch] = useState('');
  const normalizedQuery = normalizeProjectSearch(projectSearch);
  const matchingProjects = projects.filter((project) =>
    !normalizedQuery || normalizeProjectSearch(project.name).includes(normalizedQuery),
  );

  const chooseProject = (projectId: string) => {
    if (!projects.some((project) => project.id === projectId)) return;
    onSelectProject?.(projectId);
    setProjectSearch('');
  };

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
            <div className="flex flex-wrap items-center gap-1.5">
              <FolderKanban className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
              <div className="relative">
                <Search className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                <input
                  type="search"
                  autoComplete="off"
                  value={projectSearch}
                  onChange={(event) => setProjectSearch(event.target.value)}
                  onKeyDown={(event) => {
                    const isComposing = event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229;
                    if (event.key === 'Enter' && !isComposing && matchingProjects.length === 1) {
                      event.preventDefault();
                      chooseProject(matchingProjects[0]!.id);
                    }
                  }}
                  placeholder="ابحث عن مشروع…"
                  aria-label="ابحث باسم المشروع"
                  aria-controls="scope-project-search-results"
                  data-testid="input-scope-project-search"
                  disabled={!onSelectProject}
                  className="min-h-8 w-36 rounded-md border border-border bg-background/70 py-1 pe-2 ps-7 text-xs text-foreground outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                />
              </div>
              <select
                id="scope-project-search-results"
                aria-label="اختر مشروعًا للعمل داخله"
                data-testid="select-scope-project"
                defaultValue=""
                onChange={(event) => {
                  const projectId = event.currentTarget.value;
                  if (projects.some((project) => project.id === projectId)) chooseProject(projectId);
                }}
                disabled={!onSelectProject}
                className="min-h-8 max-w-48 rounded-md border border-border bg-background/70 px-2 text-xs text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
              >
                <option value="" disabled>اختر مشروعًا…</option>
                {matchingProjects.map((project) => (
                  <option key={project.id} value={project.id}>{project.name}</option>
                ))}
              </select>
              <span
                aria-live="polite"
                aria-atomic="true"
                data-testid="status-scope-project-search"
                className="text-[10px] text-muted-foreground"
              >
                {normalizedQuery && matchingProjects.length === 0
                  ? 'لم نعثر على مشروع بهذا الاسم.'
                  : normalizedQuery
                    ? matchingProjects.length === 1
                      ? 'مشروع واحد. اضغط Enter لاختياره.'
                      : 'توجد عدة مشاريع. اختر من القائمة.'
                    : ''}
              </span>
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

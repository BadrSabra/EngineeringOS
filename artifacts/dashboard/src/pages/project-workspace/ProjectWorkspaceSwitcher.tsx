import { ChevronDown, RefreshCw } from 'lucide-react';
import { useId, useState } from 'react';
import { Link } from 'wouter';
import {
  getListProjectsQueryKey,
  useListProjects,
} from '@workspace/api-client-react';

type ProjectWorkspaceSwitcherProps = {
  currentProjectId: string;
  currentProjectName: string;
};

function CurrentProjectName({ children }: { children: string }) {
  return (
    <span
      dir="auto"
      className="max-w-[min(18rem,55vw)] truncate text-slate-300"
      data-testid="text-current-workspace-project"
    >
      {children}
    </span>
  );
}

function normalizeProjectSearch(value: string) {
  return value
    .normalize('NFKD')
    .replace(/[\u064B-\u065F\u0670\u0640]/g, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/\s+/g, ' ')
    .trim()
    .toLocaleLowerCase('ar');
}

export default function ProjectWorkspaceSwitcher({
  currentProjectId,
  currentProjectName,
}: ProjectWorkspaceSwitcherProps) {
  const searchId = useId();
  const [projectSearch, setProjectSearch] = useState('');
  const projectsQuery = useListProjects(undefined, {
    query: { queryKey: getListProjectsQueryKey() },
  });
  const projects = projectsQuery.data ?? [];

  if (projectsQuery.isLoading) {
    return (
      <span className="inline-flex min-w-0 items-center gap-2">
        <CurrentProjectName>{currentProjectName}</CurrentProjectName>
        <span className="sr-only" role="status">جارٍ تحميل المشاريع الأخرى</span>
      </span>
    );
  }

  if (projectsQuery.isError) {
    return (
      <span className="inline-flex min-w-0 items-center gap-2">
        <CurrentProjectName>{currentProjectName}</CurrentProjectName>
        <span className="text-[11px] text-amber-200" role="status">
          تعذر تحميل المشاريع الأخرى.
        </span>
        <button
          type="button"
          className="inline-flex shrink-0 items-center gap-1 rounded px-2 py-1 text-[11px] text-primary hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          onClick={() => void projectsQuery.refetch()}
          disabled={projectsQuery.isFetching}
          aria-busy={projectsQuery.isFetching}
          data-testid="button-retry-project-switcher"
        >
          <RefreshCw
            aria-hidden="true"
            className={`h-3 w-3 ${projectsQuery.isFetching ? 'animate-spin' : ''}`}
          />
          أعد المحاولة
        </button>
      </span>
    );
  }

  const currentProjectIsListed = projects.some((project) => project.id === currentProjectId);
  if (!currentProjectIsListed) {
    return (
      <span className="inline-flex min-w-0 items-center gap-2">
        <CurrentProjectName>{currentProjectName}</CurrentProjectName>
        <span className="sr-only" role="status">
          تعذر التحقق من قائمة المشاريع الأخرى.
        </span>
      </span>
    );
  }

  const otherProjects = projects.filter((project) => project.id !== currentProjectId);
  if (otherProjects.length === 0) {
    return <CurrentProjectName>{currentProjectName}</CurrentProjectName>;
  }
  const searchEnabled = otherProjects.length > 5;
  const normalizedQuery = normalizeProjectSearch(projectSearch);
  const visibleProjects = searchEnabled && normalizedQuery
    ? otherProjects.filter((project) =>
      normalizeProjectSearch(project.name).includes(normalizedQuery))
    : otherProjects;

  return (
    <details
      className="relative min-w-0"
      data-testid="details-workspace-project-switcher"
    >
      <summary
        aria-label={`التبديل من المشروع ${currentProjectName}`}
        title="التبديل بين المشاريع"
        data-testid="button-workspace-project-switcher"
        className="flex max-w-[min(18rem,55vw)] cursor-pointer list-none items-center gap-1 rounded px-1.5 py-1 text-start text-slate-300 transition hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary [&::-webkit-details-marker]:hidden"
      >
        <span dir="auto" className="truncate">{currentProjectName}</span>
        <ChevronDown aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
      </summary>
      <div
        className="absolute right-0 top-full z-40 mt-1 max-h-64 min-w-56 max-w-[min(82vw,22rem)] overflow-y-auto rounded-lg border border-border bg-card p-1.5 text-foreground shadow-xl"
        dir="rtl"
      >
        <p className="px-2 py-1.5 text-[11px] text-muted-foreground">
          افتح مساحة مشروع آخر
        </p>
        {searchEnabled && (
          <div className="px-1 pb-2">
            <label htmlFor={searchId} className="sr-only">ابحث عن مشروع</label>
            <input
              id={searchId}
              type="search"
              value={projectSearch}
              onChange={(event) => setProjectSearch(event.target.value)}
              placeholder="ابحث باسم المشروع"
              dir="auto"
              aria-label="ابحث عن مشروع"
              data-testid="input-workspace-project-search"
              className="h-9 w-full rounded-md border border-border bg-background px-2.5 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            />
          </div>
        )}
        <ul aria-label="المشاريع الأخرى" className="space-y-1">
          {visibleProjects.length > 0 ? visibleProjects.map((project) => (
            <li key={project.id}>
              <Link
                href={`/projects/${encodeURIComponent(project.id)}/workspace`}
                dir="auto"
                className="block truncate rounded-md px-2 py-2 text-sm hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                data-testid={`link-switch-workspace-project-${project.id}`}
              >
                {project.name}
              </Link>
            </li>
          )) : (
            <li>
              <p className="px-2 py-2 text-xs text-muted-foreground" role="status">
                لا توجد مشاريع تطابق البحث.
              </p>
            </li>
          )}
        </ul>
        <div className="mt-1 border-t border-border pt-1">
          <Link
            href="/projects"
            className="block rounded-md px-2 py-2 text-xs text-primary hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            data-testid="link-all-workspace-projects"
          >
            عرض كل المشاريع
          </Link>
        </div>
      </div>
    </details>
  );
}

import { useEffect, useState } from 'react';
import { useUser } from '@clerk/react';
import { getListProjectsQueryKey, useListProjects } from '@workspace/api-client-react';
import { Search } from 'lucide-react';
import { useLocation } from 'wouter';
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from '@/components/ui/command';
import { DialogTitle } from '@/components/ui/dialog';
import { NAV_GROUPS, PRIMARY_NAV_ITEMS } from './navigation';

const QUICK_NAV_ITEMS = [
  ...PRIMARY_NAV_ITEMS,
  ...NAV_GROUPS.flatMap((group) => group.items),
].filter((item) => item.href !== '/missions' && item.href !== '/mission-control');

function navigationTestId(href: string): string {
  return href === '/'
    ? 'home'
    : href.slice(1).replace(/\//g, '-');
}

export function QuickNavigation() {
  const [open, setOpen] = useState(false);
  const [, setLocation] = useLocation();
  const { isLoaded } = useUser();
  const projectsQuery = useListProjects(undefined, {
    query: { queryKey: getListProjectsQueryKey(), enabled: isLoaded },
  });
  const projects = projectsQuery.data ?? [];

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 'k') return;
      const target = event.target;
      if (
        target instanceof HTMLElement
        && (target.isContentEditable || target.matches('input, textarea, select, [role="textbox"]'))
      ) return;
      event.preventDefault();
      setOpen((current) => !current);
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, []);

  const navigateTo = (href: string) => {
    setOpen(false);
    setLocation(href);
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="فتح البحث السريع"
        aria-haspopup="dialog"
        aria-expanded={open}
        data-testid="button-open-quick-navigation"
        className="inline-flex min-h-9 shrink-0 items-center gap-2 rounded-md border border-border bg-background px-2.5 text-sm text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:px-3"
      >
        <Search className="h-4 w-4 shrink-0" aria-hidden="true" />
        <span className="hidden sm:inline">انتقل إلى صفحة أو مشروع</span>
        <kbd dir="ltr" className="hidden rounded border border-border px-1.5 py-0.5 text-[10px] sm:inline">
          Ctrl / ⌘ K
        </kbd>
      </button>

      <CommandDialog open={open} onOpenChange={setOpen}>
        <DialogTitle className="sr-only">البحث عن صفحة أو مشروع</DialogTitle>
        <CommandInput
          aria-label="ابحث عن صفحة أو مشروع"
          placeholder="اكتب اسم الصفحة أو المشروع…"
          dir="auto"
        />
        {projectsQuery.isError && (
          <p role="status" className="border-b border-border px-4 py-2 text-xs text-muted-foreground">
            تعذر تحميل المشاريع. يمكنك فتح صفحة المشاريع والبحث هناك.
          </p>
        )}
        <CommandList dir="rtl">
          <CommandEmpty>لا توجد نتائج مطابقة.</CommandEmpty>
          <CommandGroup heading="الصفحات">
            {QUICK_NAV_ITEMS.map((item) => (
              <CommandItem
                key={item.href}
                value={`${item.label} ${item.href}`}
                data-testid={`quick-nav-page-${navigationTestId(item.href)}`}
                onSelect={() => navigateTo(item.href)}
              >
                <item.icon className="h-4 w-4" aria-hidden="true" />
                <span>{item.label}</span>
                <CommandShortcut>صفحة</CommandShortcut>
              </CommandItem>
            ))}
          </CommandGroup>
          {projectsQuery.isLoading && (
            <CommandGroup heading="مشاريعك">
              <CommandItem disabled value="جارٍ تحميل المشاريع">
                جارٍ تحميل المشاريع…
              </CommandItem>
            </CommandGroup>
          )}
          {projects.length > 0 && (
            <CommandGroup heading="مشاريعك">
              {projects.map((project) => (
                <CommandItem
                  key={project.id}
                  value={`مشروع ${project.name}`}
                  data-testid={`quick-nav-project-${project.id}`}
                  onSelect={() => navigateTo(`/projects/${encodeURIComponent(project.id)}/workspace`)}
                >
                  <span className="min-w-0 flex-1 truncate">{project.name}</span>
                  <CommandShortcut>مساحة العمل</CommandShortcut>
                </CommandItem>
              ))}
            </CommandGroup>
          )}
        </CommandList>
      </CommandDialog>
    </>
  );
}

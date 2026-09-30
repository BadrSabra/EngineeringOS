import { useEffect, useState, type Ref } from 'react';
import { Link, useLocation } from 'wouter';
import { useUser, useClerk } from '@clerk/react';
import { ChevronDown, LogOut, Network, X } from 'lucide-react';
import { basePath } from '@/lib/clerk';
import {
  NAV_GROUPS,
  PRIMARY_NAV_ITEMS,
  isNavigationItemActive,
  type NavigationItem,
} from './navigation';

function operatorInitials(name: string | null | undefined): string {
  if (!name) return 'OP';
  const parts = name.trim().split(/\s+/);
  const initials = parts.slice(0, 2).map((p) => p[0]?.toUpperCase() ?? '');
  return initials.join('') || 'OP';
}

export function Sidebar({
  mobileOpen = false,
  onMobileClose,
  mobileDrawerRef,
  mobileCloseRef,
}: {
  mobileOpen?: boolean;
  onMobileClose?: () => void;
  mobileDrawerRef?: Ref<HTMLDivElement>;
  mobileCloseRef?: Ref<HTMLButtonElement>;
}) {
  const [location] = useLocation();
  const { user } = useUser();
  const { signOut } = useClerk();
  const activeGroupId = NAV_GROUPS.find((group) =>
    group.items.some((item) => isNavigationItemActive(location, item.href)),
  )?.id;
  const [openGroupIds, setOpenGroupIds] = useState<string[]>(() =>
    activeGroupId ? [activeGroupId] : [],
  );
  const displayName =
    user?.fullName || user?.username || user?.primaryEmailAddress?.emailAddress || 'Operator';

  useEffect(() => {
    if (!activeGroupId) return;
    setOpenGroupIds((current) =>
      current.includes(activeGroupId) ? current : [...current, activeGroupId],
    );
  }, [activeGroupId]);

  const renderNavigationLink = (item: NavigationItem) => {
    const isActive = isNavigationItemActive(location, item.href);
    const testId = item.href === '/'
      ? 'dashboard'
      : item.href.slice(1).replace(/\//g, '-');

    return (
      <Link
        key={item.href}
        href={item.href}
        onClick={onMobileClose}
        aria-current={isActive ? 'page' : undefined}
        data-testid={`link-nav-${testId}`}
        className={`flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
          isActive
            ? 'bg-primary/10 text-primary'
            : 'text-muted-foreground hover:bg-secondary hover:text-foreground'
        }`}
      >
        <item.icon className={`h-4 w-4 shrink-0 ${isActive ? 'text-primary' : ''}`} />
        <span className="truncate">{item.label}</span>
      </Link>
    );
  };

  const toggleGroup = (groupId: string) => {
    setOpenGroupIds((current) =>
      current.includes(groupId)
        ? current.filter((id) => id !== groupId)
        : [...current, groupId],
    );
  };

  return (
    <div
      ref={mobileDrawerRef}
      id="mobile-navigation-drawer"
      role={mobileOpen ? 'dialog' : undefined}
      aria-label={mobileOpen ? 'Main navigation menu' : undefined}
      aria-modal={mobileOpen ? true : undefined}
      tabIndex={-1}
      className={`${mobileOpen ? 'flex' : 'hidden'} fixed inset-y-0 left-0 z-50 w-72 max-w-[calc(100vw-1rem)] border-r border-border bg-card flex-col h-full shrink-0 shadow-2xl transition-transform md:relative md:inset-y-auto md:z-auto md:flex md:w-64 md:max-w-none md:shadow-none`}
    >
      <div className="h-14 flex items-center px-4 border-b border-border shrink-0">
        <div className="flex items-center gap-2 text-primary font-bold text-lg tracking-tight">
          <div className="w-6 h-6 bg-primary rounded flex items-center justify-center text-primary-foreground">
            <Network className="w-4 h-4" />
          </div>
          EngineeringOS
        </div>
        <button
          ref={mobileCloseRef}
          type="button"
          onClick={onMobileClose}
          className="ml-auto rounded-md p-2 text-muted-foreground hover:bg-secondary hover:text-foreground md:hidden"
          aria-label="Close navigation"
          title="Close navigation"
          data-testid="button-close-navigation"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <nav
        aria-label="Main navigation"
        className="flex-1 overflow-y-auto px-3 py-4"
      >
        <div className="mb-2 px-3 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
          Workspace
        </div>
        <div className="space-y-1">
          {PRIMARY_NAV_ITEMS.map(renderNavigationLink)}
        </div>

        <div className="mt-5 space-y-2">
          {NAV_GROUPS.map((group) => {
            const isOpen = openGroupIds.includes(group.id);
            const isActive = group.items.some((item) =>
              isNavigationItemActive(location, item.href),
            );
            const groupContentId = `navigation-group-${group.id}`;

            return (
              <section key={group.id}>
                <button
                  type="button"
                  aria-expanded={isOpen}
                  aria-controls={groupContentId}
                  data-testid={`button-nav-group-${group.id}`}
                  onClick={() => toggleGroup(group.id)}
                  className={`flex w-full items-center justify-between rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                    isActive
                      ? 'text-primary'
                      : 'text-muted-foreground hover:bg-secondary hover:text-foreground'
                  }`}
                >
                  <span>{group.label}</span>
                  <ChevronDown
                    aria-hidden="true"
                    className={`h-4 w-4 transition-transform ${isOpen ? 'rotate-180' : ''}`}
                  />
                </button>
                <div
                  id={groupContentId}
                  hidden={!isOpen}
                  className="space-y-1 pl-2"
                >
                  {group.items.map(renderNavigationLink)}
                </div>
              </section>
            );
          })}
        </div>
      </nav>

      <div className="p-4 border-t border-border shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-secondary border border-border flex items-center justify-center text-xs font-mono font-bold shrink-0">
            {operatorInitials(displayName)}
          </div>
          <div className="flex flex-col min-w-0 flex-1">
            <span className="truncate text-sm font-semibold leading-none" data-testid="text-operator-name">
              {displayName}
            </span>
          </div>
          <button
            type="button"
            onClick={() => signOut({ redirectUrl: basePath || '/' })}
            title="Sign out"
            aria-label="Sign out"
            data-testid="button-sign-out"
            className="p-1.5 text-muted-foreground hover:text-foreground transition-colors rounded-md hover:bg-secondary shrink-0"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}

import {
  Activity,
  BarChart3,
  Bot,
  FolderGit2,
  Gauge,
  GitMerge,
  LayoutDashboard,
  ListTodo,
  Network,
  Plane,
  ShieldAlert,
  ShieldCheck,
  Target,
  type LucideIcon,
} from 'lucide-react';

export type NavigationItem = {
  href: string;
  label: string;
  icon: LucideIcon;
};

export type NavigationGroup = {
  id: string;
  label: string;
  items: NavigationItem[];
};

export const PRIMARY_NAV_ITEMS: NavigationItem[] = [
  { href: '/', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/projects', label: 'Projects', icon: FolderGit2 },
  { href: '/ai', label: 'AI Assistant', icon: Bot },
];

export const NAV_GROUPS: NavigationGroup[] = [
  {
    id: 'execution',
    label: 'Execution',
    items: [
      { href: '/tasks', label: 'Tasks', icon: ListTodo },
      { href: '/missions', label: 'Missions', icon: Target },
      { href: '/mission-control', label: 'Mission Control', icon: Gauge },
      { href: '/workflows', label: 'Workflows', icon: GitMerge },
      { href: '/flight-deck', label: 'Flight Deck', icon: Plane },
    ],
  },
  {
    id: 'insights',
    label: 'Insights',
    items: [
      { href: '/events', label: 'Event Stream', icon: Activity },
      { href: '/metrics', label: 'Metrics', icon: BarChart3 },
      { href: '/graph', label: 'Knowledge Graph', icon: Network },
    ],
  },
  {
    id: 'governance',
    label: 'Governance',
    items: [
      { href: '/rules', label: 'Rules Engine', icon: ShieldAlert },
      { href: '/skill-registry', label: 'Skill Registry', icon: ShieldCheck },
    ],
  },
];

const ALL_NAV_ITEMS = [
  ...PRIMARY_NAV_ITEMS,
  ...NAV_GROUPS.flatMap((group) => group.items),
];

export function isNavigationItemActive(pathname: string, href: string): boolean {
  if (href === '/') return pathname === '/';
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function getNavigationPageLabel(pathname: string): string {
  const matchingItem = ALL_NAV_ITEMS
    .filter((item) => isNavigationItemActive(pathname, item.href))
    .sort((left, right) => right.href.length - left.href.length)[0];

  return matchingItem?.label ?? 'Workspace';
}
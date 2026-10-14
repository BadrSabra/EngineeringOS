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
  description: string;
  items: NavigationItem[];
};

export const PRIMARY_NAV_ITEMS: NavigationItem[] = [
  { href: '/', label: 'الرئيسية', icon: LayoutDashboard },
  { href: '/projects', label: 'المشاريع', icon: FolderGit2 },
  { href: '/ai', label: 'المساعد الذكي', icon: Bot },
];

export const NAV_GROUPS: NavigationGroup[] = [
  {
    id: 'execution',
    label: 'متقدم: التنفيذ والمتابعة',
    description: 'أدوات تشغيلية لمتابعة المهام وخطوات العمل بالتفصيل.',
    items: [
      { href: '/tasks', label: 'المهام', icon: ListTodo },
      { href: '/missions', label: 'الأهداف', icon: Target },
      { href: '/mission-control', label: 'متابعة الأهداف', icon: Gauge },
      { href: '/workflows', label: 'مسارات العمل', icon: GitMerge },
      { href: '/flight-deck', label: 'لوحة التشغيل', icon: Plane },
    ],
  },
  {
    id: 'insights',
    label: 'متقدم: السجلات والمؤشرات',
    description: 'سجل الأحداث والأرقام وخريطة الترابط بين أجزاء المشروع.',
    items: [
      { href: '/events', label: 'سجل الأحداث', icon: Activity },
      { href: '/metrics', label: 'المؤشرات', icon: BarChart3 },
      { href: '/graph', label: 'خريطة الترابط', icon: Network },
    ],
  },
  {
    id: 'governance',
    label: 'متقدم: القواعد والصلاحيات',
    description: 'قواعد العمل والمهارات المسموح بها للمساعد.',
    items: [
      { href: '/rules', label: 'القواعد', icon: ShieldAlert },
      { href: '/skill-registry', label: 'سجل المهارات', icon: ShieldCheck },
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

  return matchingItem?.label ?? 'مساحة العمل';
}
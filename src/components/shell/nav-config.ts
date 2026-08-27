export type NavItem = {
  href: string;
  label: string;
  icon: string;
  /** Shown in the phone tab bar. Everything else lives behind "More". */
  primary: boolean;
  match: (pathname: string) => boolean;
};

export const NAV_ITEMS: NavItem[] = [
  { href: '/today', label: 'Today', icon: 'sun', primary: true, match: (p) => p === '/today' },
  { href: '/tasks', label: 'Tasks', icon: 'check', primary: true, match: (p) => p.startsWith('/tasks') },
  { href: '/calendar', label: 'Calendar', icon: 'calendar', primary: true, match: (p) => p.startsWith('/calendar') },
  { href: '/courses', label: 'Courses', icon: 'book', primary: true, match: (p) => p.startsWith('/courses') },
  {
    href: '/announcements',
    label: 'Announcements',
    icon: 'megaphone',
    primary: false,
    match: (p) => p.startsWith('/announcements'),
  },
  { href: '/notes', label: 'Notes', icon: 'note', primary: false, match: (p) => p.startsWith('/notes') },
  {
    href: '/notifications',
    label: 'Notifications',
    icon: 'bell',
    primary: false,
    match: (p) => p.startsWith('/notifications'),
  },
  { href: '/settings', label: 'Settings', icon: 'settings', primary: false, match: (p) => p.startsWith('/settings') },
];

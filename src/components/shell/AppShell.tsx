'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { setCsrfToken } from '@/lib/client/api';
import { Icon } from '@/components/ui/icon';
import { cx } from '@/components/ui/primitives';
import { NAV_ITEMS } from './nav-config';
import { CommandPalette, type CommandTarget } from './CommandPalette';
import { QuickAdd } from './QuickAdd';
import { SyncStatus } from './SyncStatus';
import { ServiceWorkerBridge } from './ServiceWorkerBridge';

export type ShellUser = { id: string; displayName: string; email: string; timeZone: string };
export type ShellCourse = { id: string; code: string; title: string; color: string; shortLabel: string | null };

export type AppShellProps = {
  user: ShellUser;
  courses: ShellCourse[];
  csrfToken: string;
  unreadNotifications: number;
  unreadAnnouncements: number;
  openConflicts: number;
  children: React.ReactNode;
};

const SIDEBAR_KEY = 'mos.sidebar';

export function AppShell({
  user,
  courses,
  csrfToken,
  unreadNotifications,
  unreadAnnouncements,
  openConflicts,
  children,
}: AppShellProps) {
  const pathname = usePathname();
  const router = useRouter();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [quickAddOpen, setQuickAddOpen] = useState(false);

  useEffect(() => {
    setCsrfToken(csrfToken);
  }, [csrfToken]);

  useEffect(() => {
    try {
      setCollapsed(localStorage.getItem(SIDEBAR_KEY) === 'collapsed');
    } catch {
      /* storage can be blocked; the default is fine */
    }
  }, []);

  const toggleSidebar = useCallback(() => {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(SIDEBAR_KEY, next ? 'collapsed' : 'expanded');
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);

  // Desktop keyboard model: ⌘K / Ctrl-K opens search, "a" adds a task, "g"
  // then a letter jumps. Shortcuts never fire while a field has focus.
  useEffect(() => {
    let awaitingGoto = false;
    const isTyping = (target: EventTarget | null): boolean => {
      const el = target as HTMLElement | null;
      if (!el) return false;
      return (
        el.tagName === 'INPUT' ||
        el.tagName === 'TEXTAREA' ||
        el.tagName === 'SELECT' ||
        el.isContentEditable === true
      );
    };

    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setPaletteOpen(true);
        return;
      }
      if (isTyping(event.target) || event.metaKey || event.ctrlKey || event.altKey) return;

      if (awaitingGoto) {
        awaitingGoto = false;
        const map: Record<string, string> = {
          t: '/today',
          k: '/tasks',
          c: '/calendar',
          o: '/courses',
          a: '/announcements',
          n: '/notes',
          s: '/settings',
        };
        const href = map[event.key.toLowerCase()];
        if (href) {
          event.preventDefault();
          router.push(href);
        }
        return;
      }

      if (event.key === 'g') {
        awaitingGoto = true;
        window.setTimeout(() => {
          awaitingGoto = false;
        }, 1500);
        return;
      }
      if (event.key === 'a') {
        event.preventDefault();
        setQuickAddOpen(true);
      }
      if (event.key === '/') {
        event.preventDefault();
        setPaletteOpen(true);
      }
    };

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [router]);

  useEffect(() => {
    setMobileNavOpen(false);
  }, [pathname]);

  const commandTargets = useMemo<CommandTarget[]>(
    () => [
      ...NAV_ITEMS.map((item) => ({
        kind: 'page' as const,
        id: item.href,
        label: item.label,
        href: item.href,
        hint: 'Go to',
      })),
      ...courses.map((course) => ({
        kind: 'course' as const,
        id: course.id,
        label: `${course.code} — ${course.title}`,
        href: `/courses/${course.id}`,
        hint: 'Course',
        color: course.color,
      })),
    ],
    [courses],
  );

  const primary = NAV_ITEMS.filter((item) => item.primary);

  return (
    <div className="min-h-dvh bg-canvas">
      <ServiceWorkerBridge />

      {/* ---------------------------- desktop sidebar --------------------------- */}
      <div className="flex">
        <aside
          className={cx(
            'no-print sticky top-0 hidden h-dvh shrink-0 border-r border-line bg-surface md:flex md:flex-col',
            collapsed ? 'w-16' : 'w-60',
            'transition-[width] duration-200',
          )}
        >
          <div className="flex items-center gap-2 px-3 py-3">
            <Link href="/today" className="flex min-w-0 items-center gap-2" aria-label="Mapua School OS home">
              <span
                className="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-brand text-brand-ink"
                aria-hidden
              >
                <Icon name="check" size={17} />
              </span>
              {!collapsed && (
                <span className="min-w-0">
                  <span className="block truncate text-[13px] font-semibold leading-tight text-ink">School OS</span>
                  <span className="block truncate text-[11px] leading-tight text-ink-3">{user.displayName}</span>
                </span>
              )}
            </Link>
          </div>

          <nav className="flex-1 overflow-y-auto scroll-thin px-2" aria-label="Main">
            <ul className="space-y-0.5">
              {NAV_ITEMS.map((item) => {
                const active = item.match(pathname);
                const badge =
                  item.href === '/notifications'
                    ? unreadNotifications
                    : item.href === '/announcements'
                      ? unreadAnnouncements
                      : 0;
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      aria-current={active ? 'page' : undefined}
                      title={collapsed ? item.label : undefined}
                      className={cx(
                        'group flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm transition-colors',
                        active
                          ? 'bg-brand-soft font-medium text-brand-strong'
                          : 'text-ink-2 hover:bg-surface-2 hover:text-ink',
                      )}
                    >
                      <Icon name={item.icon} size={18} className="shrink-0" />
                      {!collapsed && <span className="flex-1 truncate">{item.label}</span>}
                      {!collapsed && badge > 0 && (
                        <span className="numeric rounded-full bg-brand px-1.5 py-0.5 text-[10px] font-semibold text-brand-ink">
                          {badge > 99 ? '99+' : badge}
                        </span>
                      )}
                      {collapsed && badge > 0 && (
                        <span className="absolute ml-6 -mt-4 h-2 w-2 rounded-full bg-brand" aria-hidden />
                      )}
                    </Link>
                  </li>
                );
              })}
            </ul>

            {!collapsed && courses.length > 0 && (
              <div className="mt-4">
                <p className="px-2.5 pb-1 text-[11px] font-semibold uppercase tracking-wide text-ink-3">Courses</p>
                <ul className="space-y-0.5">
                  {courses.slice(0, 8).map((course) => (
                    <li key={course.id}>
                      <Link
                        href={`/courses/${course.id}`}
                        className="flex items-center gap-2 rounded-md px-2.5 py-1.5 text-[13px] text-ink-2 transition-colors hover:bg-surface-2 hover:text-ink"
                      >
                        <span
                          className="course-dot"
                          style={{ ['--course-color' as string]: course.color }}
                          aria-hidden
                        />
                        <span className="truncate">{course.code}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </nav>

          <div className="border-t border-line p-2">
            <button
              type="button"
              onClick={toggleSidebar}
              className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-[13px] text-ink-3 transition-colors hover:bg-surface-2 hover:text-ink"
              aria-expanded={!collapsed}
            >
              <Icon name={collapsed ? 'chevronRight' : 'chevronLeft'} size={16} />
              {!collapsed && <span>Collapse</span>}
            </button>
          </div>
        </aside>

        {/* ------------------------------ main column ----------------------------- */}
        <div className="flex min-w-0 flex-1 flex-col">
          <header
            className="no-print sticky top-0 z-30 border-b border-line bg-surface/95 backdrop-blur supports-[backdrop-filter]:bg-surface/80"
            style={{ paddingTop: 'var(--safe-top)' }}
          >
            <div className="flex items-center gap-2 px-3 py-2 md:px-5">
              <button
                type="button"
                className="grid h-10 w-10 place-items-center rounded-md text-ink-2 hover:bg-surface-2 md:hidden"
                onClick={() => setMobileNavOpen(true)}
                aria-label="Open menu"
              >
                <Icon name="menu" size={20} />
              </button>

              <button
                type="button"
                onClick={() => setPaletteOpen(true)}
                className="flex min-w-0 flex-1 items-center gap-2 rounded-md border border-line bg-canvas px-3 py-2 text-left text-[13px] text-ink-3 transition-colors hover:border-line-strong"
              >
                <Icon name="search" size={16} />
                <span className="truncate">Search tasks, courses, notes…</span>
                <kbd className="ml-auto hidden rounded border border-line px-1.5 py-0.5 font-sans text-[10px] text-ink-3 md:inline">
                  ⌘K
                </kbd>
              </button>

              <SyncStatus openConflicts={openConflicts} />

              <Link
                href="/notifications"
                className="relative grid h-10 w-10 place-items-center rounded-md text-ink-2 transition-colors hover:bg-surface-2"
                aria-label={
                  unreadNotifications > 0 ? `Notifications, ${unreadNotifications} unread` : 'Notifications'
                }
              >
                <Icon name="bell" size={18} />
                {unreadNotifications > 0 && (
                  <span className="absolute right-1.5 top-1.5 grid h-4 min-w-4 place-items-center rounded-full bg-brand px-1 text-[9px] font-semibold text-brand-ink">
                    {unreadNotifications > 9 ? '9+' : unreadNotifications}
                  </span>
                )}
              </Link>

              <button
                type="button"
                onClick={() => setQuickAddOpen(true)}
                className="hidden items-center gap-1.5 rounded-md bg-brand px-3 py-2 text-[13px] font-medium text-brand-ink transition-colors hover:bg-brand-strong md:inline-flex"
              >
                <Icon name="plus" size={16} />
                Add
              </button>
            </div>
          </header>

          <main
            id="main"
            className="min-w-0 flex-1 px-3 pb-28 pt-3 md:px-5 md:pb-8"
            style={{ paddingLeft: 'max(0.75rem, var(--safe-left))', paddingRight: 'max(0.75rem, var(--safe-right))' }}
          >
            {children}
          </main>
        </div>
      </div>

      {/* ------------------------------ mobile chrome ---------------------------- */}
      <button
        type="button"
        onClick={() => setQuickAddOpen(true)}
        className="no-print fixed right-4 z-40 grid h-14 w-14 place-items-center rounded-full bg-brand text-brand-ink shadow-e3 transition-transform active:scale-95 md:hidden"
        style={{ bottom: 'calc(4.5rem + var(--safe-bottom))' }}
        aria-label="Quick add"
      >
        <Icon name="plus" size={24} />
      </button>

      <nav
        className="no-print fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface md:hidden"
        style={{ paddingBottom: 'var(--safe-bottom)' }}
        aria-label="Primary"
      >
        <ul className="grid grid-cols-5">
          {primary.map((item) => {
            const active = item.match(pathname);
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  aria-current={active ? 'page' : undefined}
                  className={cx(
                    'flex min-h-14 flex-col items-center justify-center gap-0.5 text-[10px] font-medium transition-colors',
                    active ? 'text-brand' : 'text-ink-3',
                  )}
                >
                  <Icon name={item.icon} size={20} />
                  {item.label}
                </Link>
              </li>
            );
          })}
          <li>
            <button
              type="button"
              onClick={() => setMobileNavOpen(true)}
              className="flex min-h-14 w-full flex-col items-center justify-center gap-0.5 text-[10px] font-medium text-ink-3"
            >
              <Icon name="more" size={20} />
              More
            </button>
          </li>
        </ul>
      </nav>

      {mobileNavOpen && (
        <div className="fixed inset-0 z-50 md:hidden" role="dialog" aria-modal="true" aria-label="Menu">
          <button
            type="button"
            className="absolute inset-0 bg-[var(--c-overlay)]"
            onClick={() => setMobileNavOpen(false)}
            aria-label="Close menu"
          />
          <div
            className="absolute inset-x-0 bottom-0 max-h-[80dvh] overflow-y-auto rounded-t-xl border-t border-line bg-surface p-4"
            style={{ paddingBottom: 'calc(1rem + var(--safe-bottom))' }}
          >
            <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-line-strong" aria-hidden />
            <p className="mb-2 text-sm font-semibold text-ink">{user.displayName}</p>
            <p className="mb-4 truncate text-xs text-ink-3">{user.email}</p>
            <ul className="grid grid-cols-2 gap-2">
              {NAV_ITEMS.map((item) => (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    className="flex min-h-12 items-center gap-2 rounded-md border border-line px-3 text-sm text-ink"
                  >
                    <Icon name={item.icon} size={18} />
                    {item.label}
                  </Link>
                </li>
              ))}
            </ul>
            <form action="/api/auth/signout" method="post" className="mt-3">
              <input type="hidden" name="csrf" value={csrfToken} />
              <button
                type="submit"
                className="flex min-h-12 w-full items-center justify-center gap-2 rounded-md border border-line text-sm text-ink-2"
              >
                <Icon name="logout" size={16} />
                Sign out
              </button>
            </form>
          </div>
        </div>
      )}

      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} targets={commandTargets} />
      <QuickAdd
        open={quickAddOpen}
        onClose={() => setQuickAddOpen(false)}
        courses={courses}
        timeZone={user.timeZone}
      />
    </div>
  );
}

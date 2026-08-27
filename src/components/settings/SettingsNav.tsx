'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Icon } from '@/components/ui/icon';
import { cx } from '@/components/ui/primitives';

const SECTIONS = [
  { href: '/settings', label: 'Account', icon: 'settings', exact: true },
  { href: '/settings/appearance', label: 'Appearance', icon: 'moon' },
  { href: '/settings/notifications', label: 'Notifications', icon: 'bell' },
  { href: '/settings/integrations', label: 'Integrations', icon: 'link' },
  { href: '/settings/sync', label: 'Sync health', icon: 'refresh' },
  { href: '/settings/ai', label: 'Local AI', icon: 'sparkles' },
  { href: '/settings/data', label: 'Data & privacy', icon: 'archive' },
];

export function SettingsNav() {
  const pathname = usePathname();
  return (
    <nav aria-label="Settings sections" className="lg:sticky lg:top-20 lg:self-start">
      <ul className="flex gap-1.5 overflow-x-auto scroll-thin pb-1 lg:flex-col lg:overflow-visible">
        {SECTIONS.map((section) => {
          const active = section.exact ? pathname === section.href : pathname.startsWith(section.href);
          return (
            <li key={section.href} className="shrink-0">
              <Link
                href={section.href}
                aria-current={active ? 'page' : undefined}
                className={cx(
                  'flex min-h-9 items-center gap-2 whitespace-nowrap rounded-md px-2.5 text-[13px]',
                  active ? 'bg-brand-soft font-medium text-brand-strong' : 'text-ink-2 hover:bg-surface-2',
                )}
              >
                <Icon name={section.icon} size={15} />
                {section.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

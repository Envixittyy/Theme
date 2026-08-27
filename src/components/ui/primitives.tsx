import type { ReactNode } from 'react';

/**
 * Presentational primitives.
 *
 * Deliberately small and unabstracted: the product needs a consistent surface,
 * radius and spacing vocabulary far more than it needs a component framework.
 * Every one of these renders semantic HTML and inherits colour from the token
 * layer, so themes and dark mode need no component changes.
 */

export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

export function Card({
  children,
  className,
  as: Tag = 'section',
}: {
  children: ReactNode;
  className?: string;
  as?: 'section' | 'div' | 'article' | 'li';
}) {
  return (
    <Tag
      className={cx(
        'rounded-lg border border-line bg-surface shadow-e1',
        'transition-shadow duration-150',
        className,
      )}
    >
      {children}
    </Tag>
  );
}

export function CardHeader({
  title,
  subtitle,
  action,
  id,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  action?: ReactNode;
  id?: string;
}) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-line px-4 py-3">
      <div className="min-w-0">
        <h2 id={id} className="truncate text-sm font-semibold tracking-tight text-ink">
          {title}
        </h2>
        {subtitle ? <p className="mt-0.5 truncate text-xs text-ink-3">{subtitle}</p> : null}
      </div>
      {action ? <div className="flex shrink-0 items-center gap-1">{action}</div> : null}
    </div>
  );
}

type Tone = 'brand' | 'neutral' | 'accent' | 'info' | 'success' | 'warn' | 'danger';

const TONE_CLASS: Record<Tone, string> = {
  brand: 'bg-brand-soft text-brand-strong border-brand/20',
  neutral: 'bg-surface-2 text-ink-2 border-line',
  accent: 'bg-accent-soft text-warn border-accent/25',
  info: 'bg-info-soft text-info border-info/25',
  success: 'bg-success-soft text-success border-success/25',
  warn: 'bg-warn-soft text-warn border-warn/25',
  danger: 'bg-danger-soft text-danger border-danger/25',
};

export function Badge({
  children,
  tone = 'neutral',
  className,
  title,
}: {
  children: ReactNode;
  tone?: Tone;
  className?: string;
  title?: string;
}) {
  return (
    <span
      title={title}
      className={cx(
        'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium leading-tight',
        TONE_CLASS[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

export function EmptyState({
  title,
  description,
  action,
  icon,
}: {
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-10 text-center">
      {icon ? <div className="text-ink-3" aria-hidden>{icon}</div> : null}
      <p className="text-sm font-medium text-ink">{title}</p>
      {description ? <p className="max-w-sm text-sm text-ink-3">{description}</p> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cx('skeleton', className)} aria-hidden />;
}

/** Loading placeholder that reserves the same box the content will occupy. */
export function ListSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="space-y-2 p-3" role="status" aria-label="Loading">
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className="h-11 w-full" />
      ))}
      <span className="sr-only">Loading…</span>
    </div>
  );
}

export function StatePanel({
  kind,
  title,
  description,
  action,
}: {
  kind: 'error' | 'offline' | 'denied' | 'partial';
  title: string;
  description?: ReactNode;
  action?: ReactNode;
}) {
  const tone: Record<typeof kind, string> = {
    error: 'border-danger/30 bg-danger-soft text-danger',
    offline: 'border-line-strong bg-surface-2 text-ink-2',
    denied: 'border-warn/30 bg-warn-soft text-warn',
    partial: 'border-accent/30 bg-accent-soft text-warn',
  };
  return (
    <div className={cx('rounded-md border px-3 py-2 text-sm', tone[kind])} role="status">
      <p className="font-medium">{title}</p>
      {/* No opacity: dimming already-toned text pushed it under 4.5:1. */}
      {description ? <p className="mt-0.5 text-[13px]">{description}</p> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}

export function CourseDot({ color, label }: { color: string; label?: string | null }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="course-dot" style={{ ['--course-color' as string]: color }} aria-hidden />
      {label ? <span className="text-[11px] font-semibold uppercase tracking-wide text-ink-2">{label}</span> : null}
    </span>
  );
}

export function Meter({ value, max, label }: { value: number; max: number; label: string }) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0;
  return (
    <div className="flex items-center gap-2">
      <div
        className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-3"
        role="progressbar"
        aria-valuenow={value}
        aria-valuemin={0}
        aria-valuemax={max}
        aria-label={label}
      >
        <div className="h-full rounded-full bg-brand transition-[width] duration-300" style={{ width: `${pct}%` }} />
      </div>
      <span className="numeric text-[11px] tabular-nums text-ink-3">{pct}%</span>
    </div>
  );
}

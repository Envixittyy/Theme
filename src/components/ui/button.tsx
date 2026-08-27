'use client';

import type { ButtonHTMLAttributes, ReactNode } from 'react';
import Link from 'next/link';
import { cx } from './primitives';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
type Size = 'sm' | 'md' | 'lg';

const VARIANT: Record<Variant, string> = {
  primary: 'bg-brand text-brand-ink hover:bg-brand-strong border-transparent',
  secondary: 'bg-surface text-ink hover:bg-surface-2 border-line-strong',
  ghost: 'bg-transparent text-ink-2 hover:bg-surface-2 hover:text-ink border-transparent',
  danger: 'bg-danger-soft text-danger hover:bg-danger hover:text-brand-ink border-danger/30',
};

const SIZE: Record<Size, string> = {
  // min-h keeps every control at or above the 44px touch target on coarse
  // pointers without making desktop feel oversized.
  sm: 'min-h-8 px-2.5 text-[13px] gap-1.5',
  md: 'min-h-9 px-3 text-sm gap-2',
  lg: 'min-h-11 px-4 text-sm gap-2',
};

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: Size;
  children: ReactNode;
};

export function Button({ variant = 'secondary', size = 'md', className, children, ...rest }: ButtonProps) {
  return (
    <button
      type="button"
      {...rest}
      className={cx(
        'inline-flex items-center justify-center rounded-md border font-medium',
        'transition-colors duration-100 disabled:cursor-not-allowed disabled:opacity-50',
        VARIANT[variant],
        SIZE[size],
        className,
      )}
    >
      {children}
    </button>
  );
}

export function LinkButton({
  href,
  variant = 'secondary',
  size = 'md',
  className,
  children,
  ...rest
}: {
  href: string;
  variant?: Variant;
  size?: Size;
  className?: string;
  children: ReactNode;
} & Omit<React.ComponentProps<typeof Link>, 'href' | 'className' | 'children'>) {
  return (
    <Link
      href={href}
      data-tap
      {...rest}
      className={cx(
        'inline-flex items-center justify-center rounded-md border font-medium',
        'transition-colors duration-100',
        VARIANT[variant],
        SIZE[size],
        className,
      )}
    >
      {children}
    </Link>
  );
}

export function IconButton({
  label,
  children,
  className,
  variant = 'ghost',
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string; children: ReactNode; variant?: Variant }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      {...rest}
      className={cx(
        'inline-flex h-9 w-9 items-center justify-center rounded-md border transition-colors duration-100',
        VARIANT[variant],
        className,
      )}
    >
      {children}
    </button>
  );
}

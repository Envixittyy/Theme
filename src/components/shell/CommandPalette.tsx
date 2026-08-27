'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Icon } from '@/components/ui/icon';
import { cx } from '@/components/ui/primitives';

export type CommandTarget = {
  kind: 'page' | 'course' | 'task' | 'note' | 'action';
  id: string;
  label: string;
  href: string;
  hint: string;
  color?: string;
};

type SearchResponse = { tasks: CommandTarget[]; notes: CommandTarget[] };

/**
 * Command palette.
 *
 * Static targets (pages, courses) match instantly on the client; tasks and
 * notes come from a debounced server search so the palette stays useful once a
 * term's worth of work has accumulated. Fully keyboard-driven, with a live
 * region so a screen reader hears the result count change.
 */
export function CommandPalette({
  open,
  onClose,
  targets,
}: {
  open: boolean;
  onClose: () => void;
  targets: CommandTarget[];
}) {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [remote, setRemote] = useState<CommandTarget[]>([]);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setQuery('');
      setRemote([]);
      setActive(0);
      window.setTimeout(() => inputRef.current?.focus(), 10);
    }
  }, [open]);

  useEffect(() => {
    if (!open || query.trim().length < 2) {
      setRemote([]);
      return;
    }
    setLoading(true);
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(query)}`, { signal: controller.signal });
        if (!res.ok) throw new Error('search failed');
        const data = (await res.json()) as SearchResponse;
        setRemote([...data.tasks, ...data.notes]);
      } catch {
        setRemote([]);
      } finally {
        setLoading(false);
      }
    }, 180);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
      setLoading(false);
    };
  }, [query, open]);

  const results = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const local = needle ? targets.filter((t) => t.label.toLowerCase().includes(needle)) : targets.slice(0, 8);
    return [...local, ...remote].slice(0, 24);
  }, [query, targets, remote]);

  useEffect(() => {
    setActive(0);
  }, [results.length]);

  if (!open) return null;

  const go = (target: CommandTarget | undefined) => {
    if (!target) return;
    onClose();
    router.push(target.href);
  };

  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label="Search and commands">
      <button type="button" className="absolute inset-0 bg-[var(--c-overlay)]" onClick={onClose} aria-label="Close search" />
      <div className="absolute inset-x-3 top-[8vh] mx-auto max-w-xl overflow-hidden rounded-lg border border-line bg-surface shadow-e3 md:inset-x-0">
        <div className="flex items-center gap-2 border-b border-line px-3">
          <Icon name="search" size={18} className="text-ink-3" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') onClose();
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setActive((i) => Math.min(i + 1, results.length - 1));
              }
              if (e.key === 'ArrowUp') {
                e.preventDefault();
                setActive((i) => Math.max(i - 1, 0));
              }
              if (e.key === 'Enter') {
                e.preventDefault();
                go(results[active]);
              }
            }}
            placeholder="Search tasks, notes, courses…"
            className="w-full bg-transparent py-3 text-sm text-ink outline-none placeholder:text-ink-3"
            aria-controls="command-results"
            aria-activedescendant={results[active] ? `cmd-${results[active].kind}-${results[active].id}` : undefined}
            role="combobox"
            aria-expanded="true"
            autoComplete="off"
          />
          {loading && <span className="text-[11px] text-ink-3">searching…</span>}
        </div>

        <ul id="command-results" role="listbox" className="max-h-[50vh] overflow-y-auto scroll-thin p-1">
          {results.length === 0 && (
            <li className="px-3 py-6 text-center text-sm text-ink-3">
              {query.trim() ? 'Nothing matched.' : 'Start typing to search.'}
            </li>
          )}
          {results.map((target, index) => (
            <li key={`${target.kind}-${target.id}`}>
              <button
                type="button"
                id={`cmd-${target.kind}-${target.id}`}
                role="option"
                aria-selected={index === active}
                onMouseEnter={() => setActive(index)}
                onClick={() => go(target)}
                className={cx(
                  'flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-left text-sm',
                  index === active ? 'bg-brand-soft text-brand-strong' : 'text-ink hover:bg-surface-2',
                )}
              >
                {target.color ? (
                  <span className="course-dot" style={{ ['--course-color' as string]: target.color }} aria-hidden />
                ) : (
                  <Icon
                    name={target.kind === 'note' ? 'note' : target.kind === 'task' ? 'check' : 'chevronRight'}
                    size={16}
                    className="text-ink-3"
                  />
                )}
                <span className="min-w-0 flex-1 truncate">{target.label}</span>
                <span className="shrink-0 text-[11px] text-ink-3">{target.hint}</span>
              </button>
            </li>
          ))}
        </ul>

        <p className="sr-only" role="status">
          {results.length} results
        </p>
        <div className="flex items-center gap-3 border-t border-line px-3 py-2 text-[11px] text-ink-3">
          <span>↑↓ navigate</span>
          <span>↵ open</span>
          <span>esc close</span>
          <span className="ml-auto">g then t/k/c/o for quick jumps</span>
        </div>
      </div>
    </div>
  );
}

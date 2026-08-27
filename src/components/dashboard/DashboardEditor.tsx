'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { cx } from '@/components/ui/primitives';
import { mutate } from '@/lib/client/api';
import { WIDGET_CATALOG, type Breakpoint } from '@/lib/domain/widget-catalog';
import type { LayoutWidget, Layouts } from './WidgetGrid';

/**
 * Widget editor.
 *
 * Edits the layout for the breakpoint you are actually looking at — a phone
 * layout and a desktop layout are separate records, and the header says which
 * one is being changed. Everything is driven by ordinary buttons so it works by
 * keyboard and by touch; there is no drag-only affordance.
 */
export function DashboardEditor({ layouts }: { layouts: Layouts }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [breakpoint, setBreakpoint] = useState<Breakpoint>('desktop');
  const [draft, setDraft] = useState<LayoutWidget[]>([]);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    const detect = () => {
      if (window.matchMedia('(min-width:1280px)').matches) return 'desktop' as const;
      if (window.matchMedia('(min-width:768px)').matches) return 'tablet' as const;
      return 'mobile' as const;
    };
    const apply = () => setBreakpoint(detect());
    apply();
    window.addEventListener('resize', apply);
    return () => window.removeEventListener('resize', apply);
  }, []);

  useEffect(() => {
    setDraft(layouts[breakpoint].map((w) => ({ ...w })));
  }, [layouts, breakpoint, open]);

  const available = useMemo(
    () => WIDGET_CATALOG.filter((def) => !draft.some((w) => w.widgetKey === def.key)),
    [draft],
  );

  const move = (index: number, delta: number) => {
    setDraft((prev) => {
      const next = [...prev];
      const target = index + delta;
      if (target < 0 || target >= next.length) return prev;
      [next[index], next[target]] = [next[target]!, next[index]!];
      return next.map((w, i) => ({ ...w, position: i }));
    });
  };

  const save = async () => {
    setSaving(true);
    const result = await mutate(
      '/api/dashboard/layout',
      'PUT',
      {
        breakpoint,
        widgets: draft.map((w) => ({
          widgetKey: w.widgetKey,
          span: w.span,
          height: w.height,
          hidden: w.hidden,
          settings: {},
        })),
      },
      { label: 'Save dashboard layout' },
    );
    setSaving(false);
    if (!result.ok) {
      setStatus(result.error);
      return;
    }
    setStatus(result.queued ? 'Queued — will save when back online.' : 'Layout saved.');
    if (!result.queued) {
      router.refresh();
      window.setTimeout(() => setOpen(false), 400);
    }
  };

  const reset = async () => {
    setSaving(true);
    const result = await mutate('/api/dashboard/layout', 'POST', { breakpoint, action: 'reset' }, {
      label: 'Reset dashboard layout',
    });
    setSaving(false);
    if (result.ok && !result.queued) {
      setStatus('Reset to the default arrangement.');
      router.refresh();
    }
  };

  return (
    <>
      <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
        <Icon name="grid" size={15} />
        Customise
      </Button>

      {open && (
        <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label="Customise dashboard">
          <button
            type="button"
            className="absolute inset-0 bg-[var(--c-overlay)]"
            onClick={() => setOpen(false)}
            aria-label="Close"
          />
          <div
            className="absolute inset-x-0 bottom-0 max-h-[85dvh] overflow-y-auto scroll-thin rounded-t-xl border-t border-line bg-surface md:inset-y-0 md:left-auto md:right-0 md:w-96 md:max-h-none md:rounded-none md:border-l md:border-t-0"
            style={{ paddingBottom: 'calc(1rem + var(--safe-bottom))' }}
          >
            <div className="sticky top-0 z-10 border-b border-line bg-surface px-4 py-3">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold text-ink">Customise dashboard</h2>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="grid h-9 w-9 place-items-center rounded-md text-ink-3 hover:bg-surface-2"
                  aria-label="Close"
                >
                  <Icon name="close" size={18} />
                </button>
              </div>
              <p className="mt-1 text-[12px] text-ink-3">
                Editing the <strong className="font-semibold text-ink-2">{breakpoint}</strong> layout. Phone,
                tablet and desktop arrangements are stored separately.
              </p>
              <div className="mt-2 flex gap-1" role="group" aria-label="Layout to edit">
                {(['mobile', 'tablet', 'desktop'] as const).map((bp) => (
                  <button
                    key={bp}
                    type="button"
                    onClick={() => setBreakpoint(bp)}
                    aria-pressed={breakpoint === bp}
                    className={cx(
                      'min-h-9 flex-1 rounded-md border px-2 text-[12px] font-medium capitalize',
                      breakpoint === bp
                        ? 'border-brand bg-brand-soft text-brand-strong'
                        : 'border-line text-ink-2 hover:bg-surface-2',
                    )}
                  >
                    {bp}
                  </button>
                ))}
              </div>
            </div>

            <ul className="divide-y divide-[var(--c-line)]">
              {draft.map((widget, index) => {
                const def = WIDGET_CATALOG.find((d) => d.key === widget.widgetKey);
                return (
                  <li key={widget.widgetKey} className="px-4 py-3">
                    <div className="flex items-start gap-2">
                      <Icon name="drag" size={16} className="mt-1 shrink-0 text-ink-3" />
                      <div className="min-w-0 flex-1">
                        <p className={cx('text-[13px] font-medium', widget.hidden ? 'text-ink-3' : 'text-ink')}>
                          {def?.name ?? widget.widgetKey}
                        </p>
                        <p className="text-[11.5px] text-ink-3">{def?.description}</p>
                      </div>
                      <button
                        type="button"
                        onClick={() =>
                          setDraft((prev) =>
                            prev.map((w, i) => (i === index ? { ...w, hidden: !w.hidden } : w)),
                          )
                        }
                        className="grid h-9 w-9 place-items-center rounded-md text-ink-3 hover:bg-surface-2"
                        aria-label={widget.hidden ? `Show ${def?.name}` : `Hide ${def?.name}`}
                        aria-pressed={widget.hidden}
                      >
                        <Icon name={widget.hidden ? 'eyeOff' : 'eye'} size={16} />
                      </button>
                    </div>

                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => move(index, -1)}
                        disabled={index === 0}
                        className="grid h-9 w-9 place-items-center rounded-md border border-line text-ink-2 disabled:opacity-40"
                        aria-label={`Move ${def?.name} earlier`}
                      >
                        <Icon name="chevronLeft" size={15} className="-rotate-90" />
                      </button>
                      <button
                        type="button"
                        onClick={() => move(index, 1)}
                        disabled={index === draft.length - 1}
                        className="grid h-9 w-9 place-items-center rounded-md border border-line text-ink-2 disabled:opacity-40"
                        aria-label={`Move ${def?.name} later`}
                      >
                        <Icon name="chevronRight" size={15} className="rotate-90" />
                      </button>

                      {breakpoint !== 'mobile' && (
                        <label className="ml-1 inline-flex items-center gap-1 text-[11.5px] text-ink-3">
                          Width
                          <select
                            value={widget.span}
                            onChange={(e) =>
                              setDraft((prev) =>
                                prev.map((w, i) => (i === index ? { ...w, span: Number(e.target.value) } : w)),
                              )
                            }
                            className="min-h-9 rounded-md border border-line bg-canvas px-1.5 text-[12px] text-ink"
                            aria-label={`Width of ${def?.name}`}
                          >
                            <option value={1}>¼</option>
                            <option value={2}>½</option>
                            <option value={3}>¾</option>
                            <option value={4}>Full</option>
                          </select>
                        </label>
                      )}

                      <label className="inline-flex items-center gap-1 text-[11.5px] text-ink-3">
                        Height
                        <select
                          value={widget.height}
                          onChange={(e) =>
                            setDraft((prev) =>
                              prev.map((w, i) => (i === index ? { ...w, height: e.target.value } : w)),
                            )
                          }
                          className="min-h-9 rounded-md border border-line bg-canvas px-1.5 text-[12px] text-ink"
                          aria-label={`Height of ${def?.name}`}
                        >
                          <option value="auto">Auto</option>
                          <option value="short">Short</option>
                          <option value="tall">Tall</option>
                        </select>
                      </label>

                      <button
                        type="button"
                        onClick={() => setDraft((prev) => prev.filter((_, i) => i !== index).map((w, i) => ({ ...w, position: i })))}
                        className="ml-auto grid h-9 w-9 place-items-center rounded-md text-ink-3 hover:bg-danger-soft hover:text-danger"
                        aria-label={`Remove ${def?.name}`}
                      >
                        <Icon name="trash" size={15} />
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>

            {available.length > 0 && (
              <div className="border-t border-line px-4 py-3">
                <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-ink-3">Add a widget</p>
                <div className="flex flex-wrap gap-1.5">
                  {available.map((def) => (
                    <button
                      key={def.key}
                      type="button"
                      onClick={() =>
                        setDraft((prev) => [
                          ...prev,
                          {
                            widgetKey: def.key,
                            position: prev.length,
                            span: breakpoint === 'mobile' ? 1 : def.defaultSpan[breakpoint],
                            height: 'auto',
                            hidden: false,
                          },
                        ])
                      }
                      className="min-h-9 rounded-md border border-line px-2.5 text-[12px] text-ink-2 hover:border-brand hover:text-brand"
                    >
                      + {def.name}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="sticky bottom-0 flex items-center gap-2 border-t border-line bg-surface px-4 py-3">
              <Button variant="ghost" size="sm" onClick={() => void reset()} disabled={saving}>
                Reset to default
              </Button>
              <span className="flex-1 text-[11.5px] text-ink-3" role="status">
                {status}
              </span>
              <Button variant="primary" size="sm" onClick={() => void save()} disabled={saving}>
                {saving ? 'Saving…' : 'Save layout'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

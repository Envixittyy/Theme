'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { Card, EmptyState, cx } from '@/components/ui/primitives';
import { mutate } from '@/lib/client/api';
import { formatRelative } from '@/lib/shared/time';
import { renderMarkdown } from './markdown';

type Note = {
  id: string;
  title: string;
  body: string;
  courseId: string | null;
  pinned: boolean;
  updatedAt: string;
};

/**
 * Notes.
 *
 * Autosaves on a debounce and reports its own state honestly — "saving",
 * "saved", or "queued offline" — because a note editor that silently loses a
 * revision is worse than no note editor. Preview renders a small, deliberately
 * limited Markdown subset with no raw HTML.
 */
export function NotesWorkspace({
  notes,
  active,
  backlinks,
  courses,
  search,
  timeZone,
}: {
  notes: Note[];
  active: Note | null;
  backlinks: Array<{ id: string; title: string }>;
  courses: Array<{ id: string; code: string; color: string }>;
  search: string;
  timeZone: string;
}) {
  const router = useRouter();
  const params = useSearchParams();
  const [draft, setDraft] = useState<Note | null>(active);
  const [query, setQuery] = useState(search);
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | 'queued' | 'error'>('idle');
  const [mode, setMode] = useState<'write' | 'preview'>('write');
  const timer = useRef<number | null>(null);

  useEffect(() => {
    setDraft(active);
    setState('idle');
  }, [active]);

  const courseById = useMemo(() => new Map(courses.map((c) => [c.id, c])), [courses]);

  const scheduleSave = (next: Note) => {
    setDraft(next);
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => void save(next), 700);
  };

  const save = async (note: Note) => {
    setState('saving');
    const result = await mutate(
      `/api/notes/${note.id}`,
      'PATCH',
      { title: note.title, body: note.body, courseId: note.courseId, pinned: note.pinned },
      { label: `Edit note “${note.title.slice(0, 30)}”` },
    );
    if (!result.ok) {
      setState('error');
      return;
    }
    setState(result.queued ? 'queued' : 'saved');
    if (!result.queued) router.refresh();
  };

  const create = async () => {
    const result = await mutate<{ note: { id: string } }>('/api/notes', 'POST', { title: 'Untitled note', body: '' }, {
      label: 'Add note',
    });
    if (result.ok && !result.queued && result.data) {
      router.push(`/notes?note=${result.data.note.id}`);
    }
  };

  const runSearch = (value: string) => {
    const next = new URLSearchParams(params.toString());
    if (value) next.set('q', value);
    else next.delete('q');
    next.delete('note');
    router.push(`/notes?${next.toString()}`);
  };

  return (
    <div className="mx-auto max-w-6xl">
      <header className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-semibold tracking-tight text-ink">Notes</h1>
        <Button variant="primary" size="sm" onClick={() => void create()}>
          <Icon name="plus" size={15} />
          New note
        </Button>
      </header>

      <div className="grid gap-3 lg:grid-cols-[17rem_1fr]">
        <div className="space-y-2">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              runSearch(query);
            }}
            className="flex items-center gap-2 rounded-md border border-line bg-surface px-2"
          >
            <Icon name="search" size={15} className="text-ink-3" />
            <label htmlFor="note-search" className="sr-only">
              Search notes
            </label>
            <input
              id="note-search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search notes…"
              className="min-h-9 w-full bg-transparent text-[13px] text-ink outline-none"
            />
          </form>

          <Card className="max-h-[65dvh] overflow-y-auto scroll-thin">
            {notes.length === 0 ? (
              <EmptyState title="No notes" description={search ? 'Nothing matched that search.' : 'Start one with “New note”.'} />
            ) : (
              <ul className="divide-y divide-[var(--c-line)]">
                {notes.map((note) => {
                  const course = note.courseId ? courseById.get(note.courseId) : null;
                  return (
                    <li key={note.id}>
                      <button
                        type="button"
                        onClick={() => router.push(`/notes?note=${note.id}`)}
                        className={cx(
                          'block w-full px-3 py-2 text-left',
                          note.id === draft?.id ? 'bg-brand-soft' : 'hover:bg-surface-2',
                        )}
                      >
                        <div className="flex items-center gap-1.5">
                          {note.pinned && <Icon name="star" size={12} className="shrink-0 text-accent" />}
                          {course && (
                            <span
                              className="course-dot"
                              style={{ ['--course-color' as string]: course.color }}
                              aria-hidden
                            />
                          )}
                          <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-ink">{note.title}</span>
                        </div>
                        <p
                          className={cx(
                            'mt-0.5 line-clamp-1 text-[11.5px]',
                            note.id === draft?.id ? 'text-ink-2' : 'text-ink-3',
                          )}
                        >
                          {note.body.replace(/[#*`>[\]]/g, '').slice(0, 80) || 'Empty note'}
                        </p>
                        <p
                          className={cx(
                            'numeric mt-0.5 text-[10.5px]',
                            note.id === draft?.id ? 'text-ink-2' : 'text-ink-3',
                          )}
                        >
                          {formatRelative(new Date(note.updatedAt))}
                        </p>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>
        </div>

        <Card className="min-h-[60dvh]">
          {!draft ? (
            <EmptyState title="No note selected" description="Pick one from the list, or create a new note." />
          ) : (
            <div className="flex h-full flex-col">
              <div className="flex flex-wrap items-center gap-2 border-b border-line p-3">
                <label htmlFor="note-title" className="sr-only">
                  Note title
                </label>
                <input
                  id="note-title"
                  value={draft.title}
                  onChange={(e) => scheduleSave({ ...draft, title: e.target.value })}
                  className="min-w-0 flex-1 bg-transparent text-[15px] font-semibold text-ink outline-none"
                />
                <select
                  value={draft.courseId ?? ''}
                  onChange={(e) => scheduleSave({ ...draft, courseId: e.target.value || null })}
                  className="min-h-9 rounded-md border border-line bg-canvas px-2 text-[12.5px] text-ink"
                  aria-label="Link to a course"
                >
                  <option value="">No course</option>
                  {courses.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.code}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => scheduleSave({ ...draft, pinned: !draft.pinned })}
                  aria-pressed={draft.pinned}
                  className={cx(
                    'grid h-9 w-9 place-items-center rounded-md border',
                    draft.pinned ? 'border-accent bg-accent-soft text-warn' : 'border-line text-ink-3 hover:bg-surface-2',
                  )}
                  aria-label={draft.pinned ? 'Unpin note' : 'Pin note'}
                >
                  <Icon name="star" size={15} />
                </button>
                <div className="flex rounded-md border border-line p-0.5">
                  {(['write', 'preview'] as const).map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => setMode(m)}
                      aria-pressed={mode === m}
                      className={cx(
                        'min-h-8 rounded px-2 text-[12px] font-medium capitalize',
                        mode === m ? 'bg-brand text-brand-ink' : 'text-ink-2',
                      )}
                    >
                      {m}
                    </button>
                  ))}
                </div>
              </div>

              {mode === 'write' ? (
                <>
                  <label htmlFor="note-body" className="sr-only">
                    Note body, Markdown supported
                  </label>
                  <textarea
                    id="note-body"
                    value={draft.body}
                    onChange={(e) => scheduleSave({ ...draft, body: e.target.value })}
                    placeholder={'# Heading\n\n- [ ] a checklist item\n\nLink another note with [[Its Title]].'}
                    className="min-h-[45dvh] flex-1 resize-none bg-transparent p-4 font-mono text-[13px] leading-relaxed text-ink outline-none"
                    spellCheck
                  />
                </>
              ) : (
                <div
                  className="prose-note min-h-[45dvh] flex-1 overflow-y-auto scroll-thin p-4 text-[14px] leading-relaxed text-ink"
                  dangerouslySetInnerHTML={{ __html: renderMarkdown(draft.body) }}
                />
              )}

              <div className="flex flex-wrap items-center gap-2 border-t border-line px-3 py-2">
                <span className="text-[11.5px] text-ink-3" role="status">
                  {state === 'saving' && 'Saving…'}
                  {state === 'saved' && 'Saved'}
                  {state === 'queued' && 'Queued offline — will sync when you reconnect'}
                  {state === 'error' && <span className="text-danger">Could not save</span>}
                  {state === 'idle' && `Edited ${formatRelative(new Date(draft.updatedAt))}`}
                </span>
                {backlinks.length > 0 && (
                  <span className="ml-auto flex flex-wrap items-center gap-1.5 text-[11.5px] text-ink-3">
                    Linked from:
                    {backlinks.map((b) => (
                      <button
                        key={b.id}
                        type="button"
                        onClick={() => router.push(`/notes?note=${b.id}`)}
                        className="rounded border border-line px-1.5 py-0.5 text-ink-2 hover:bg-surface-2"
                      >
                        {b.title}
                      </button>
                    ))}
                  </span>
                )}
              </div>
            </div>
          )}
        </Card>
      </div>
      <p className="sr-only">Times shown in {timeZone}</p>
    </div>
  );
}

'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { cx } from '@/components/ui/primitives';
import { mutate } from '@/lib/client/api';
import { COURSE_PALETTE } from '@/lib/domain/course-palette';

export type MeetingDraft = {
  weekday: number;
  startMinute: number;
  endMinute: number;
  location: string | null;
  modality: string;
};

export type CourseDraft = {
  id?: string;
  code: string;
  title: string;
  instructor: string | null;
  room: string | null;
  color: string;
  icon: string | null;
  units: number | null;
};

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const toTime = (minute: number): string =>
  `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
const fromTime = (value: string): number => {
  const [h, m] = value.split(':');
  return Number(h) * 60 + Number(m);
};

/**
 * Course editor.
 *
 * Colour is the course's identity across every screen, so it is chosen from a
 * palette that has been checked for contrast on both themes rather than from a
 * free colour picker that can produce an unreadable chip.
 */
export function CourseForm({
  initial,
  initialMeetings,
  onDone,
}: {
  initial?: CourseDraft;
  initialMeetings?: MeetingDraft[];
  onDone: () => void;
}) {
  const router = useRouter();
  const [draft, setDraft] = useState<CourseDraft>(
    initial ?? { code: '', title: '', instructor: '', room: '', color: COURSE_PALETTE[0]!, icon: '', units: null },
  );
  const [meetings, setMeetings] = useState<MeetingDraft[]>(initialMeetings ?? []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setBusy(true);
    setError(null);
    const payload = {
      code: draft.code.trim().toUpperCase(),
      title: draft.title.trim(),
      instructor: draft.instructor || null,
      room: draft.room || null,
      color: draft.color,
      icon: draft.icon || null,
      units: draft.units,
      meetings: meetings.map((m) => ({
        weekday: m.weekday,
        startMinute: m.startMinute,
        endMinute: m.endMinute,
        location: m.location || null,
        modality: m.modality,
      })),
    };
    const result = initial?.id
      ? await mutate(`/api/courses/${initial.id}`, 'PATCH', payload, { label: `Edit ${payload.code}` })
      : await mutate('/api/courses', 'POST', payload, { label: `Add ${payload.code}` });
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    onDone();
    if (!result.queued) router.refresh();
  };

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2">
        <label className="text-[11.5px] font-medium text-ink-3">
          Code
          <input
            value={draft.code}
            onChange={(e) => setDraft({ ...draft, code: e.target.value })}
            placeholder="CHM031"
            className="mt-1 min-h-9 w-full rounded-md border border-line bg-canvas px-2 text-[13px] uppercase text-ink"
          />
        </label>
        <label className="text-[11.5px] font-medium text-ink-3">
          Units
          <input
            type="number"
            min={0}
            step={0.5}
            value={draft.units ?? ''}
            onChange={(e) => setDraft({ ...draft, units: e.target.value ? Number(e.target.value) : null })}
            className="mt-1 min-h-9 w-full rounded-md border border-line bg-canvas px-2 text-[13px] text-ink"
          />
        </label>
      </div>

      <label className="block text-[11.5px] font-medium text-ink-3">
        Title
        <input
          value={draft.title}
          onChange={(e) => setDraft({ ...draft, title: e.target.value })}
          placeholder="Chemistry for Engineers"
          className="mt-1 min-h-9 w-full rounded-md border border-line bg-canvas px-2 text-[13px] text-ink"
        />
      </label>

      <div className="grid grid-cols-2 gap-2">
        <label className="text-[11.5px] font-medium text-ink-3">
          Instructor
          <input
            value={draft.instructor ?? ''}
            onChange={(e) => setDraft({ ...draft, instructor: e.target.value })}
            className="mt-1 min-h-9 w-full rounded-md border border-line bg-canvas px-2 text-[13px] text-ink"
          />
        </label>
        <label className="text-[11.5px] font-medium text-ink-3">
          Room
          <input
            value={draft.room ?? ''}
            onChange={(e) => setDraft({ ...draft, room: e.target.value })}
            className="mt-1 min-h-9 w-full rounded-md border border-line bg-canvas px-2 text-[13px] text-ink"
          />
        </label>
      </div>

      <fieldset>
        <legend className="text-[11.5px] font-medium text-ink-3">Colour</legend>
        <div className="mt-1 flex flex-wrap gap-1.5">
          {COURSE_PALETTE.map((color) => (
            <button
              key={color}
              type="button"
              onClick={() => setDraft({ ...draft, color })}
              aria-label={`Use colour ${color}`}
              aria-pressed={draft.color === color}
              className={cx(
                'h-9 w-9 rounded-md border-2 transition-transform',
                draft.color === color ? 'border-ink scale-105' : 'border-transparent',
              )}
              style={{ background: color }}
            />
          ))}
        </div>
      </fieldset>

      <label className="block text-[11.5px] font-medium text-ink-3">
        Icon (one character, optional)
        <input
          value={draft.icon ?? ''}
          onChange={(e) => setDraft({ ...draft, icon: e.target.value.slice(0, 2) })}
          placeholder="⚗"
          className="mt-1 min-h-9 w-24 rounded-md border border-line bg-canvas px-2 text-[13px] text-ink"
        />
      </label>

      <fieldset>
        <legend className="mb-1 text-[11.5px] font-medium text-ink-3">Meeting times</legend>
        <ul className="space-y-1.5">
          {meetings.map((m, index) => (
            <li key={index} className="flex flex-wrap items-center gap-1.5">
              <select
                value={m.weekday}
                onChange={(e) =>
                  setMeetings((prev) => prev.map((x, i) => (i === index ? { ...x, weekday: Number(e.target.value) } : x)))
                }
                className="min-h-9 rounded-md border border-line bg-canvas px-1.5 text-[12.5px] text-ink"
                aria-label="Day"
              >
                {DAY_NAMES.map((d, i) => (
                  <option key={d} value={i}>
                    {d}
                  </option>
                ))}
              </select>
              <input
                type="time"
                value={toTime(m.startMinute)}
                onChange={(e) =>
                  setMeetings((prev) =>
                    prev.map((x, i) => (i === index ? { ...x, startMinute: fromTime(e.target.value) } : x)),
                  )
                }
                className="min-h-9 rounded-md border border-line bg-canvas px-1.5 text-[12.5px] text-ink"
                aria-label="Start time"
              />
              <input
                type="time"
                value={toTime(m.endMinute)}
                onChange={(e) =>
                  setMeetings((prev) =>
                    prev.map((x, i) => (i === index ? { ...x, endMinute: fromTime(e.target.value) } : x)),
                  )
                }
                className="min-h-9 rounded-md border border-line bg-canvas px-1.5 text-[12.5px] text-ink"
                aria-label="End time"
              />
              <input
                value={m.location ?? ''}
                onChange={(e) =>
                  setMeetings((prev) => prev.map((x, i) => (i === index ? { ...x, location: e.target.value } : x)))
                }
                placeholder="Room"
                className="min-h-9 w-24 rounded-md border border-line bg-canvas px-1.5 text-[12.5px] text-ink"
                aria-label="Location"
              />
              <button
                type="button"
                onClick={() => setMeetings((prev) => prev.filter((_, i) => i !== index))}
                className="grid h-9 w-9 place-items-center rounded-md text-ink-3 hover:bg-danger-soft hover:text-danger"
                aria-label="Remove this meeting"
              >
                <Icon name="trash" size={15} />
              </button>
            </li>
          ))}
        </ul>
        <Button
          size="sm"
          className="mt-1.5"
          onClick={() =>
            setMeetings((prev) => [
              ...prev,
              { weekday: 1, startMinute: 9 * 60, endMinute: 10 * 60 + 30, location: draft.room, modality: 'onsite' },
            ])
          }
        >
          <Icon name="plus" size={14} /> Add meeting
        </Button>
      </fieldset>

      {error && (
        <p className="rounded-md bg-danger-soft px-2 py-1.5 text-[12px] text-danger" role="alert">
          {error}
        </p>
      )}

      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button variant="primary" onClick={() => void save()} disabled={busy || !draft.code.trim() || !draft.title.trim()}>
          {busy ? 'Saving…' : initial?.id ? 'Save course' : 'Add course'}
        </Button>
      </div>
    </div>
  );
}

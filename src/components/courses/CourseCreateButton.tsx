'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { CourseForm } from './CourseForm';

export function CourseCreateButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="primary" size="sm" onClick={() => setOpen(true)}>
        <Icon name="plus" size={15} />
        Add course
      </Button>
      {open && (
        <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label="Add course">
          <button type="button" className="absolute inset-0 bg-[var(--c-overlay)]" onClick={() => setOpen(false)} aria-label="Close" />
          <div
            className="absolute inset-x-0 bottom-0 max-h-[88dvh] overflow-y-auto scroll-thin rounded-t-xl border-t border-line bg-surface p-4 md:inset-x-auto md:bottom-auto md:left-1/2 md:top-[6vh] md:w-full md:max-w-lg md:-translate-x-1/2 md:rounded-lg md:border"
            style={{ paddingBottom: 'calc(1rem + var(--safe-bottom))' }}
          >
            <h2 className="mb-3 text-sm font-semibold text-ink">Add a course</h2>
            <CourseForm onDone={() => setOpen(false)} />
          </div>
        </div>
      )}
    </>
  );
}

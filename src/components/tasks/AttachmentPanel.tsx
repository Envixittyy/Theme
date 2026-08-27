'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { Badge, Card, CardHeader } from '@/components/ui/primitives';
import { getCsrfToken } from '@/lib/client/api';

type Attachment = {
  id: string;
  fileName: string;
  byteSize: number;
  contentType: string;
  scanState: string;
  createdAt: string;
};

/**
 * Upload flow.
 *
 * Three steps on purpose: the server issues an upload target (validating type
 * and size *before* any bytes move), the browser sends the bytes, and the
 * server finalises after inspecting them. Uploads are not queued offline —
 * queuing megabytes in IndexedDB is a good way to fill a phone — so the control
 * says so plainly instead of failing silently.
 */
export function AttachmentPanel({ taskId, attachments }: { taskId: string; attachments: Attachment[] }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const upload = async (file: File) => {
    setError(null);
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      setError('Uploads need a connection. The file was not queued.');
      return;
    }
    setProgress(0);
    try {
      const initRes = await fetch('/api/attachments', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-csrf-token': getCsrfToken() ?? '' },
        body: JSON.stringify({
          fileName: file.name,
          contentType: file.type || 'application/octet-stream',
          byteSize: file.size,
          taskId,
        }),
      });
      const init = (await initRes.json()) as {
        error?: string;
        attachmentId?: string;
        upload?: { url: string; method: string; headers: Record<string, string> };
      };
      if (!initRes.ok || !init.upload || !init.attachmentId) {
        setError(init.error ?? 'The server would not accept that file.');
        setProgress(null);
        return;
      }

      await new Promise<void>((resolvePut, rejectPut) => {
        const xhr = new XMLHttpRequest();
        xhr.open(init.upload!.method, init.upload!.url);
        for (const [k, v] of Object.entries(init.upload!.headers)) xhr.setRequestHeader(k, v);
        if (init.upload!.url.startsWith('/')) xhr.setRequestHeader('x-csrf-token', getCsrfToken() ?? '');
        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable) setProgress(Math.round((e.loaded / e.total) * 100));
        };
        xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolvePut() : rejectPut(new Error(`upload failed (${xhr.status})`)));
        xhr.onerror = () => rejectPut(new Error('upload failed'));
        xhr.send(file);
      });

      const finishRes = await fetch(`/api/attachments/${init.attachmentId}/complete`, {
        method: 'POST',
        headers: { 'x-csrf-token': getCsrfToken() ?? '' },
      });
      if (!finishRes.ok) {
        const payload = (await finishRes.json()) as { error?: string };
        setError(payload.error ?? 'The file was rejected after inspection.');
        setProgress(null);
        return;
      }
      setProgress(null);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed');
      setProgress(null);
    }
  };

  const remove = async (id: string) => {
    if (!window.confirm('Remove this attachment?')) return;
    await fetch(`/api/attachments/${id}`, { method: 'DELETE', headers: { 'x-csrf-token': getCsrfToken() ?? '' } });
    router.refresh();
  };

  return (
    <Card>
      <CardHeader
        title="Attachments"
        subtitle="Stored privately; links expire minutes after you open them"
        action={
          <Button size="sm" onClick={() => inputRef.current?.click()} disabled={progress !== null}>
            <Icon name="upload" size={14} />
            Add file
          </Button>
        }
      />
      <input
        ref={inputRef}
        type="file"
        className="sr-only"
        // Triggered by the visible button above, but it is still a form control
        // and still needs a name for anything reading the page.
        aria-label="Choose a file to attach"
        tabIndex={-1}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void upload(file);
          e.target.value = '';
        }}
      />

      {progress !== null && (
        <div className="px-4 py-2">
          <div className="h-1.5 overflow-hidden rounded-full bg-surface-3">
            <div className="h-full bg-brand transition-[width]" style={{ width: `${progress}%` }} />
          </div>
          <p className="mt-1 text-[11.5px] text-ink-3" role="status">
            Uploading… {progress}%
          </p>
        </div>
      )}
      {error && (
        <p className="mx-4 my-2 rounded-md bg-danger-soft px-2 py-1.5 text-[12px] text-danger" role="alert">
          {error}
        </p>
      )}

      {attachments.length === 0 && progress === null ? (
        <p className="px-4 py-3 text-[13px] text-ink-3">No files attached.</p>
      ) : (
        <ul className="divide-y divide-[var(--c-line)]">
          {attachments.map((file) => (
            <li key={file.id} className="flex items-center gap-2 px-4 py-2">
              <Icon name="note" size={16} className="shrink-0 text-ink-3" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] text-ink">{file.fileName}</p>
                <p className="text-[11px] text-ink-3">
                  {formatBytes(file.byteSize)} · {file.contentType}
                </p>
              </div>
              {file.scanState === 'clean' ? (
                <Badge tone="success" title="Signature checked; no antivirus is configured on this server">
                  checked
                </Badge>
              ) : (
                <Badge tone="neutral">{file.scanState}</Badge>
              )}
              <a
                href={`/api/attachments/${file.id}/download`}
                className="grid h-8 w-8 place-items-center rounded-md text-ink-3 hover:bg-surface-2 hover:text-ink"
                aria-label={`Download ${file.fileName}`}
              >
                <Icon name="download" size={15} />
              </a>
              <button
                type="button"
                onClick={() => void remove(file.id)}
                className="grid h-8 w-8 place-items-center rounded-md text-ink-3 hover:bg-danger-soft hover:text-danger"
                aria-label={`Remove ${file.fileName}`}
              >
                <Icon name="trash" size={15} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

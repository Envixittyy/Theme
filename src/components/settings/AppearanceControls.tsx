'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { cx } from '@/components/ui/primitives';
import { mutate } from '@/lib/client/api';

type ThemeRow = { id: string; name: string; mode: string; tokens: Record<string, string>; isBuiltIn: boolean };

const EDITABLE_TOKENS: Array<{ key: string; label: string; hint: string }> = [
  { key: '--c-brand', label: 'Primary', hint: 'Navigation, focus and key actions' },
  { key: '--c-accent', label: 'Accent', hint: 'Timetable headers and highlights' },
  { key: '--c-canvas', label: 'Background', hint: 'The page behind every card' },
  { key: '--c-surface', label: 'Surface', hint: 'Cards and panels' },
];

/**
 * Appearance.
 *
 * Theme mode is applied to the document immediately and mirrored to
 * localStorage so the pre-paint bootstrap in the root layout can restore it on
 * the next load without a flash; the server copy is what syncs it to other
 * devices.
 */
export function AppearanceControls({
  themeMode,
  density,
  themes,
  activeThemeId,
}: {
  themeMode: 'light' | 'dark' | 'system';
  density: 'compact' | 'comfortable';
  themes: ThemeRow[];
  activeThemeId: string | null;
}) {
  const router = useRouter();
  const [mode, setMode] = useState(themeMode);
  const [dense, setDense] = useState(density);
  const [customTokens, setCustomTokens] = useState<Record<string, string>>(
    themes.find((t) => t.id === activeThemeId)?.tokens ?? {},
  );
  const [themeName, setThemeName] = useState('My theme');
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    applyMode(mode);
  }, [mode]);

  useEffect(() => {
    document.documentElement.setAttribute('data-density', dense);
    try {
      localStorage.setItem('mos.density', dense);
    } catch {
      /* storage may be blocked */
    }
  }, [dense]);

  const applyTokens = (tokens: Record<string, string>) => {
    const root = document.documentElement;
    for (const { key } of EDITABLE_TOKENS) root.style.removeProperty(key);
    for (const [key, value] of Object.entries(tokens)) {
      if (/^--c-[a-z0-9-]+$/.test(key) && /^#[0-9a-fA-F]{6}$/.test(value)) root.style.setProperty(key, value);
    }
    try {
      localStorage.setItem('mos.themeTokens', JSON.stringify(tokens));
    } catch {
      /* ignore */
    }
  };

  const savePrefs = async (patch: Record<string, unknown>) => {
    const result = await mutate('/api/preferences', 'PATCH', patch);
    if (result.ok) {
      setStatus('Saved');
      router.refresh();
      window.setTimeout(() => setStatus(null), 1500);
    }
  };

  const saveTheme = async () => {
    const result = await mutate<{ theme: { id: string } }>('/api/themes', 'POST', {
      name: themeName,
      mode: mode === 'dark' ? 'dark' : 'light',
      tokens: customTokens,
    });
    if (result.ok && !result.queued && result.data) {
      await savePrefs({ themeId: result.data.theme.id });
      setStatus('Theme saved and applied');
      router.refresh();
    }
  };

  return (
    <div className="space-y-5">
      <fieldset>
        <legend className="text-[12px] font-semibold text-ink-2">Theme</legend>
        <div className="mt-2 flex gap-1.5">
          {(
            [
              ['light', 'Light', 'sun'],
              ['dark', 'Dark', 'moon'],
              ['system', 'System', 'monitor'],
            ] as const
          ).map(([value, label, icon]) => (
            <button
              key={value}
              type="button"
              onClick={() => {
                setMode(value);
                void savePrefs({ themeMode: value });
              }}
              aria-pressed={mode === value}
              className={cx(
                'inline-flex min-h-10 flex-1 items-center justify-center gap-1.5 rounded-md border text-[13px] font-medium',
                mode === value ? 'border-brand bg-brand-soft text-brand-strong' : 'border-line text-ink-2 hover:bg-surface-2',
              )}
            >
              <Icon name={icon} size={15} />
              {label}
            </button>
          ))}
        </div>
      </fieldset>

      <fieldset>
        <legend className="text-[12px] font-semibold text-ink-2">Density</legend>
        <div className="mt-2 flex gap-1.5">
          {(['comfortable', 'compact'] as const).map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => {
                setDense(value);
                void savePrefs({ density: value });
              }}
              aria-pressed={dense === value}
              className={cx(
                'min-h-10 flex-1 rounded-md border text-[13px] font-medium capitalize',
                dense === value ? 'border-brand bg-brand-soft text-brand-strong' : 'border-line text-ink-2 hover:bg-surface-2',
              )}
            >
              {value}
            </button>
          ))}
        </div>
      </fieldset>

      <fieldset>
        <legend className="text-[12px] font-semibold text-ink-2">Custom theme</legend>
        <p className="mt-1 text-[11.5px] text-ink-3">
          Changes preview live. Nothing is stored until you save, and the built-in theme is always one click away.
        </p>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          {EDITABLE_TOKENS.map((token) => (
            <label key={token.key} className="flex items-center gap-2 rounded-md border border-line p-2">
              <input
                type="color"
                value={customTokens[token.key] ?? readToken(token.key)}
                onChange={(e) => {
                  const next = { ...customTokens, [token.key]: e.target.value };
                  setCustomTokens(next);
                  applyTokens(next);
                }}
                className="h-9 w-9 cursor-pointer rounded border-0 bg-transparent p-0"
                aria-label={token.label}
              />
              <span className="min-w-0">
                <span className="block text-[12.5px] font-medium text-ink">{token.label}</span>
                <span className="block truncate text-[11px] text-ink-3">{token.hint}</span>
              </span>
            </label>
          ))}
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <label className="text-[12px] text-ink-3">
            Name
            <input
              value={themeName}
              onChange={(e) => setThemeName(e.target.value)}
              className="ml-2 min-h-9 rounded-md border border-line bg-canvas px-2 text-[13px] text-ink"
            />
          </label>
          <Button variant="primary" size="sm" onClick={() => void saveTheme()}>
            Save theme
          </Button>
          <Button
            size="sm"
            onClick={() => {
              setCustomTokens({});
              applyTokens({});
              void savePrefs({ themeId: null });
            }}
          >
            Reset to built-in
          </Button>
          <span className="text-[12px] text-ink-3" role="status">
            {status}
          </span>
        </div>
      </fieldset>

      {themes.length > 0 && (
        <fieldset>
          <legend className="text-[12px] font-semibold text-ink-2">Saved themes</legend>
          <ul className="mt-2 space-y-1.5">
            {themes.map((theme) => (
              <li key={theme.id} className="flex items-center gap-2 rounded-md border border-line px-2.5 py-2">
                <span className="flex gap-1" aria-hidden>
                  {Object.values(theme.tokens)
                    .slice(0, 4)
                    .map((color, i) => (
                      <span key={i} className="h-4 w-4 rounded" style={{ background: color }} />
                    ))}
                </span>
                <span className="min-w-0 flex-1 truncate text-[13px] text-ink">{theme.name}</span>
                <span className="text-[11px] text-ink-3">{theme.mode}</span>
                <Button
                  size="sm"
                  onClick={() => {
                    setCustomTokens(theme.tokens);
                    applyTokens(theme.tokens);
                    setMode(theme.mode === 'dark' ? 'dark' : 'light');
                    void savePrefs({ themeId: theme.id, themeMode: theme.mode });
                  }}
                >
                  Apply
                </Button>
              </li>
            ))}
          </ul>
        </fieldset>
      )}
    </div>
  );
}

function applyMode(mode: 'light' | 'dark' | 'system'): void {
  const dark = mode === 'dark' || (mode === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
  try {
    localStorage.setItem('mos.theme', mode);
  } catch {
    /* storage may be blocked */
  }
}

function readToken(key: string): string {
  if (typeof window === 'undefined') return '#8c1d24';
  const value = getComputedStyle(document.documentElement).getPropertyValue(key).trim();
  return /^#[0-9a-fA-F]{6}$/.test(value) ? value : '#8c1d24';
}

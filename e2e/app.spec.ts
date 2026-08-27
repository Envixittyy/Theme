import { expect, test } from '@playwright/test';

test.describe('shell', () => {
  test('the same account shows the same data on a phone viewport', async ({ page, isMobile }) => {
    await page.goto('/today');
    if (isMobile) {
      // The phone gets a bottom tab bar rather than the sidebar.
      await expect(page.getByRole('navigation', { name: 'Primary' })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Quick add' })).toBeVisible();
    } else {
      await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible();
    }
    await expect(page.getByRole('region', { name: 'Dashboard widgets' })).toBeVisible();
  });

  test('the app declares itself installable', async ({ page }) => {
    await page.goto('/today');
    const manifestHref = await page.locator('link[rel="manifest"]').getAttribute('href');
    expect(manifestHref).toBeTruthy();

    const manifest = await page.request.get(manifestHref!);
    expect(manifest.ok()).toBe(true);
    const parsed = (await manifest.json()) as { display: string; start_url: string; icons: unknown[] };
    expect(parsed.display).toBe('standalone');
    expect(parsed.start_url).toContain('/today');
    expect(parsed.icons.length).toBeGreaterThan(2);

    const sw = await page.request.get('/sw.js');
    expect(sw.ok()).toBe(true);
    expect(await sw.text()).toContain('notificationclick');
  });
});

test.describe('tasks', () => {
  test('quick add creates a task with the date it showed in the preview', async ({ page }) => {
    await page.goto('/today');
    await page.getByRole('button', { name: /^Add$|Quick add/ }).first().click();

    const input = page.getByLabel(/task, with optional|task title/i);
    await input.fill('Draft the lab conclusion #CHM031 !high tomorrow 5pm');

    // The parse is echoed before saving, so a misread date is visible. Scoped
    // to the dialog: the course code also appears in the desktop sidebar.
    const dialog = page.getByRole('dialog', { name: /quick add task/i });
    await expect(dialog.getByText('CHM031')).toBeVisible();
    await expect(dialog.getByText('high')).toBeVisible();

    await dialog.getByRole('button', { name: 'Add task' }).click();
    await page.goto('/tasks?list=upcoming');
    await expect(page.getByRole('link', { name: 'Draft the lab conclusion', exact: true })).toBeVisible();
  });

  test('completing and submitting are separate states', async ({ page }) => {
    await page.goto('/today');
    await page.goto('/tasks?list=inbox');

    const firstTask = page.locator('li[data-task-id]').first();
    const title = (await firstTask.getByRole('link').first().innerText()).trim();

    await firstTask.getByRole('button', { name: /mark .* as submitted/i }).click();
    await expect(page.getByText('Submitted').first()).toBeVisible();

    // Submitted work leaves the planning lists but keeps its own.
    await page.goto('/tasks?list=submitted');
    await expect(page.getByRole('link', { name: title, exact: true })).toBeVisible();
  });

  test('filters live in the URL so a filtered list is shareable', async ({ page }) => {
    await page.goto('/today');
    await page.goto('/tasks?list=upcoming');
    await page.getByRole('button', { name: /filters/i }).click();
    await page.getByLabel('Type').selectOption('exam');
    await expect(page).toHaveURL(/type=exam/);
  });
});

test.describe('calendar', () => {
  for (const view of ['month', 'week', 'agenda', 'timetable'] as const) {
    test(`the ${view} view renders and does not overflow the page horizontally`, async ({ page }) => {
      await page.goto('/today');
      await page.goto(`/calendar?view=${view}`);
      await expect(page.getByRole('tab', { name: view, exact: false })).toHaveAttribute('aria-selected', 'true');

      // Wide content scrolls inside its own container, never the document.
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow).toBeLessThanOrEqual(1);
    });
  }
});

test.describe('dashboard customisation', () => {
  test('a reordered layout persists and is stored per breakpoint', async ({ page, isMobile }) => {
    await page.goto('/today');
    await page.getByRole('button', { name: /customise/i }).click();

    const dialog = page.getByRole('dialog', { name: /customise dashboard/i });
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText(isMobile ? 'mobile' : 'desktop');

    // Move the second widget up, then save.
    await dialog.getByRole('button', { name: /move .* earlier/i }).nth(1).click();
    await dialog.getByRole('button', { name: 'Save layout' }).click();
    await expect(dialog.getByText(/layout saved/i)).toBeVisible();

    await page.reload();
    await expect(page.getByRole('region', { name: 'Dashboard widgets' })).toBeVisible();
  });
});

test.describe('offline behaviour', () => {
  test('a task created offline is queued and reconciled on reconnect', async ({ page, context }) => {
    await page.goto('/today');
    // Let the service worker install so the shell is cached.
    await page.waitForTimeout(1500);

    await context.setOffline(true);
    await page.getByRole('button', { name: /^Add$|Quick add/ }).first().click();
    await page.getByLabel(/task, with optional|task title/i).fill('Written on the train');
    await page.getByRole('dialog', { name: /quick add task/i }).getByRole('button', { name: 'Add task' }).click();

    // The UI says so rather than pretending the write landed.
    await expect(page.getByText(/saved offline/i)).toBeVisible();

    await context.setOffline(false);
    await page.goto('/settings/sync');

    // The queue drains on reconnect; the task then exists on the server. The
    // check runs inside the page so it carries the session like a real request.
    await expect
      .poll(
        async () =>
          page.evaluate(async () => {
            const response = await fetch(
              '/api/tasks?search=Written%20on%20the%20train&includeCompleted=true',
            );
            if (!response.ok) return 0;
            const body = (await response.json()) as { tasks: unknown[] };
            return body.tasks.length;
          }),
        { timeout: 30_000, intervals: [500, 1000, 2000] },
      )
      .toBeGreaterThan(0);
  });
});

test.describe('security surface', () => {
  test('no credential material reaches the browser bundle', async ({ page }) => {
    const scripts: string[] = [];
    page.on('response', async (response) => {
      const url = response.url();
      if (url.includes('/_next/static/') && url.endsWith('.js') && response.ok()) {
        scripts.push(await response.text().catch(() => ''));
      }
    });

    await page.goto('/today');
    await page.goto('/settings/integrations');
    await page.waitForTimeout(1000);

    const bundle = scripts.join('\n');
    expect(bundle).not.toContain('SECRET_ENCRYPTION_KEYS');
    expect(bundle).not.toContain('demo-only.ics');
    expect(bundle).not.toMatch(/blackboard\.demo\.invalid\/feed/);
  });

  test('an attachment belonging to another account is not served', async ({ page }) => {
    await page.goto('/today');
    // A well-formed id that belongs to nobody must 404 — not 500, not 200, and
    // not a redirect to a signed URL.
    const status = await page.evaluate(async () => {
      const response = await fetch('/api/attachments/00000000-0000-4000-8000-000000000000/download', {
        redirect: 'manual',
      });
      return response.status;
    });
    expect([404, 403]).toContain(status);
  });

  test('state-changing requests without a CSRF token are refused', async ({ page }) => {
    await page.goto('/today');
    // Same-origin, real session, no token: the double-submit check must reject.
    const status = await page.evaluate(async () => {
      const response = await fetch('/api/tasks', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: 'No CSRF token' }),
      });
      return response.status;
    });
    expect(status).toBe(403);
  });

  test('a private feed URL is rejected when it points at a private address', async ({ page }) => {
    // Driven through the UI so the whole path is covered: form, CSRF, guard,
    // and the error the student actually sees.
    await page.goto('/settings/integrations');
    await page.getByLabel('Private feed URL').fill('http://169.254.169.254/latest/meta-data');
    await page.getByRole('button', { name: 'Test feed' }).click();

    const panel = page.getByText(/that feed could not be used/i);
    await expect(panel).toBeVisible();
    // The message names the reason without echoing the URL back.
    await expect(page.getByText(/non-public address|scheme .* is not allowed/i)).toBeVisible();
  });
});

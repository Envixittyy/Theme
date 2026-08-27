import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { signIn } from './helpers';

test.describe('sign-in', () => {
  test('a student can sign in with a magic link and land on Today', async ({ page }) => {
    await signIn(page);
    await expect(page.getByRole('heading', { level: 1 })).toContainText(/morning|afternoon|evening|still up/i);
    await expect(page.getByRole('region', { name: 'Dashboard widgets' })).toBeVisible();
  });

  test('an unauthenticated visitor is sent to the sign-in page', async ({ page }) => {
    await page.goto('/today');
    await page.waitForURL(/\/login/);
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  });

  test('the sign-in page has no accessibility violations', async ({ page }) => {
    // Lives here rather than with the other accessibility checks: those run
    // with a stored session, so /login would simply redirect to /today.
    await page.goto('/login');
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();
    expect(
      results.violations.map((v) => `${v.id} (${v.impact ?? 'unknown'})`),
    ).toEqual([]);
  });

  test('a tampered sign-in link is refused', async ({ page }) => {
    await page.goto('/auth/verify?token=not-a-real-token');
    await page.waitForURL(/\/login\?error=invalid/);
    // Next renders its own route announcer with role="alert"; target ours.
    await expect(page.getByRole('alert').first()).toContainText(/not valid/i);
  });
});

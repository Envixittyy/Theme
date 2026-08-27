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

  test('a tampered sign-in link is refused', async ({ page }) => {
    await page.goto('/auth/verify?token=not-a-real-token');
    await page.waitForURL(/\/login\?error=invalid/);
    // Next renders its own route announcer with role="alert"; target ours.
    await expect(page.getByRole('alert').first()).toContainText(/not valid/i);
  });
});

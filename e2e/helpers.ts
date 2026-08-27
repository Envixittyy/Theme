import { readFile, rm } from 'node:fs/promises';
import type { Page } from '@playwright/test';
import { MAIL_FILE } from './global-setup';

export const DEMO_EMAIL = 'e2e@school.local';

/** Signs in through the real magic-link flow, reading the mail catcher. */
export async function signIn(page: Page, email = DEMO_EMAIL): Promise<void> {
  await rm(MAIL_FILE, { force: true });
  await page.goto('/login');
  await page.getByLabel('School email').fill(email);
  await page.getByRole('button', { name: /email me a sign-in link/i }).click();

  let link: string | null = null;
  for (let attempt = 0; attempt < 40 && !link; attempt += 1) {
    try {
      link = (await readFile(MAIL_FILE, 'utf8')).trim();
    } catch {
      await page.waitForTimeout(250);
    }
  }
  if (!link) throw new Error('no sign-in link arrived at the mail catcher');
  await page.goto(link);
  await page.waitForURL(/\/today/);
}

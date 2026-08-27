import { test as setup } from '@playwright/test';
import { signIn } from './helpers';

export const STORAGE_STATE = 'e2e/.auth/user.json';

/**
 * Signs in once and saves the session for every other spec.
 *
 * Signing in per test would trip the magic-link rate limiter — which is the
 * limiter working correctly, so the harness adapts rather than the product.
 */
setup('authenticate', async ({ page }) => {
  await signIn(page);
  await page.context().storageState({ path: STORAGE_STATE });
});

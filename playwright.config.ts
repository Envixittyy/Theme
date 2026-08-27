import { defineConfig, devices } from '@playwright/test';

const PORT = Number(process.env.E2E_PORT ?? 3100);
const BASE_URL = `http://127.0.0.1:${PORT}`;

/**
 * End-to-end configuration.
 *
 * The app is started for real (built output, not dev) against an isolated
 * PGlite directory, with the mail transport pointed at a catcher the tests run
 * themselves — so sign-in goes through the genuine magic-link flow rather than
 * a test-only back door.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : [['list']],
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    // The container ships one Chromium build; pin it rather than downloading.
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_PATH
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH }
      : {},
  },
  projects: [
    // Signs in once; the rest reuse the session. Repeated sign-ins would hit
    // the magic-link rate limiter, which is the limiter behaving correctly.
    { name: 'setup', testMatch: /auth\.setup\.ts/ },
    {
      name: 'desktop',
      dependencies: ['setup'],
      // The sign-in flow needs a clean context, so it runs in its own project.
      testIgnore: /sign-in\.spec\.ts/,
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1400, height: 900 },
        storageState: 'e2e/.auth/user.json',
      },
    },
    {
      name: 'mobile',
      dependencies: ['setup'],
      testIgnore: /sign-in\.spec\.ts/,
      use: { ...devices['Pixel 7'], storageState: 'e2e/.auth/user.json' },
    },
    // The sign-in flow itself needs a clean context, so it opts out.
    { name: 'signin', testMatch: /sign-in\.spec\.ts/, use: { ...devices['Desktop Chrome'] } },
  ],
  globalSetup: './e2e/global-setup.ts',
  webServer: {
    command: `npx next start -p ${PORT}`,
    url: `${BASE_URL}/login`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      DATABASE_URL: '',
      PGLITE_DATA_DIR: '.data/e2e',
      APP_URL: BASE_URL,
      MAIL_WEBHOOK_URL: 'http://127.0.0.1:4599/mail',
      SECRET_ENCRYPTION_KEYS: `e2e:${Buffer.alloc(32, 9).toString('base64')}`,
      SECRET_ENCRYPTION_ACTIVE_KEY_ID: 'e2e',
    },
  },
});

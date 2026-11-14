import { existsSync } from 'node:fs';
import { defineConfig, devices } from '@playwright/test';

// The preinstalled Chromium build differs from this Playwright's default; use it when present.
const PREINSTALLED_CHROME = '/opt/pw-browsers/chromium-1243/chrome-linux64/chrome';
const CHROME_PATH =
  process.env.PW_CHROMIUM_PATH ?? (existsSync(PREINSTALLED_CHROME) ? PREINSTALLED_CHROME : undefined);

const PORT = 4300;

export default defineConfig({
  testDir: 'e2e',
  testMatch: '**/*.spec.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: 'list',
  use: { baseURL: `http://localhost:${PORT}` },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: CHROME_PATH ? { executablePath: CHROME_PATH } : {},
      },
    },
  ],
  webServer: {
    command: `npx ng serve --configuration e2e --port ${PORT}`,
    port: PORT,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});

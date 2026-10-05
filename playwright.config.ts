import { existsSync } from 'node:fs';
import { defineConfig, devices } from '@playwright/test';

/**
 * E2E : chaque page en mobile (390×844) et desktop (1280×800), Chromium.
 * Le Chromium de la machine (PLAYWRIGHT_BROWSERS_PATH) est utilisé tel quel :
 * ne pas lancer « playwright install ». Si sa révision ne correspond pas à
 * @playwright/test, CHROMIUM_PATH permet de pointer un binaire précis.
 */
const fallbackChromium = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const executablePath = process.env['CHROMIUM_PATH'] ?? (existsSync(fallbackChromium) && !process.env['PLAYWRIGHT_BROWSERS_PATH'] ? fallbackChromium : undefined);
const launchOptions = executablePath ? { executablePath } : {};

export default defineConfig({
  testDir: './e2e',
  outputDir: './test-results',
  fullyParallel: true,
  forbidOnly: Boolean(process.env['CI']),
  retries: 0,
  workers: process.env['CI'] ? 2 : 4,
  timeout: 30_000,
  expect: { timeout: 5_000 },
  reporter: [['list'], ['json', { outputFile: 'test-results/results.json' }]],
  use: {
    baseURL: 'http://localhost:4174',
    locale: 'fr-FR',
    timezoneId: 'Europe/Paris',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'mobile-390',
      use: { ...devices['Pixel 7'], viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, launchOptions },
    },
    {
      name: 'desktop-1280',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 }, launchOptions },
    },
  ],
  webServer: {
    command: 'node scripts/e2e-server.mjs',
    url: 'http://localhost:4175/',
    reuseExistingServer: !process.env['CI'],
    timeout: 180_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
});

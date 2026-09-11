import { chromium } from 'playwright';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/* Playwright pins an exact chromium build per release, and `npx playwright
   install` needs network access a sandboxed run may not have. When the pinned
   build is missing but another one is on disk, use that instead of failing —
   any recent chromium runs these checks fine.

   Also centralises the login helper, because every script signs in the same way
   and they were each carrying their own copy of the PIN sequence. */

function installedChromium() {
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH
    ?? join(process.env.LOCALAPPDATA ?? process.env.HOME ?? '', 'ms-playwright');
  if (!existsSync(root)) return undefined;

  // Prefer the headless shell (smaller, faster); fall back to full chromium.
  const candidates = [];
  for (const dir of readdirSync(root)) {
    if (dir.startsWith('chromium_headless_shell-')) {
      candidates.unshift(join(root, dir, 'chrome-headless-shell-win64', 'chrome-headless-shell.exe'));
    } else if (dir.startsWith('chromium-')) {
      candidates.push(
        join(root, dir, 'chrome-win64', 'chrome.exe'),
        join(root, dir, 'chrome-win', 'chrome.exe'),
      );
    }
  }
  return candidates.find(existsSync);
}

/** Launch chromium, tolerating a version-pin mismatch against what is installed. */
export async function launch(options = {}) {
  try {
    return await chromium.launch(options);
  } catch (err) {
    const executablePath = installedChromium();
    if (!executablePath) throw err;
    console.log(`(using installed chromium: ${executablePath})`);
    return chromium.launch({ ...options, executablePath });
  }
}

/** Sign in as the owner.

    Waits for the login screen by role rather than a fixed timeout: a first run
    seeds 28 products and ~90 days of history, which takes several seconds, and
    a hard-coded wait makes these scripts flaky on a cold database.

    Matches /Owner/ rather than the full name so an install seeded before the
    Thangai→Thanjai rename still signs in. */
export async function loginAsOwner(page, { pin = '1234', baseUrl = 'http://localhost:5173' } = {}) {
  await page.goto(`${baseUrl}/`);
  await page.waitForSelector('text=Who is on the counter?', { timeout: 90_000 });
  await page.locator('button', { hasText: /Owner/i }).first().click();
  await page.waitForTimeout(300);
  for (const digit of pin.split('')) {
    await page.getByRole('button', { name: digit, exact: true }).click();
    await page.waitForTimeout(80);
  }
  // The till lands on the dashboard; wait for the shell rather than a timeout.
  await page.waitForSelector('nav, aside', { timeout: 30_000 });
  await page.waitForTimeout(1200);
}

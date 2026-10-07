import assert from 'node:assert/strict';
import { existsSync, mkdirSync } from 'node:fs';
import { chromium, devices } from '@playwright/test';

const origin = process.argv[2];
if (!origin || !/^https:\/\//.test(origin)) throw new Error('Usage: node --use-env-proxy scripts/check-remote-browser.mjs https://HOST [screenshot-directory]');
const output = process.argv[3];
if (output) mkdirSync(output, { recursive: true });
const feedResponse = await fetch(new URL('/_api/feed', origin));
assert.equal(feedResponse.status, 200);
const feed = await feedResponse.json();
const thread = feed.threads?.[0];
const proxyServer = process.env.PLAYWRIGHT_PROXY_SERVER ?? process.env.HTTPS_PROXY ?? process.env.HTTP_PROXY;
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ?? (existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined);
const browser = await chromium.launch({ executablePath, ...(proxyServer ? { proxy: { server: proxyServer } } : {}) });
try {
  for (const [name, device] of [['desktop', { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 1000 } }], ['iphone', devices['iPhone 13']]]) {
    const context = await browser.newContext({ ...device, baseURL: origin });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    async function visibleHeading(text) {
      await page.getByRole('heading', { level: 1 }).filter({ hasText: text }).waitFor();
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `${name}: horizontal overflow`);
    }
    await page.goto('/');
    await visibleHeading('Independent agents');
    await page.evaluate(() => document.fonts.ready);
    assert.equal(await page.locator('body').evaluate(element => getComputedStyle(element).backgroundColor), 'rgb(10, 11, 12)');
    assert.match(await page.locator('h1').evaluate(element => getComputedStyle(element).fontFamily), /Newsreader Variable/);
    if (output) await page.screenshot({ path: `${output}/${name}-home.png`, fullPage: true });
    await page.getByRole('link', { name: 'Commons An open room' }).click();
    await page.waitForURL('**/boards/commons');
    await visibleHeading('Commons');
    if (thread) {
      await page.goto(`/threads/${encodeURIComponent(thread.id)}`);
      await visibleHeading(thread.title);
      await page.getByText(thread.body, { exact: false }).first().waitFor();
      if (output) await page.screenshot({ path: `${output}/${name}-thread.png`, fullPage: true });
      if (thread.tags?.[0]) {
        await page.getByRole('link', { name: thread.tags[0], exact: true }).click();
        await page.waitForURL('**/tags/**');
        await visibleHeading(`#${thread.tags[0]}`);
      }
      await page.goto(`/agents/${encodeURIComponent(thread.handle)}`);
      await visibleHeading(`@${thread.handle}`);
    }
    const query = thread?.title ?? 'assembly';
    await page.getByRole('textbox', { name: 'Search The Assembly' }).fill(query);
    await page.getByRole('textbox', { name: 'Search The Assembly' }).press('Enter');
    await page.waitForURL('**/search?q=*');
    if (thread) await page.getByRole('link', { name: thread.title, exact: true }).first().waitFor();
    else await page.getByRole('heading', { level: 1 }).waitFor();
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
    const manifestResponse = await fetch(new URL('/manifest.webmanifest', origin));
    assert.equal(manifestResponse.status, 200);
    const manifest = await manifestResponse.json();
    assert.equal(manifest.display, 'standalone');
    for (const icon of manifest.icons) assert.equal((await fetch(new URL(icon.src, origin))).status, 200);
    assert.match(await page.locator('meta[name="viewport"]').getAttribute('content'), /viewport-fit=cover/);
    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));
    assert.deepEqual(await page.evaluate(async () => {
      const keys = await caches.keys();
      return (await Promise.all(keys.map(async key => (await (await caches.open(key)).keys()).map(request => new URL(request.url).pathname)))).flat();
    }), ['/offline.html']);
    assert.deepEqual(errors, [], `${name}: browser errors`);
    await context.close();
    console.log(`${name}: live navigation, typography, layout, search, PWA and browser errors passed.`);
  }
} finally { await browser.close(); }

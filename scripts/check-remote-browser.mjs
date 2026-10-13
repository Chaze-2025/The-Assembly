import assert from 'node:assert/strict';
import { existsSync, mkdirSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium, devices, expect } from '@playwright/test';

const usage = 'Usage: node --use-env-proxy scripts/check-remote-browser.mjs https://HOST [screenshot-directory]';
let target;
try { target = new URL(process.argv[2]); } catch { throw new Error(usage); }
if (target.protocol !== 'https:' || target.username || target.password || target.pathname !== '/' || target.search || target.hash) throw new Error(usage);
const origin = target.origin;
const output = process.argv[3];
if (output) mkdirSync(output, { recursive: true });
async function read(path) {
  const url = new URL(path, origin);
  assert.equal(url.origin, origin, 'Only this Assembly origin is read by verification.');
  for (let attempt = 0; attempt < 3; attempt++) {
    const response = await fetch(url, { signal: AbortSignal.timeout(45000), redirect: 'error' });
    if (response.status === 429 && attempt < 2) {
      const seconds = Number(response.headers.get('Retry-After'));
      assert.ok(Number.isFinite(seconds) && seconds > 0 && seconds <= 60, 'Invalid Retry-After.');
      await response.arrayBuffer();
      console.log(`Read limit encountered; respecting Retry-After (${seconds}s).`);
      await delay(seconds * 1000 + 100);
      continue;
    }
    assert.equal(response.status, 200, `${url.pathname}: public read failed`);
    return response.json();
  }
  throw new Error('Public read retry budget exhausted.');
}
// These are existing public records. This script never registers an agent or performs a write.
const feed = await read('/_api/feed');
const boards = (await read('/_api/boards')).boards;
const board = boards.find(item => item.slug === 'commons') ?? boards[0];
assert.ok(board, 'The board directory must exist.');
const thread = feed.threads?.[0];
const projects = await read('/_api/projects?limit=1');
const research = await read('/_api/research?limit=1');
const project = projects.items[0], entry = research.items[0];
const manifest = await read('/manifest.webmanifest');
assert.equal(manifest.display, 'standalone'); assert.equal(manifest.start_url, '/');
assert.equal(manifest.scope, '/');
for (const icon of manifest.icons) {
  const url = new URL(icon.src, origin); assert.equal(url.origin, origin);
  assert.equal((await fetch(url, { signal: AbortSignal.timeout(45000) })).status, 200);
}
const proxyServer = process.env.PLAYWRIGHT_PROXY_SERVER ?? process.env.HTTPS_PROXY ?? process.env.HTTP_PROXY;
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ?? (existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined);
const browser = await chromium.launch({ executablePath, ...(proxyServer ? { proxy: { server: proxyServer } } : {}) });
try {
  const layouts = [
    ['desktop', { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 1000 } }],
    ['iphone-390', devices['iPhone 13']],
    ['iphone-320', { ...devices['iPhone 13'], viewport: { width: 320, height: 740 } }],
  ];
  for (const [name, device] of layouts) {
    const context = await browser.newContext({ ...device, baseURL: origin });
    context.setDefaultTimeout(20000);
    const page = await context.newPage();
    page.setDefaultNavigationTimeout(45000);
    const errors = [];
    let collectErrors = true;
    page.on('pageerror', error => { if (collectErrors) errors.push(error.message); });
    page.on('console', message => { if (collectErrors && message.type() === 'error') errors.push(message.text()); });
    async function layout() {
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), `${name}: horizontal overflow at ${new URL(page.url()).pathname}`);
    }
    async function ready(heading) {
      // The public HTML contains a fallback heading; require the hydrated React main as well.
      await expect(page.locator('main#main-content')).toBeVisible();
      await expect(page.locator('main#main-content').getByRole('heading', { level: 1 })).toContainText(heading);
      await page.waitForFunction(() => !Array.from(document.querySelectorAll('main [role="status"]')).some(element => /^(Loading|Searching|Opening|Retrieving|Finding)/i.test(element.textContent?.trim() ?? '')));
      await expect(page.locator('main').getByRole('alert')).toHaveCount(0);
      await expect(page).toHaveTitle(/The Assembly/);
      await layout();
      const path = new URL(page.url()).pathname;
      await expect(page.locator('link[rel="canonical"]')).toHaveCount(1);
      await page.waitForFunction(() => {
        const link = document.querySelector('link[rel="canonical"]');
        return link instanceof HTMLLinkElement && new URL(link.href).pathname === window.location.pathname;
      });
      const canonical = new URL(await page.locator('link[rel="canonical"]').getAttribute('href'));
      assert.equal(canonical.origin, origin); assert.equal(canonical.pathname, path);
      await expect(page.locator('meta[property="og:url"]')).toHaveAttribute('content', canonical.href);
      assert.ok((await page.locator('meta[name="description"]').getAttribute('content'))?.length > 0);
    }
    async function navigate(label, path, heading) {
      const open = page.getByRole('button', { name: 'Open navigation', exact: true });
      const isMobileMenu = await open.isVisible();
      if (isMobileMenu) await open.click();
      const navigation = page.getByRole('navigation', { name: 'Primary navigation', exact: true });
      await expect(navigation).toBeVisible();
      await navigation.getByRole('link', { name: label, exact: true }).click();
      await page.waitForURL(url => url.pathname === path);
      await ready(heading);
      if (isMobileMenu) await expect(page.getByRole('button', { name: 'Open navigation', exact: true })).toHaveAttribute('aria-expanded', 'false');
      else await expect(navigation.getByRole('link', { name: label, exact: true })).toHaveAttribute('aria-current', 'page');
    }
    await page.goto('/');
    await ready('Independent minds.');
    await page.evaluate(() => document.fonts.ready);
    assert.equal(await page.locator('body').evaluate(element => getComputedStyle(element).backgroundColor), 'rgb(10, 11, 12)');
    assert.match(await page.locator('main h1').evaluate(element => getComputedStyle(element).fontFamily), /Newsreader/);
    const menu = page.getByRole('button', { name: 'Open navigation', exact: true });
    if (await menu.isVisible()) {
      await menu.click();
      await expect(page.getByRole('navigation', { name: 'Primary navigation', exact: true })).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(menu).toBeFocused();
      await expect(menu).toHaveAttribute('aria-expanded', 'false');
    }
    if (output) await page.screenshot({ path: `${output}/${name}-home.png`, fullPage: true });
    await navigate('Discussions', '/discussions', 'Discussions');
    await page.getByRole('navigation', { name: 'Sort discussions' }).getByRole('link', { name: 'Awaiting replies', exact: true }).click();
    await page.waitForURL(url => url.searchParams.get('sort') === 'unanswered');
    await ready('Discussions');
    await page.getByRole('navigation', { name: 'Sort discussions' }).getByRole('link', { name: 'Latest', exact: true }).click();
    await page.waitForURL(url => !url.searchParams.has('sort'));
    await ready('Discussions');
    await navigate('Boards', '/boards', 'Find your subject.');
    await page.locator(`main a[href="/boards/${encodeURIComponent(board.slug)}"]`).first().click();
    await page.waitForURL(url => url.pathname === `/boards/${board.slug}`);
    await ready(board.name);
    await navigate('Agents', '/agents', 'Independent voices.');
    await navigate('Projects', '/projects', 'Projects');
    if (output) await page.screenshot({ path: `${output}/${name}-projects.png`, fullPage: true });
    if (project) {
      await page.goto(`/projects/${encodeURIComponent(project.id)}`);
      await ready(project.title);
      await expect(page.getByRole('link', { name: 'Project context', exact: true })).toHaveAttribute('href', `/_api/project/context?projectId=${encodeURIComponent(project.id)}`);
      for (const tab of ['tasks', 'research', 'discussions', 'activity']) {
        await page.getByRole('navigation', { name: 'Project sections' }).getByRole('link', { name: new RegExp(`^${tab}`, 'i') }).click();
        await page.waitForURL(url => url.searchParams.get('tab') === tab);
        await ready(project.title);
      }
    }
    await navigate('Research library', '/research', 'Research library');
    if (entry) {
      await page.goto(`/research?entry=${encodeURIComponent(entry.id)}`);
      await ready(entry.title);
      const canonical = new URL(await page.locator('link[rel="canonical"]').getAttribute('href'));
      assert.equal(canonical.searchParams.get('entry'), entry.id);
      for (const link of await page.locator('main a[target="_blank"]').all()) {
        const rel = await link.getAttribute('rel');
        assert.match(rel ?? '', /noopener/); assert.match(rel ?? '', /noreferrer/);
      }
    }
    await navigate('Agent tools', '/tools', 'Tools for thoughtful work.');
    await page.getByRole('navigation', { name: 'Connection protocol' }).getByRole('link', { name: 'REST API', exact: true }).click();
    await page.waitForURL(url => url.searchParams.get('protocol') === 'rest');
    await ready('Tools for thoughtful work.');
    await expect(page.getByRole('heading', { name: 'Explore before you register', exact: true })).toBeVisible();
    await page.getByRole('navigation', { name: 'Connection protocol' }).getByRole('link', { name: 'MCP connection', exact: true }).click();
    await page.waitForURL(url => url.searchParams.get('protocol') === 'mcp');
    await ready('Tools for thoughtful work.');
    if (output) await page.screenshot({ path: `${output}/${name}-tools.png`, fullPage: true });
    if (thread) {
      await page.goto(`/threads/${encodeURIComponent(thread.id)}`);
      await ready(thread.title);
      await expect(page.locator('main').getByRole('link', { name: `@${thread.handle}`, exact: true }).first()).toBeVisible();
      await expect(page.getByRole('heading', { name: /The conversation/ })).toBeVisible();
      const replyView = page.getByLabel('Reply view', { exact: true });
      await replyView.selectOption('chronological'); await layout();
      await replyView.selectOption('threaded'); await layout();
      if (output) await page.screenshot({ path: `${output}/${name}-thread.png`, fullPage: true });
      if (thread.tags?.[0]) {
        await page.getByRole('link', { name: `#${thread.tags[0]}`, exact: true }).click();
        await page.waitForURL('**/tags/**');
        await ready(`#${thread.tags[0]}`);
      }
      await page.goto(`/agents/${encodeURIComponent(thread.handle)}`);
      await ready(`@${thread.handle}`);
    }
    const query = thread?.title ?? 'assembly';
    await page.getByLabel('Search The Assembly', { exact: true }).fill(query);
    await page.getByLabel('Search The Assembly', { exact: true }).press('Enter');
    await page.waitForURL('**/search?q=*');
    await ready('Results for');
    if (thread) await expect(page.locator('main').getByRole('link', { name: thread.title, exact: true }).first()).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Search result type' })).toBeVisible();
    await page.getByRole('navigation', { name: 'Search result type' }).getByRole('link', { name: /^Projects/ }).click();
    await page.waitForURL(url => url.searchParams.get('type') === 'projects');
    await ready('Results for');
    assert.match(await page.locator('meta[name="viewport"]').getAttribute('content'), /viewport-fit=cover/);
    await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveAttribute('href', '/icons/apple-touch-icon.png');
    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));
    assert.deepEqual(await page.evaluate(async () => {
      const keys = await caches.keys();
      return (await Promise.all(keys.map(async key => (await (await caches.open(key)).keys()).map(request => new URL(request.url).pathname)))).flat();
    }), ['/offline.html']);
    assert.deepEqual(errors, [], `${name}: browser errors`);
    collectErrors = false; // Offline network failures are expected only after the explicit transition below.
    await context.setOffline(true);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.getByText('You are currently offline.', { exact: false })).toBeVisible();
    await context.setOffline(false);
    await context.close();
    console.log(`${name}: navigation, directories, ${project ? 'project sections' : 'empty project state'}, ${entry ? 'research entry' : 'research directory'}, tools, ${thread ? 'existing discussion' : 'empty discourse state'}, search, metadata, layout and PWA offline checks passed.`);
  }
} finally { await browser.close(); }
console.log('Remote browser verification passed in Chromium desktop and iPhone emulation (390px and 320px). No agent writes were performed.');

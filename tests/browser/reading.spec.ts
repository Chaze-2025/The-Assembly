import { test, expect, ready, noOverflow, navigate } from "./fixtures";

test("organized navigation, keyboard access, public routes and mobile layout", async ({ page }, testInfo) => {
  await page.goto("/");
  await ready(page, /Independent minds\.\s*Shared progress\./);
  await page.evaluate(() => document.fonts.ready);
  expect(await page.locator("body").evaluate(element => getComputedStyle(element).backgroundColor)).toBe("rgb(10, 11, 12)");
  expect(await page.locator("h1").evaluate(element => getComputedStyle(element).fontFamily)).toContain("Newsreader Variable");
  await noOverflow(page);
  const skip = page.getByRole("link", { name: "Skip to main content" });
  await skip.focus(); await expect(skip).toBeVisible(); await page.keyboard.press("Enter");
  await expect(page.locator("main#main-content")).toBeFocused();

  const open = page.getByRole("button", { name: "Open navigation", exact: true });
  if (await open.isVisible()) {
    await expect(open).toHaveAttribute("aria-expanded", "false");
    await open.click();
    await expect(page.getByRole("navigation", { name: "Primary navigation" })).toBeVisible();
    await page.keyboard.press("Escape"); await expect(open).toBeFocused();
    await expect(open).toHaveAttribute("aria-expanded", "false");
  }
  await page.screenshot({ path: testInfo.outputPath("home.png"), fullPage: true });
  for (const [label, heading, path] of [
    ["Boards", "Find your subject.", "/boards"], ["Agents", "Independent voices.", "/agents"],
    ["Discussions", "Discussions", "/discussions"], ["Projects", "Projects", "/projects"],
    ["Research library", "Research library", "/research"], ["Agent tools", "Tools for thoughtful work.", "/tools"],
  ]) {
    await navigate(page, label); await ready(page, heading);
    await expect(page).toHaveURL(new RegExp(`${path}$`));
    await expect(page.locator('nav[aria-label="Primary navigation"] a[aria-current="page"]')).toHaveText(label);
    await noOverflow(page);
    if (await open.isVisible()) await expect(open).toHaveAttribute("aria-expanded", "false");
  }
  await navigate(page, "Boards");
  await page.locator('main a[href="/boards/commons"]').click();
  await ready(page, "Commons");
  await page.getByRole("link", { name: "What makes a conversation worth preserving?", exact: true }).click();
  await ready(page, "What makes a conversation worth preserving?");
  await page.getByRole("link", { name: "#protocol", exact: true }).click();
  await ready(page, "#protocol");
  await page.goto("/agents/assembly-demo"); await ready(page, "@assembly-demo");
  await page.goto("/does-not-exist"); await ready(page, "Record not found");
});

test("global search preserves the query and filters real discussions and projects", async ({ page }) => {
  await page.goto("/"); await ready(page);
  const search = page.getByRole("searchbox", { name: "Search The Assembly", exact: true });
  await search.fill("preserving"); await page.getByRole("button", { name: "Submit search" }).click();
  await ready(page, "Results for “preserving”");
  await expect(page).toHaveURL(/\/search\?q=preserving$/); await expect(search).toHaveValue("preserving");
  await expect(page.getByRole("link", { name: "What makes a conversation worth preserving?", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Preserving useful machine research", exact: true })).toBeVisible();
  await page.getByRole("navigation", { name: "Search result type" }).getByRole("link", { name: /^Projects/ }).click();
  await expect(page).toHaveURL(/q=preserving&type=projects/);
  await expect(page.getByRole("link", { name: "What makes a conversation worth preserving?", exact: true })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Preserving useful machine research", exact: true })).toBeVisible();
  await page.reload(); await ready(page); await expect(search).toHaveValue("preserving");
  await page.goBack();
  await expect(page.getByRole("link", { name: "What makes a conversation worth preserving?", exact: true })).toBeVisible();
  await search.fill("no-such-record-987654321"); await search.press("Enter");
  await expect(page.getByRole("heading", { name: "No matching records." })).toBeVisible();
  await noOverflow(page);
});

test("deep conversations remain readable with bounded loading, collapse and durable reply links", async ({ page }, testInfo) => {
  const replyRequests: string[] = [];
  page.on("request", request => { if (new URL(request.url()).pathname === "/_api/thread/replies") replyRequests.push(request.url()); });
  await page.goto("/threads/thr_demo_observatory");
  await ready(page, "What makes a conversation worth preserving?");
  const replies = page.locator('#replies article[id^="reply-"]');
  await expect(replies).toHaveCount(50);
  await expect(page.getByText("50 of 62 replies loaded", { exact: true })).toBeVisible();
  const root = page.locator("#reply-rep_demo_root");
  await root.getByRole("button", { name: "Collapse replies", exact: true }).click();
  await expect(replies).toHaveCount(1);
  await root.getByRole("button", { name: "Show replies", exact: true }).click();
  await expect(replies).toHaveCount(50);
  await page.getByRole("combobox", { name: "Reply view" }).selectOption("chronological");
  await expect(page.getByRole("button", { name: "Collapse replies", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Load more replies", exact: true }).click();
  await expect(replies).toHaveCount(62);
  const ids = await replies.evaluateAll(elements => elements.map(element => element.id));
  expect(new Set(ids).size).toBe(62);
  await expect(page.getByRole("button", { name: "Load more replies", exact: true })).toHaveCount(0);
  expect(replyRequests.every(url => Number(new URL(url).searchParams.get("limit")) <= 50)).toBe(true);
  await page.getByRole("combobox", { name: "Reply view" }).selectOption("threaded");
  if (testInfo.project.name === "iphone") await page.setViewportSize({ width: 320, height: 760 });
  await noOverflow(page);
  const deepest = await page.locator("#reply-rep_demo_deep_060").boundingBox();
  expect(deepest!.width).toBeGreaterThan(180);

  await page.goto("/threads/thr_demo_observatory#reply-rep_demo_deep_055");
  await ready(page);
  const linked = page.locator("#reply-rep_demo_deep_055");
  await expect(linked).toBeVisible(); await expect(linked).toBeFocused();
  await expect(replies).toHaveCount(6);
  expect(replyRequests.some(url => new URL(url).searchParams.get("replyId") === "rep_demo_deep_055")).toBe(true);
  await page.getByRole("link", { name: "Show the conversation from the beginning" }).click();
  await expect(page).toHaveURL(/#replies$/);
  // Returning to the normal view preserves the two pages already loaded in this session.
  await expect(replies).toHaveCount(62);
  await expect(root).toBeVisible(); await noOverflow(page);
});

test("page metadata follows client navigation without duplicate head tags", async ({ page }) => {
  await page.goto("/"); await ready(page);
  await expect(page.locator("head title")).toHaveCount(1);
  await expect(page.locator('head meta[name="description"]')).toHaveCount(1);
  await expect(page.locator('head link[rel="canonical"]')).toHaveCount(1);
  await navigate(page, "Discussions"); await ready(page, "Discussions");
  await expect(page.locator("head title")).toHaveCount(1);
  await expect(page).toHaveTitle(/Discussions/);
  await expect(page.locator('head meta[name="description"]')).toHaveCount(1);
  await expect(page.locator('head link[rel="canonical"]')).toHaveAttribute("href", "http://localhost:4173/discussions");
  await expect(page.locator('head meta[property="og:title"]')).toHaveAttribute("content", /Discussions/);
  await expect(page.locator('script[type="application/ld+json"]')).toHaveCount(0);
  for (const [path, title] of [
    ["/projects/prj_demo_research", "Preserving useful machine research"],
    ["/research?entry=res_demo_source", "Source: a reproducible public record"],
  ]) {
    await page.goto(path); await ready(page, title);
    await expect(page.locator("head title")).toHaveCount(1);
    await expect(page).toHaveTitle(new RegExp(title));
    await expect(page.locator('head meta[name="description"]')).toHaveCount(1);
  }
});

test("PWA metadata, icons, and explicit offline behavior", async ({ page }) => {
  await page.goto("/"); await ready(page);
  const manifest = await (await page.request.get("/manifest.webmanifest")).json();
  expect(manifest.display).toBe("standalone"); expect(manifest.start_url).toBe("/");
  for (const icon of manifest.icons) expect((await page.request.get(icon.src)).status()).toBe(200);
  await expect(page.locator('meta[name="viewport"]')).toHaveAttribute("content", /viewport-fit=cover/);
  await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveAttribute("href", "/icons/apple-touch-icon.png");
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));
  const cached = await page.evaluate(async () => {
    const keys = await caches.keys();
    return (await Promise.all(keys.map(async key => (await (await caches.open(key)).keys()).map(request => new URL(request.url).pathname)))).flat();
  });
  expect(cached).toEqual(["/offline.html"]);
  await page.context().setOffline(true); await page.reload();
  await expect(page.getByText("You are currently offline.", { exact: false })).toBeVisible();
  await page.context().setOffline(false);
});

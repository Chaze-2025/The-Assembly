import { test, expect } from "@playwright/test";

test("public reading flow, search, all routes and mobile layout", async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Independent agents");
  await expect(page.getByRole("link", { name: "Commons An open room" })).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  expect(await page.locator("body").evaluate(element => getComputedStyle(element).backgroundColor)).toBe("rgb(10, 11, 12)");
  expect(await page.locator("h1").evaluate(element => getComputedStyle(element).fontFamily)).toContain("Newsreader Variable");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: `docs/screenshots/${testInfo.project.name}-home.png`, fullPage: true });
  await page.getByRole("link", { name: "Commons An open room" }).click();
  await expect(page).toHaveURL(/\/boards\/commons$/);
  await page.getByRole("link", { name: "What makes a conversation worth preserving?" }).click();
  await expect(page).toHaveURL(/\/threads\/thr_demo_observatory$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("What makes a conversation worth preserving?");
  await expect(page.getByText("Local nested fixture:", { exact: false })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: `docs/screenshots/${testInfo.project.name}-thread.png`, fullPage: true });
  await page.getByRole("link", { name: "protocol", exact: true }).click();
  await expect(page).toHaveURL(/\/tags\/protocol$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("#protocol");
  await page.goto("/agents/assembly-demo");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("@assembly-demo");
  await page.getByRole("textbox", { name: "Search The Assembly" }).fill("preserving");
  await page.getByRole("textbox", { name: "Search The Assembly" }).press("Enter");
  await expect(page).toHaveURL(/\/search\?q=preserving$/);
  await expect(page.getByRole("link", { name: "What makes a conversation worth preserving?" })).toBeVisible();
  await page.goto("/does-not-exist");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Record not found");
  expect(errors).toEqual([]);
});

test("PWA metadata, icons, and explicit offline behavior", async ({ page }) => {
  await page.goto("/");
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
  await page.context().setOffline(true);
  await page.reload();
  await expect(page.getByText("You are currently offline.", { exact: false })).toBeVisible();
  await page.context().setOffline(false);
});

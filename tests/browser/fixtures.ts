import { test as base, expect, type Page } from "@playwright/test";

export const test = base.extend<{ healthyBrowser: void }>({
  healthyBrowser: [async ({ page, context }, use, testInfo) => {
    // Each local scenario represents an independent visitor; the real API quotas stay enabled.
    const identity = [...`${testInfo.project.name}:${testInfo.title}`].reduce((sum, character) => (sum * 31 + character.charCodeAt(0)) >>> 0, 0);
    await context.setExtraHTTPHeaders({ "cf-connecting-ip": `198.51.${1 + identity % 250}.${1 + (identity >>> 8) % 250}` });
    const failures: string[] = [];
    page.on("pageerror", error => failures.push(error.message));
    page.on("response", response => {
      if (new URL(response.url()).pathname.startsWith("/_api/") && response.status() >= 400) failures.push(`${response.status()} ${response.url()}`);
    });
    await use();
    expect(failures, "Interactive UI must not hide JavaScript or API failures").toEqual([]);
  }, { auto: true }],
});

export { expect };

export async function ready(page: Page, heading?: string | RegExp) {
  // Discovery HTML has headings too. This marker proves the actual React UI mounted.
  await expect(page.locator("main#main-content")).toBeVisible();
  if (heading) await expect(page.getByRole("heading", { level: 1 })).toHaveText(heading);
}

export async function noOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), "The page must fit the viewport").toBe(true);
}

export async function navigate(page: Page, label: string) {
  const menu = page.getByRole("button", { name: "Open navigation", exact: true });
  if (await menu.isVisible()) await menu.click();
  await page.getByRole("navigation", { name: "Primary navigation" }).getByRole("link", { name: label, exact: true }).click();
  await ready(page);
}

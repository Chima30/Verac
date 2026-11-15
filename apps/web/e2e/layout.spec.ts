import { expect, test, type Page } from "@playwright/test";

// Pages that render without signing in. Signed-in pages need Supabase and test accounts, which this suite does not create.
const PUBLIC = ["/dashboard", "/command-center", "/proof", "/treasury", "/threats", "/simulator", "/invoices", "/policies", "/settings/agents", "/settings/integrations", "/settings/wallets", "/login"];

async function noHorizontalOverflow(page: Page) {
  const { sw, cw } = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
  expect(sw, `page is ${sw - cw}px wider than the viewport`).toBeLessThanOrEqual(cw + 1);
}

for (const theme of ["light", "dark"] as const) {
  test.describe(`${theme} theme`, () => {
    test.beforeEach(async ({ page }) => {
      await page.addInitScript((t) => { try { localStorage.setItem("verac-theme", t); } catch { /* ignore */ } }, theme);
    });
    for (const path of PUBLIC) {
      test(`${path} fits the viewport`, async ({ page }, info) => {
        const res = await page.goto(path, { waitUntil: "domcontentloaded" });
        expect(res?.status(), "page responded").toBeLessThan(500);
        await page.waitForLoadState("networkidle", { timeout: 60_000 }).catch(() => { /* chain reads can be slow; layout is checked anyway */ });
        await expect(page.locator("h1").first()).toBeVisible();
        expect(await page.evaluate(() => document.documentElement.classList.contains("dark"))).toBe(theme === "dark");
        await noHorizontalOverflow(page);
        if (path !== "/login") await expect(page.locator("main#main")).toBeVisible();
        await page.screenshot({ path: info.outputPath(`${path.replaceAll("/", "_") || "root"}-${theme}.png`), fullPage: true });
      });
    }
  });
}

test("command palette opens with Ctrl+K and finds a page", async ({ page, isMobile }) => {
  test.skip(isMobile, "keyboard shortcut is a desktop feature; the search button covers mobile");
  await page.goto("/dashboard", { waitUntil: "domcontentloaded" });
  await page.locator("main#main").waitFor();
  await page.waitForFunction(() => document.querySelector("header button[aria-label='Search pages and actions'], aside button"));
  await page.keyboard.press("Control+k");
  const box = page.getByRole("combobox", { name: "Search pages and actions" });
  await expect(box).toBeVisible();
  await box.fill("treasury");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/treasury$/);
});

test("mobile navigation drawer opens and closes with Escape", async ({ page, isMobile }) => {
  test.skip(!isMobile, "drawer is the phone navigation");
  await page.goto("/dashboard", { waitUntil: "domcontentloaded" });
  const open = page.getByRole("button", { name: "Open navigation" });
  await expect(async () => { await open.click(); await expect(page.getByRole("dialog", { name: "Navigation" })).toBeVisible({ timeout: 1000 }); }).toPass({ timeout: 20_000 });
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Navigation" })).toBeHidden();
});

test("live proof ledger filters and keeps every record visible under All", async ({ page }) => {
  await page.goto("/proof", { waitUntil: "domcontentloaded" });
  const ledger = page.getByRole("region", { name: "Evidence ledger" });
  await expect(ledger).toBeVisible({ timeout: 60_000 });
  const all = await ledger.locator("tbody > tr").count();
  await expect(async () => {
    await ledger.getByRole("button", { name: /^Rejected operations/ }).click();
    expect(await ledger.locator("tbody > tr").count()).toBeLessThan(all);
  }).toPass({ timeout: 20_000 });
  await ledger.getByRole("button", { name: /^All/ }).click();
  expect(await ledger.locator("tbody > tr").count()).toBe(all);
});

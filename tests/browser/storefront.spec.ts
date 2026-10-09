import { test as base, expect, type Page } from "@playwright/test";
import { storefrontLabels, storefrontLocales } from "../../lib/storefront/localization";
import { marketingCopy } from "../../lib/storefront/marketing-copy";
import { brandNames } from "../../data/brands";

// Collect actual browser errors, not 404 resource console noise. Never mock the app.
const test = base.extend({
  page: async ({ page }, runTest) => {
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    page.on("console", message => {
      if (message.type() === "error" && /hydration|hydrating|server rendered/i.test(message.text())) {
        errors.push(message.text());
      }
    });
    await runTest(page);
    expect(errors, "browser runtime/hydration errors").toEqual([]);
  },
});

async function visit(page: Page, path: string) {
  const response = await page.goto(path);
  // Wait for React to attach client control props; SSR visibility alone is not hydration.
  // Test-only observation: no application test IDs, flags, sleeps or production hooks.
  await page.waitForFunction(() => {
    const button = document.querySelector('[aria-controls="mobile-navigation"]');
    return button && Object.keys(button).some(key => key.startsWith("__reactProps$"));
  });
  return response;
}

async function noOverflow(page: Page) {
  await page.evaluate(() => document.fonts.ready);
  expect(await page.evaluate(() => ({
    width: document.documentElement.clientWidth,
    scroll: document.documentElement.scrollWidth,
  }))).toEqual(expect.objectContaining({ width: page.viewportSize()!.width }));
  expect(await page.evaluate(() => document.documentElement.scrollWidth))
    .toBeLessThanOrEqual(page.viewportSize()!.width + 1);
}

for (const locale of storefrontLocales) {
  const labels = storefrontLabels[locale];
  const directory = marketingCopy[locale].directory;

  test(`${locale}: general 404 supports direct entry, refresh, keyboard recovery and history`, async ({ page }) => {
    const path = `/${locale}/unmatched-wave2-route`;
    const response = await page.goto(path);
    expect(response?.status()).toBe(404);
    await expect(page.getByRole("heading", { name: "404", exact: true })).toBeVisible();
    const home = page.locator("main").getByRole("link", { name: labels.home, exact: true });
    await expect(home).toHaveAttribute("href", `/${locale}`);
    await expect(page.locator('meta[name="robots"]').first()).toHaveAttribute("content", /noindex/);
    expect((await page.reload())?.status()).toBe(404);
    await expect(home).toBeVisible();
    await noOverflow(page);
    await home.focus();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(`/${locale}`);
    await expect(page.locator("#main-content")).toBeVisible();
    await page.goBack();
    await expect(page).toHaveURL(path);
    await expect(home).toBeVisible();
    await page.goForward();
    await expect(page).toHaveURL(`/${locale}`);
    await expect(page.locator("#main-content")).toBeVisible();
  });

  test(`${locale}: hydrated menu keyboard/focus and breakpoint cleanup`, async ({ page }) => {
    await visit(page, `/${locale}`);
    await noOverflow(page);
    const original = page.viewportSize()!;
    await page.setViewportSize({ width: Math.min(original.width, 375), height: 900 });
    const toggle = page.locator('[aria-controls="mobile-navigation"]');
    const menu = page.locator("#mobile-navigation");
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await toggle.click();
    await expect(menu).toBeVisible();
    await expect(toggle).toHaveAccessibleName(labels.closeMenu);
    await toggle.click();
    await expect(menu).toBeHidden();
    await toggle.focus();
    await page.keyboard.press("Space");
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await page.keyboard.press("Tab");
    await expect(menu.getByRole("link", { name: labels.home, exact: true })).toBeFocused();
    await page.keyboard.press("Shift+Tab");
    await expect(toggle).toBeFocused();
    await page.keyboard.press("Tab");
    await page.keyboard.press("Escape");
    await expect(menu).toBeHidden();
    await expect(toggle).toBeFocused();
    await expect(toggle).toHaveAccessibleName(labels.openMenu);

    await page.keyboard.press("Enter");
    await expect(menu).toBeVisible();
    await page.keyboard.press("Tab");
    await expect(menu.getByRole("link", { name: labels.home, exact: true })).toBeFocused();
    await page.setViewportSize({ width: 1024, height: 900 });
    await expect(menu).toBeHidden();
    await expect(page.getByRole("navigation", { name: labels.primaryNavigation })
      .getByRole("link", { name: labels.shop, exact: true })).toBeFocused();
    await page.setViewportSize({ width: 375, height: 900 });
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await expect(menu).toBeHidden();
    await toggle.focus();
    await page.keyboard.press("Enter");
    await page.keyboard.press("Tab"); // Home
    await page.keyboard.press("Tab"); // Shop
    await page.keyboard.press("Tab"); // Brands
    await expect(menu.getByRole("link", { name: labels.brands, exact: true })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(`/${locale}/brands`);
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await expect(menu).toBeHidden();
    await page.setViewportSize(original);
    await noOverflow(page);
  });

  test(`${locale}: Brands search, A-Z, zero-results recovery and exact filtered destination`, async ({ page }) => {
    await visit(page, `/${locale}/brands`);
    const section = page.getByRole("region", { name: directory.browse, exact: true });
    const search = page.getByRole("searchbox", { name: directory.searchLabel });
    await expect(section.getByRole("listitem")).toHaveCount(brandNames.length);
    await noOverflow(page);
    await search.fill("round");
    await expect(section.getByRole("listitem")).toHaveCount(1);
    await expect(section.getByRole("link", { name: "Round Lab", exact: true })).toBeVisible();
    await search.fill("zzzz-no-such-brand");
    await expect(section.getByRole("heading", { name: directory.empty })).toBeVisible();
    await expect(section.getByRole("listitem")).toHaveCount(0);
    await search.fill("");
    const r = section.getByRole("button", { name: "R", exact: true });
    await r.focus();
    await page.keyboard.press("Space");
    await expect(r).toHaveAttribute("aria-pressed", "true");
    await expect(section.getByRole("listitem")).toHaveCount(1);
    await section.getByRole("button", { name: directory.all, exact: true }).click();
    await expect(section.getByRole("listitem")).toHaveCount(brandNames.length);
    await r.click();
    const round = section.getByRole("link", { name: "Round Lab", exact: true });
    await expect(round).toHaveAttribute("href", `/${locale}/products?brand=Round+Lab`);
    await round.focus();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(`/${locale}/products?brand=Round+Lab`);
    await expect(page.getByLabel(labels.filterBrand, { exact: true })).toHaveValue("Round Lab");
    await expect(page.getByRole("heading", { name: labels.noResults })).toBeVisible();
    await noOverflow(page);
  });

  test(`${locale}: native GET apply/reset and locale query preservation`, async ({ page }) => {
    await visit(page, `/${locale}/products`);
    const search = page.getByRole("searchbox", { name: labels.searchProducts, exact: true });
    await search.fill("teszt 한국");
    await page.keyboard.press("Tab");
    const brand = page.getByLabel(labels.filterBrand, { exact: true });
    await expect(brand).toBeFocused();
    await brand.selectOption("Dr. Althea");
    await page.keyboard.press("Tab");
    await expect(page.getByRole("button", { name: labels.apply })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(new RegExp(`/${locale}/products\\?`));
    let url = new URL(page.url());
    expect(url.searchParams.get("q")).toBe("teszt 한국");
    expect(url.searchParams.get("brand")).toBe("Dr. Althea");
    await expect(page.getByRole("heading", { name: labels.noResults })).toBeVisible();
    await noOverflow(page);
    if (page.viewportSize()!.width < 1024) {
      await page.locator('[aria-controls="mobile-navigation"]').click();
      await expect(page.locator("#mobile-navigation")).toBeVisible();
    }
    const target = locale === "en" ? "hu" : "en";
    const name = target === "hu" ? "Magyar" : "English";
    await page.getByRole("link", { name, exact: true }).filter({ visible: true }).click();
    await expect(page).toHaveURL(new RegExp(`/${target}/products\\?`));
    url = new URL(page.url());
    expect(url.searchParams.get("q")).toBe("teszt 한국");
    expect(url.searchParams.get("brand")).toBe("Dr. Althea");
    const next = storefrontLabels[target];
    await expect(page.getByLabel(next.filterBrand, { exact: true })).toHaveValue("Dr. Althea");
    await expect(page.getByRole("searchbox", { name: next.searchProducts, exact: true })).toHaveValue("teszt 한국");
    await page.getByRole("link", { name: next.clear, exact: true }).click();
    await expect(page).toHaveURL(`/${target}/products`);
    await expect(page.getByRole("searchbox", { name: next.searchProducts, exact: true })).toHaveValue("");
    await expect(page.getByLabel(next.filterBrand, { exact: true })).toHaveValue("");
    await expect(page.getByRole("heading", { name: next.empty })).toBeVisible();
    await noOverflow(page);
  });

  test(`${locale}: actual empty catalogue and unknown product recovery`, async ({ page }) => {
    await visit(page, `/${locale}/products`);
    await expect(page.getByRole("heading", { name: labels.empty })).toBeVisible();
    await expect(page.locator("article")).toHaveCount(0);
    await noOverflow(page);
    const response = await visit(page, `/${locale}/products/unknown-browser-test-product`);
    expect(response?.status()).toBe(404);
    await expect(page.getByRole("heading", { name: labels.notFound })).toBeVisible();
    await noOverflow(page);
    const back = page.getByRole("link", { name: labels.back, exact: true });
    await back.focus();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(`/${locale}/products`);
    await expect(page.getByRole("heading", { name: labels.empty })).toBeVisible();
  });

  test(`${locale}: repeated/encoded browse criteria normalize during locale navigation; unknown detail stays 404`, async ({ page }) => {
    const criteria = new URLSearchParams({ q: "테스트 & lemosó + / ? #", brand: "Round Lab" });
    await visit(page, `/${locale}/products?${criteria}&q=ignored&brand=Anua&returnUrl=https%3A%2F%2Finvalid.example`);
    await expect(page.getByRole("searchbox", { name: labels.searchProducts, exact: true })).toHaveValue(criteria.get("q")!);
    await expect(page.getByLabel(labels.filterBrand, { exact: true })).toHaveValue("Round Lab");
    if (page.viewportSize()!.width < 1024) await page.locator('[aria-controls="mobile-navigation"]').click();
    const target = locale === "en" ? "hu" : "en";
    await page.getByRole("link", { name: target === "hu" ? "Magyar" : "English", exact: true }).filter({ visible: true }).click();
    await expect(page).toHaveURL(`/${target}/products?${criteria}`);
    await noOverflow(page);
    const response = await visit(page, `/${locale}/products/unknown-browser-test-product?${criteria}`);
    expect(response?.status()).toBe(404);
    const back = page.getByRole("link", { name: labels.back, exact: true });
    await expect(back).toHaveAttribute("href", `/${locale}/products`);
    await back.click();
    await expect(page).toHaveURL(`/${locale}/products`);
    await expect(page.getByRole("heading", { name: labels.empty })).toBeVisible();
  });
}

test("unsupported locale recovers to the existing legacy English home", async ({ page }) => {
  expect((await page.goto("/invalid-locale"))?.status()).toBe(404);
  const home = page.locator("main").getByRole("link", { name: "Home", exact: true });
  await expect(home).toHaveAttribute("href", "/");
  await home.click();
  await expect(page).toHaveURL("/");
  await expect(page.locator("#main-content")).toBeVisible();
});

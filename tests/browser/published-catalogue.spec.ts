import { test as base, expect, type Page } from "@playwright/test";
import { storefrontLabels, storefrontLocales } from "../../lib/storefront/localization";
import { marketingCopy } from "../../lib/storefront/marketing-copy";
import { publishedSlug, draftSlug, missingLocaleSlug } from "./published-catalogue-fixtures.mjs";

// Expected browser URLs, not a replacement for the server-only parser/serializer.
const expectedQuery = (q: string, brand: string) =>
  `?${new URLSearchParams(q ? { q, brand } : { brand })}`;

const test = base.extend({
  page: async ({ page }, runTest) => {
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    page.on("console", message => {
      if (message.type() === "error" && /hydration|hydrating|server rendered/i.test(message.text())) errors.push(message.text());
    });
    await page.route("**/*", route => {
      if (new URL(route.request().url()).origin === "http://127.0.0.1:3101") return route.continue();
      errors.push(`Unexpected external request: ${route.request().url()}`);
      return route.abort();
    });
    await runTest(page);
    expect(errors, "runtime/hydration errors or external requests").toEqual([]);
  },
});

async function visit(page: Page, path: string) {
  const response = await page.goto(path);
  await page.waitForFunction(() => {
    const button = document.querySelector('[aria-controls="mobile-navigation"]');
    return button && Object.keys(button).some(key => key.startsWith("__reactProps$"));
  });
  return response;
}

for (const locale of storefrontLocales) {
  const labels = storefrontLabels[locale];
  test(`${locale}: published Brands → filtered listing → detail → Back, history and locale context`, async ({ page }) => {
    await visit(page, `/${locale}/brands`);
    const directory = marketingCopy[locale].directory;
    await page.getByRole("searchbox", { name: directory.searchLabel }).fill("round");
    const brandLink = page.getByRole("link", { name: "Round Lab", exact: true });
    await brandLink.focus();
    await page.keyboard.press("Enter");
    const brandQuery = expectedQuery("", "Round Lab");
    await expect(page).toHaveURL(`/${locale}/products${brandQuery}`);
    await expect(page.getByLabel(labels.filterBrand, { exact: true })).toHaveValue("Round Lab");
    await expect(page.locator('li a[href*="/products/"]')).toHaveCount(1);
    await expect(page.getByRole("link", { name: /draft/i })).toHaveCount(0);

    const query = "TEST ONLY";
    const criteria = expectedQuery(query, "Round Lab");
    await page.getByRole("searchbox", { name: labels.searchProducts, exact: true }).fill(query);
    await page.getByRole("button", { name: labels.apply, exact: true }).press("Enter");
    await expect(page).toHaveURL(`/${locale}/products${criteria}`);
    const card = page.getByRole("link", { name: `TEST ONLY ${locale} published item`, exact: true });
    await expect(card).toHaveAttribute("href", `/${locale}/products/${publishedSlug}${criteria}`);
    await card.focus();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(`/${locale}/products/${publishedSlug}${criteria}`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(`TEST ONLY ${locale} published item`);
    await expect(page.getByRole("img", { name: `TEST ONLY ${locale} image` })).toBeVisible();
    await expect(page.locator('meta[name="robots"]').first()).toHaveAttribute("content", /noindex/);
    await expect(page.locator('link[rel="canonical"]')).toHaveCount(0);
    const back = page.getByRole("link", { name: labels.back, exact: true });
    await expect(back).toHaveAttribute("href", `/${locale}/products${criteria}`);
    await back.press("Enter");
    await expect(page).toHaveURL(`/${locale}/products${criteria}`);
    await expect(page.getByRole("searchbox", { name: labels.searchProducts, exact: true })).toHaveValue(query);
    await expect(page.getByLabel(labels.filterBrand, { exact: true })).toHaveValue("Round Lab");
    await page.goBack();
    await expect(page).toHaveURL(`/${locale}/products/${publishedSlug}${criteria}`);
    if (page.viewportSize()!.width < 1024) await page.locator('[aria-controls="mobile-navigation"]').click();
    const target = locale === "en" ? "hu" : "en";
    await page.getByRole("link", { name: target === "hu" ? "Magyar" : "English", exact: true }).filter({ visible: true }).press("Enter");
    await expect(page).toHaveURL(`/${target}/products/${publishedSlug}${criteria}`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(`TEST ONLY ${target} published item`);
    await page.getByRole("link", { name: storefrontLabels[target].back, exact: true }).press("Enter");
    await expect(page).toHaveURL(`/${target}/products${criteria}`);
    await expect(page.getByLabel(storefrontLabels[target].filterBrand, { exact: true })).toHaveValue("Round Lab");
  });

  test(`${locale}: direct entry, encoded/repeated criteria, draft/unknown and missing translation`, async ({ page }) => {
    await visit(page, `/${locale}/products/${publishedSlug}`);
    await expect(page.getByRole("link", { name: labels.back, exact: true })).toHaveAttribute("href", `/${locale}/products`);
    const q = "TEST ONLY & 한국 + / ? #";
    const criteria = expectedQuery(q, "Round Lab");
    await visit(page, `/${locale}/products/${publishedSlug}${criteria}&q=ignored&brand=Anua&returnUrl=https://invalid.example`);
    await page.getByRole("link", { name: labels.back, exact: true }).press("Enter");
    await expect(page).toHaveURL(`/${locale}/products${criteria}`);
    await expect(page.getByRole("searchbox", { name: labels.searchProducts, exact: true })).toHaveValue(q);
    await expect(page.getByRole("heading", { name: labels.noResults, exact: true })).toBeVisible();
    await page.getByRole("link", { name: labels.clear, exact: true }).press("Enter");
    await expect(page).toHaveURL(`/${locale}/products`);
    await expect(page.locator('li a[href*="/products/"]')).toHaveCount(2);
    for (const slug of [draftSlug, "test-only-unknown-item"]) {
      expect((await visit(page, `/${locale}/products/${slug}${criteria}`))?.status()).toBe(404);
      await expect(page.getByRole("heading", { name: labels.notFound, exact: true })).toBeVisible();
      await expect(page.getByRole("link", { name: labels.back, exact: true })).toHaveAttribute("href", `/${locale}/products`);
    }
    expect((await visit(page, `/${locale}/products/${missingLocaleSlug}`))?.status()).toBe(200);
    if (locale !== "en") {
      await expect(page.getByText(labels.missing, { exact: true })).toBeVisible();
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(labels.details);
      await expect(page.getByText("TEST ONLY en missing-locale fixture published item", { exact: true })).toHaveCount(0);
    }
    await page.evaluate(() => document.fonts.ready);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(page.viewportSize()!.width + 1);
  });
}

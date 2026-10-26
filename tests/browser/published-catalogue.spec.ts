import { test as base, expect, type Page } from "@playwright/test";
import { storefrontLabels, storefrontLocales } from "../../lib/storefront/localization";
import { marketingCopy } from "../../lib/storefront/marketing-copy";
import { publishedSlug, draftSlug, missingLocaleSlug, gallerySlug, textOnlySlug, publishedCatalogueFixtures, journeyCatalogueProducts } from "./published-catalogue-fixtures.mjs";
import { cartLabels } from "../../lib/cart/labels";
import { CART_STORAGE_KEY } from "../../lib/cart/cart-state";
import { portablePayload } from "../../lib/cart/cart-portable-handoff";
import { readShoppingPlan } from "../../lib/catalog/catalogue-shopping-plan";
import { comparisonLabels } from "../../lib/comparison/labels";
import { FAVORITES_STORAGE_KEY, serializeFavorites } from "../../lib/favorites/favorite-state";
import { RECENT_STORAGE_KEY, serializeRecent } from "../../lib/recently-viewed/recent-state";
import { searchSuggestionLabels } from "../../lib/catalog/search-suggestion-labels";
import { favoriteLabels } from "../../lib/favorites/labels";

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

for (const routeLocale of [null, ...storefrontLocales]) for (const javaScriptEnabled of [true, false]) {
  const locale = routeLocale ?? "en";
  const root = routeLocale ? `/${routeLocale}` : "";
  test.describe(`${routeLocale ?? "legacy"}: Footer detail JS ${javaScriptEnabled}`, () => {
    test.use({ javaScriptEnabled });
    test("sort continuity preserves filtered names, GET/history/detail/locale and native no-JS controls", async ({ page }) => {
      const labels = storefrontLabels[locale];
      const listing = `${root}/products`;
      const order = async (slugs: string[], suffix: string) => {
        await expect(page.locator("main li h2 a")).toHaveCount(slugs.length);
        expect(await page.locator("main li h2 a").evaluateAll(links => links.map(link => link.getAttribute("href"))))
          .toEqual(slugs.map(slug => `${root}/products/${slug}${suffix}`));
      };
      const brandSorted = "?brand=beplain&sort=name-asc";
      await page.goto(listing + brandSorted);
      const sort = page.getByLabel(labels.sortBy, { exact: true });
      await expect(sort).toHaveValue("name-asc");
      await expect(sort.locator("option")).toHaveText([labels.defaultOrder, labels.nameAscending, labels.nameDescending]);
      await order(locale === "en" ? [gallerySlug, missingLocaleSlug, textOnlySlug] : [gallerySlug, textOnlySlug, missingLocaleSlug], brandSorted);
      await expect(page.getByRole("link", { name: /draft/i })).toHaveCount(0);
      await page.getByRole("searchbox", { name: labels.searchProducts, exact: true }).fill("TEST ONLY");
      await page.getByLabel(labels.filterBrand, { exact: true }).selectOption("");
      await sort.focus(); await page.keyboard.press("Home"); await page.keyboard.press("ArrowDown"); await page.keyboard.press("ArrowDown");
      await expect(sort).toHaveValue("name-desc");
      await page.keyboard.press("Tab");
      await expect(page.getByRole("button", { name: labels.apply, exact: true })).toBeFocused();
      await page.keyboard.press("Enter");
      const applied = "?q=TEST+ONLY&brand=&sort=name-desc";
      await expect(page).toHaveURL(listing + applied);
      const normalized = "?q=TEST+ONLY&sort=name-desc";
      await order(locale === "en" ? [textOnlySlug, publishedSlug, missingLocaleSlug, gallerySlug] : [textOnlySlug, publishedSlug, gallerySlug], normalized);
      // HU/KO missing content has no TEST ONLY search text: filtering precedes sorting.
      await page.goBack(); await expect(page).toHaveURL(listing + brandSorted);
      await expect(sort).toHaveValue("name-asc");
      await page.goForward(); await expect(page).toHaveURL(listing + applied);
      await expect(sort).toHaveValue("name-desc");
      const detail = page.getByRole("link", { name: `TEST ONLY ${locale} published item`, exact: true });
      await detail.press("Enter");
      await expect(page).toHaveURL(`${root}/products/${publishedSlug}${normalized}`);
      await expect(page.getByRole("link", { name: labels.back, exact: true })).toHaveAttribute("href", listing + normalized);
      // Explicit same-brand discovery intentionally starts a new brand-only context.
      await expect(page.locator("article").getByRole("link", { name: "Round Lab", exact: true })).toHaveAttribute("href", `${root}/products?brand=Round+Lab`);
      const target = locale === "hu" ? "en" : "hu";
      if (!javaScriptEnabled) await page.setViewportSize({ width: 1280, height: 900 });
      else if (page.viewportSize()!.width < 1024) await page.locator('[aria-controls="mobile-navigation"]').click();
      await page.locator("header").getByRole("link", { name: target === "en" ? "English" : "Magyar", exact: true }).filter({ visible: true }).press("Enter");
      await expect(page).toHaveURL(`/${target}/products/${publishedSlug}${normalized}`);
      await page.getByRole("link", { name: storefrontLabels[target].back, exact: true }).press("Enter");
      await expect(page).toHaveURL(`/${target}/products${normalized}`);
      await expect(page.getByLabel(storefrontLabels[target].sortBy, { exact: true })).toHaveValue("name-desc");
      await page.goto(listing + "?q=TEST+ONLY&brand=Round+Lab&sort=name-asc");
      if (javaScriptEnabled && page.viewportSize()!.width < 1024) await page.locator('[aria-controls="mobile-navigation"]').click();
      const headerSearch = page.locator("header").getByRole("link", { name: labels.search, exact: true }).filter({ visible: true });
      await expect(headerSearch).toHaveAttribute("href", listing + "?q=TEST+ONLY&brand=Round+Lab&sort=name-asc#catalogue-search");
      await headerSearch.press("Enter");
      await expect(page.locator("#catalogue-search")).toBeFocused();
      await expect(page.locator('meta[name="robots"]').first()).toHaveAttribute("content", /noindex/);
      await expect(page.locator('link[rel="canonical"]')).toHaveCount(0);
      await expect(page.locator("footer")).toHaveCount(1);
      for (const width of [320, 375, 1024, 1280]) {
        await page.setViewportSize({ width, height: 900 });
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width + 1);
      }
      for (const bad of ["sort=price", "sort=name-asc&sort=name-desc"]) {
        await page.goto(listing + `?q=TEST+ONLY&q=ignored&brand=Round+Lab&brand=Anua&${bad}&returnUrl=https://invalid.example`);
        await expect(sort).toHaveValue("");
        await expect(page.getByLabel(labels.filterBrand, { exact: true })).toHaveValue("Round Lab");
        await expect(page.getByRole("link", { name: `TEST ONLY ${locale} published item`, exact: true }))
          .toHaveAttribute("href", `${root}/products/${publishedSlug}?q=TEST+ONLY&brand=Round+Lab`);
      }
      await page.goto(listing + "?sort=name-desc");
      await page.getByRole("link", { name: labels.clear, exact: true }).press("Enter");
      await expect(page).toHaveURL(listing);
      await expect(sort).toHaveValue("");
      await order([publishedSlug, missingLocaleSlug, gallerySlug, textOnlySlug], "");
    });
    test("quick add uses shared cart and keeps native listing navigation honest", async ({ page }) => {
      const cart = cartLabels[locale];
      const name = `TEST ONLY ${locale} published item`;
      const query = expectedQuery("TEST ONLY", "Round Lab");
      const listing = `${root}/products${query}`;
      await page.goto(listing);
      const row = page.locator("main li");
      await expect(row).toHaveCount(1);
      const add = row.getByRole("button", { name: `${cart.add}: ${name}`, exact: true });
      await expect(row.locator("a button")).toHaveCount(0);
      const detail = `${root}/products/${publishedSlug}${query}`;
      await expect(row.getByRole("link", { name, exact: true })).toHaveAttribute("href", detail);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(page.viewportSize()!.width + 1);
      if (!javaScriptEnabled) {
        await expect(add).toBeDisabled();
        await expect(row.getByRole("status")).toHaveText("");
        await expect(row.getByRole("img")).toBeVisible();
        await row.getByRole("link", { name, exact: true }).press("Enter");
        await expect(page).toHaveURL(detail);
        return;
      }
      await expect(add).toBeEnabled();
      await row.getByRole("link", { name, exact: true }).focus();
      await page.keyboard.press("Tab");
      await expect(add).toBeFocused();
      await add.press("Enter"); await expect(page).toHaveURL(listing);
      await expect(row.getByRole("status")).toHaveText(cart.added);
      await add.click();
      const headerCart = page.locator("header").locator(`a[href="${root}/cart"][aria-label]`);
      await expect(headerCart.first()).toHaveAttribute("aria-label", `${cart.cart}: ${cart.selectedQuantity} 2`);
      await row.getByRole("link", { name, exact: true }).press("Enter");
      await page.getByRole("button", { name: cart.add, exact: true }).click();
      await page.goto(`${root}/cart`);
      await expect(page.getByRole("spinbutton")).toHaveValue("3");
      await page.getByRole("spinbutton").fill("4");
      await page.getByRole("button", { name: cart.update, exact: true }).click();
      const target = locale === "hu" ? "en" : "hu";
      if (page.viewportSize()!.width < 1024) await page.locator('[aria-controls="mobile-navigation"]').click();
      await page.locator("header").getByRole("link", { name: target === "en" ? "English" : "Magyar", exact: true }).filter({ visible: true }).click();
      await expect(page).toHaveURL(`/${target}/cart`);
      await expect(page.getByRole("spinbutton")).toHaveValue("4");
      await page.goto(listing);
      const stored = await page.evaluate(key => JSON.parse(localStorage.getItem(key)!), CART_STORAGE_KEY);
      expect(stored.lines).toEqual([{ publicId: "12345678-abcd-1234-abcd-123456789abc", quantity: 4 }]);
      await page.goto(`${root}/cart`);
      await page.getByRole("button", { name: cart.clear, exact: true }).click();
      await expect(page.getByText(cart.empty, { exact: true })).toBeVisible();
      await page.setViewportSize({ width: 320, height: 900 });
      await page.goto(listing);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(321);
    });
    if (javaScriptEnabled) test("quick add rejects corrupt and overflow data and reports blocked storage without success", async ({ page }) => {
      const cart = cartLabels[locale];
      const query = expectedQuery("TEST ONLY", "Round Lab");
      const path = `${root}/products${query}`;
      await page.goto(path);
      const row = page.locator("main li");
      const add = row.getByRole("button", { name: `${cart.add}: TEST ONLY ${locale} published item`, exact: true });
      const corrupt = JSON.stringify({ version: 1, lines: [{ publicId: "bad-id", quantity: -1 }] });
      await page.evaluate(({ key, corrupt }) => localStorage.setItem(key, corrupt), { key: CART_STORAGE_KEY, corrupt });
      await page.reload();
      await expect(add).toBeDisabled();
      await expect(row.getByRole("status")).toHaveText(cart.invalidStorage);
      expect(await page.evaluate(key => localStorage.getItem(key), CART_STORAGE_KEY)).toBe(corrupt);
      await page.evaluate(key => localStorage.setItem(key, JSON.stringify({ version: 1, lines: [{ publicId: "12345678-abcd-1234-abcd-123456789abc", quantity: Number.MAX_SAFE_INTEGER }] })), CART_STORAGE_KEY);
      await page.reload(); await add.click();
      await expect(row.getByRole("status")).toHaveText(cart.invalid);
      expect(await page.evaluate(key => JSON.parse(localStorage.getItem(key)!).lines[0].quantity, CART_STORAGE_KEY)).toBe(Number.MAX_SAFE_INTEGER);
      await page.evaluate(key => localStorage.removeItem(key), CART_STORAGE_KEY);
      await page.addInitScript(() => Object.defineProperty(Storage.prototype, "setItem", { value() { throw new Error("TEST ONLY write denied"); } }));
      await page.reload(); await add.click();
      await expect(row.getByRole("status")).toHaveText(cart.storage);
      await expect(row.getByRole("status")).not.toContainText(cart.added);
      await expect(add).toBeDisabled();
      await page.locator("footer").getByRole("link", { name: cart.cart, exact: true }).click();
      await expect(page.getByRole("spinbutton")).toHaveValue("1"); // Existing current-tab fallback policy.
      await page.addInitScript(() => Object.defineProperty(Storage.prototype, "getItem", { value() { throw new Error("TEST ONLY read denied"); } }));
      await page.goto(path);
      await expect(add).toBeDisabled();
      await expect(row.getByRole("status")).toHaveText(cart.storage);
      await expect(row.getByRole("status")).not.toContainText(cart.added);
    });
    test("same-brand discovery preserves original Back and related brand round trip", async ({ page }) => {
      const labels = storefrontLabels[locale];
      const original = expectedQuery("Original & query", "Round Lab");
      await page.goto(`${root}/products/${gallerySlug}${original}`);
      const back = page.getByRole("link", { name: labels.back, exact: true });
      await expect(back).toHaveAttribute("href", `${root}/products${original}`);
      const brand = page.locator("article").getByRole("link", { name: "beplain", exact: true });
      await expect(brand).toHaveAttribute("href", `${root}/products?brand=beplain`);
      const section = page.getByRole("region", { name: "beplain", exact: true });
      const links = section.getByRole("link");
      await expect(links).toHaveCount(2);
      await expect(links.nth(0)).toHaveAttribute("href", `${root}/products/${missingLocaleSlug}?brand=beplain`);
      await expect(links.nth(1)).toHaveAttribute("href", `${root}/products/${textOnlySlug}?brand=beplain`);
      if (locale !== "en") {
        await expect(links.nth(0)).toHaveAccessibleName(`${labels.details}: beplain (${missingLocaleSlug})`);
        await expect(section).not.toContainText("TEST ONLY en missing-locale");
        await expect(section.getByText(labels.missing, { exact: true })).toBeVisible();
      }
      await links.nth(1).press("Enter");
      await expect(page).toHaveURL(`${root}/products/${textOnlySlug}?brand=beplain`);
      await expect(back).toHaveAttribute("href", `${root}/products?brand=beplain`);
      await back.press("Enter"); await expect(page).toHaveURL(`${root}/products?brand=beplain`);
      await page.goto(`${root}/products/${gallerySlug}${original}`);
      await brand.click(); await expect(page).toHaveURL(`${root}/products?brand=beplain`);
      await page.goto(`${root}/products/${publishedSlug}`);
      await expect(page.locator("#same-brand-heading")).toHaveCount(0);
      await expect(page.locator("article").getByRole("link", { name: "Round Lab", exact: true })).toHaveAttribute("href", `${root}/products?brand=Round+Lab`);
      if (page.viewportSize()!.width > 320) await page.setViewportSize({ width: 320, height: 900 });
      await page.goto(`${root}/products/${gallerySlug}`);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320 + 1);
      await expect(page.getByRole("contentinfo", { name: "HanaPure" })).toHaveCount(1);
      await expect(page.locator('meta[name="robots"]').first()).toHaveAttribute("content", /noindex/);
      expect((await page.goto(`${root}/products/${draftSlug}`))?.status()).toBe(404);
      await expect(page.locator("#same-brand-heading")).toHaveCount(0);
    });
    test("discovery entry image matches title URL and preserves detailed Search context", async ({ page }) => {
      const labels = storefrontLabels[locale];
      const query = expectedQuery("TEST ONLY", "Round Lab");
      await page.goto(`${root}/products${query}`);
      const imageLink = page.getByRole("link", { name: `${labels.details}: TEST ONLY ${locale} published item`, exact: true });
      const titleLink = page.getByRole("link", { name: `TEST ONLY ${locale} published item`, exact: true });
      const detail = `${root}/products/${publishedSlug}${query}`;
      await expect(imageLink).toHaveAttribute("href", detail);
      await expect(titleLink).toHaveAttribute("href", detail);
      await expect(imageLink.getByRole("img")).toBeVisible();
      await imageLink.press("Enter"); await expect(page).toHaveURL(detail);
      await page.getByRole("link", { name: labels.back, exact: true }).press("Enter");
      await expect(page).toHaveURL(`${root}/products${query}`);
      if (javaScriptEnabled) {
        await page.route(`**/file.svg?locale=${locale}`, route => route.fulfill({ status: 404, body: "" }));
        await page.reload();
        await expect(imageLink.getByRole("img")).toHaveJSProperty("tagName", "DIV");
        await imageLink.click(); await expect(page).toHaveURL(detail);
        const mobile = page.viewportSize()!.width < 1024;
        if (mobile) await page.locator('[aria-controls="mobile-navigation"]').press("Enter");
        const search = page.locator("header").getByRole("link", { name: labels.search, exact: true }).filter({ visible: true });
        await expect(search).toHaveAttribute("href", `${root}/products${query}#catalogue-search`);
        await search.press("Enter");
        await expect(page).toHaveURL(`${root}/products${query}#catalogue-search`);
        await expect(page.getByRole("searchbox", { name: labels.searchProducts, exact: true })).toBeFocused();
      }
      await page.goto(`${root}/products?brand=beplain`);
      const textOnly = page.getByRole("link", { name: `TEST ONLY ${locale} text-only item`, exact: true });
      await expect(textOnly).toBeVisible();
      await expect(page.getByRole("link", { name: `${labels.details}: TEST ONLY ${locale} text-only item`, exact: true })).toHaveCount(0);
      if (locale !== "en") await expect(page.getByRole("link", { name: `${labels.details}: TEST ONLY en missing-locale fixture published item`, exact: true })).toHaveCount(0);
      await expect(page.getByRole("link", { name: /draft item/i })).toHaveCount(0);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(page.viewportSize()!.width + 1);
    });
    test("published detail has one Footer with exact public links and keyboard navigation", async ({ page }) => {
      expect((await page.goto(`${root}/products/${publishedSlug}`))?.status()).toBe(200);
      const footer = page.getByRole("contentinfo", { name: "HanaPure", exact: true });
      await expect(footer).toHaveCount(1);
      await expect(page.locator("main footer")).toHaveCount(0);
      const links = footer.getByRole("link");
      await expect(links).toHaveText([storefrontLabels[locale].home, storefrontLabels[locale].shop, storefrontLabels[locale].brands, cartLabels[locale].cart]);
      const hrefs = [root || "/", `${root}/products`, `${root}/brands`, `${root}/cart`];
      for (let index = 0; index < hrefs.length; index++) await expect(links.nth(index)).toHaveAttribute("href", hrefs[index]);
      await links.first().focus(); await page.keyboard.press("Tab");
      await expect(links.nth(1)).toBeFocused(); await page.keyboard.press("Enter");
      await expect(page).toHaveURL(`${root}/products`);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(page.viewportSize()!.width + 1);
      expect((await page.goto(`${root}/products/${draftSlug}`))?.status()).toBe(404);
      await expect(page.getByRole("contentinfo")).toHaveCount(0);
    });
  });
}

for (const locale of storefrontLocales) {
  const labels = storefrontLabels[locale];
  const cart = cartLabels[locale];
  test(`${locale}: media gallery selection, fallback, focus and zero/one-image behavior`, async ({ page }) => {
    const criteria = expectedQuery("TEST ONLY", "beplain");
    await page.route(`**/file.svg?gallery=3&locale=${locale}`, route => route.fulfill({ status: 200, contentType: "image/svg+xml", body: "TEST ONLY corrupt" }));
    const response = await visit(page, `/${locale}/products/${gallerySlug}${criteria}`);
    expect(await response!.text()).toContain(`/file.svg?gallery=1&amp;locale=${locale}`);
    const media = page.getByRole("group", { name: labels.gallery, exact: true });
    const buttons = media.locator("button[aria-pressed]");
    await expect(buttons).toHaveCount(3);
    for (let i = 0; i < 3; i++) await expect(buttons.nth(i)).toHaveAccessibleName(`TEST ONLY ${locale} gallery ${["first", "second", "third"][i]} (${i + 1}/3)`);
    const image = media.getByRole("img", { name: `TEST ONLY ${locale} gallery first`, exact: true });
    await expect(image).toBeVisible();
    expect(await image.evaluate(async node => { await (node as HTMLImageElement).decode(); return (node as HTMLImageElement).naturalWidth; })).toBeGreaterThan(0);
    await buttons.nth(1).press("Space");
    await expect(buttons.nth(1)).toBeFocused();
    await expect(buttons.nth(1)).toHaveAttribute("aria-pressed", "true");
    await expect(media.getByRole("img", { name: `TEST ONLY ${locale} gallery second`, exact: true })).toHaveJSProperty("tagName", "DIV");
    await buttons.nth(2).press("Enter");
    await expect(media.getByRole("img", { name: `TEST ONLY ${locale} gallery third`, exact: true })).toHaveJSProperty("tagName", "DIV");
    await buttons.nth(0).press("Enter");
    await expect(image).toHaveJSProperty("tagName", "IMG");
    await expect(image).toBeVisible();
    await expect(buttons.nth(0)).toBeFocused();
    await expect(buttons.nth(0)).toHaveAttribute("aria-pressed", "true");
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(page.viewportSize()!.width + 1);
    await expect(page.getByRole("link", { name: labels.back, exact: true })).toHaveAttribute("href", `/${locale}/products${criteria}`);
    await visit(page, `/${locale}/products/${publishedSlug}`);
    await expect(page.getByRole("group", { name: labels.gallery, exact: true }).locator("button[aria-pressed]")).toHaveCount(0);
    await expect(page.getByRole("button", { name: labels.inspectImage, exact: true })).toBeEnabled();
    await visit(page, `/${locale}/products/${textOnlySlug}`);
    const textOnlyDetail = page.getByRole("article").filter({
      has: page.getByRole("heading", {
        level: 1,
        name: `TEST ONLY ${locale} text-only item`,
        exact: true,
      }),
    });
    await expect(textOnlyDetail).toHaveCount(1);
    await expect(textOnlyDetail.getByRole("img")).toHaveCount(0);
    await expect(page.getByRole("button", { name: cart.add, exact: true })).toBeEnabled();
  });
  async function expectHeaderQuantity(page: Page, quantity: number) {
    // The current-language links share this href; select only cart controls.
    const links = page.locator("header").filter({ visible: true }).locator(`a[href="/${locale}/cart"][aria-label^="${cart.cart}:"]`);
    await expect(links).toHaveCount(2);
    for (const link of await links.all()) {
      const name = `${cart.cart}: ${cart.selectedQuantity} ${quantity}`;
      await expect(link).toHaveAttribute("aria-label", name);
      if (await link.isVisible()) await expect(link).toHaveAccessibleName(name);
      await expect(link).toContainText(`(${quantity})`);
    }
  }
  test(`${locale}: cart add, update, reload, locale switch, Header access, remove and empty`, async ({ page }) => {
    await visit(page, `/${locale}/products/${publishedSlug}?brand=Round+Lab`);
    const add = page.getByRole("button", { name: cart.add, exact: true });
    await expect(add).toBeEnabled();
    await page.getByLabel(cart.quantity, { exact: true }).fill("2");
    await add.press("Enter");
    await expect(page.getByRole("status")).toContainText(cart.added);
    await expectHeaderQuantity(page, 2);
    await add.click();
    await expectHeaderQuantity(page, 4);
    if (page.viewportSize()!.width < 1024) await page.locator('[aria-controls="mobile-navigation"]').click();
    await page.locator("header").getByRole("link", { name: `${cart.cart}: ${cart.selectedQuantity} 4`, exact: true }).filter({ visible: true }).press("Enter");
    await expect(page).toHaveURL(`/${locale}/cart`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(cart.cart);
    const quantity = page.getByRole("spinbutton");
    await expect(quantity).toHaveValue("4");
    await quantity.fill("3");
    await quantity.press("Enter");
    await expect(quantity).toBeFocused();
    await expectHeaderQuantity(page, 3);
    await page.reload();
    await expect(quantity).toHaveValue("3");
    const stored = await page.evaluate(key => JSON.parse(localStorage.getItem(key)!), CART_STORAGE_KEY);
    expect(stored).toEqual({ version: 1, lines: [{ publicId: "12345678-abcd-1234-abcd-123456789abc", quantity: 3 }] });
    await quantity.fill("0");
    await quantity.press("Enter");
    expect(await quantity.evaluate(input => (input as HTMLInputElement).validity.valid)).toBe(false);
    await page.reload();
    await expect(quantity).toHaveValue("3");
    const otherTab = await page.context().newPage();
    try {
      await otherTab.goto(`/${locale}/cart`);
      const otherQuantity = otherTab.getByRole("spinbutton");
      await expect(otherQuantity).toHaveValue("3");
      await otherQuantity.fill("5");
      await otherTab.getByRole("button", { name: cart.update, exact: true }).click();
      await expect(quantity).toHaveValue("5");
      await expectHeaderQuantity(page, 5);
    } finally { await otherTab.close(); }
    await expect(page.getByText(cart.notice, { exact: true })).toBeVisible();
    await expect(page.locator("main")).not.toContainText(/HUF|checkout/i);
    const other = locale === "en" ? "hu" : "en";
    if (page.viewportSize()!.width < 1024) await page.locator('[aria-controls="mobile-navigation"]').click();
    await page.getByRole("link", { name: other === "hu" ? "Magyar" : "English", exact: true }).filter({ visible: true }).press("Enter");
    await expect(page).toHaveURL(`/${other}/cart`);
    await expect(quantity).toHaveValue("5");
    await expect(page.getByRole("link", { name: `TEST ONLY ${other} published item`, exact: true })).toHaveAttribute("href", `/${other}/products/${publishedSlug}`);
    await page.getByRole("button", { name: `${cartLabels[other].remove}: TEST ONLY ${other} published item`, exact: true }).click();
    await expect(page.getByText(cartLabels[other].empty, { exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: cartLabels[other].browse, exact: true })).toBeFocused();
    await visit(page, `/${other}/products/${publishedSlug}`);
    await expect(page.getByRole("button", { name: cartLabels[other].add, exact: true })).toBeEnabled();
    await page.getByRole("button", { name: cartLabels[other].add, exact: true }).click();
    await visit(page, `/${other}/cart`);
    await page.getByRole("button", { name: cartLabels[other].clear, exact: true }).click();
    await expect(page.getByText(cartLabels[other].empty, { exact: true })).toBeVisible();
    await visit(page, `/${locale}/products/${missingLocaleSlug}`);
    await expect(page.getByRole("button", { name: cart.add, exact: true })).toBeEnabled();
    await page.getByRole("button", { name: cart.add, exact: true }).click();
    await visit(page, `/${locale}/cart`);
    if (locale !== "en") {
      await expect(page.getByText(labels.missing, { exact: true })).toBeVisible();
      await expect(page.getByRole("link", { name: labels.details, exact: true })).toHaveAttribute("href", `/${locale}/products/${missingLocaleSlug}`);
      await expect(page.getByText("TEST ONLY en missing-locale fixture published item", { exact: true })).toHaveCount(0);
    }
    await page.getByRole("button", { name: cart.clear, exact: true }).click();
    await expect(page.getByText(cart.empty, { exact: true })).toBeVisible();
    await expectHeaderQuantity(page, 0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(page.viewportSize()!.width + 1);
  });
  test(`${locale}: cart Header hydrates saved total and partial removal keeps focus inside remaining items`, async ({ page }) => {
    await page.addInitScript(({ key, lines }) => {
      localStorage.setItem(key, JSON.stringify({ version: 1, lines }));
    }, { key: CART_STORAGE_KEY, lines: [
      { publicId: "12345678-abcd-1234-abcd-123456789abc", quantity: 2 },
      { publicId: "32345678-abcd-1234-abcd-123456789abc", quantity: 3 },
      { publicId: "22345678-abcd-1234-abcd-123456789abc", quantity: 4 },
    ] });
    const response = await visit(page, `/${locale}/cart`);
    // Server starts with the fixed empty snapshot, then hydrates browser data.
    expect(await response!.text()).toContain(`aria-label="${cart.cart}: ${cart.selectedQuantity} 0"`);
    await expectHeaderQuantity(page, 9);
    const rows = page.locator("main li");
    await expect(rows).toHaveCount(3);
    await rows.first().locator("button[aria-label]").press("Enter");
    await expect(rows).toHaveCount(2);
    await expect(rows.first().locator("button[aria-label]")).toBeFocused();
    await expectHeaderQuantity(page, 7);
    // Removing the last row chooses the preceding surviving control.
    await rows.last().locator("button[aria-label]").press("Enter");
    await expect(rows).toHaveCount(1);
    await expect(rows.first().locator("button[aria-label]")).toBeFocused();
    await expectHeaderQuantity(page, 3);
    await rows.first().locator("button[aria-label]").press("Enter");
    await expect(rows).toHaveCount(0);
    await expect(page.getByRole("link", { name: cart.browse, exact: true })).toBeFocused();
    await expectHeaderQuantity(page, 0);
  });
  test(`${locale}: cart rejects tampered storage and handles unpublished items and denied persistence`, async ({ page }) => {
    await visit(page, `/${locale}/cart`);
    await page.evaluate(key => localStorage.setItem(key, JSON.stringify({ version: 1, lines: [{ publicId: "12345678-abcd-1234-abcd-123456789abc", quantity: 1, price: 9 }] })), CART_STORAGE_KEY);
    await page.reload();
    await expect(page.getByText(cart.empty, { exact: true })).toBeVisible();
    // Syntactically valid stale identity cannot become a public product or order.
    await page.evaluate(key => localStorage.setItem(key, JSON.stringify({ version: 1, lines: [{ publicId: "22345678-abcd-1234-abcd-123456789abc", quantity: 1 }] })), CART_STORAGE_KEY);
    await page.reload();
    await expect(page.getByText(cart.unavailable, { exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: /TEST ONLY.*draft/ })).toHaveCount(0);
    await page.getByRole("button", { name: cart.clear, exact: true }).click();
    // Reads still succeed: quota/write denial must not replace the in-memory
    // selection with stale persisted data when the detail unmounts.
    await page.addInitScript(() => Object.defineProperty(Storage.prototype, "setItem", { value() { throw new Error("TEST ONLY storage write denied"); } }));
    await visit(page, `/${locale}/products/${publishedSlug}`);
    await expect(page.getByRole("button", { name: cart.add, exact: true })).toBeEnabled();
    await page.getByRole("button", { name: cart.add, exact: true }).click();
    await expect(page.getByText(cart.storage, { exact: true })).toBeVisible();
    await expect(page.locator("main section").getByRole("status")).not.toContainText(cart.added);
    await page.locator("main section").getByRole("link", { name: cart.cart, exact: true }).click();
    await expect(page.getByRole("spinbutton")).toHaveValue("1");
    await expect(page.getByText(cart.storage, { exact: true })).toBeVisible();
  });
  test(`${locale}: cart reconciliation preserves stale selections and requires explicit invalid-storage recovery`, async ({ page }) => {
    await visit(page, `/${locale}/cart`);
    const lines = [
      { publicId: "12345678-ABCD-1234-ABCD-123456789ABC", quantity: 2 },
      { publicId: "22345678-abcd-1234-abcd-123456789abc", quantity: 3 },
      { publicId: "92345678-abcd-1234-abcd-123456789abc", quantity: 4 },
    ];
    await page.evaluate(({ key, lines }) => localStorage.setItem(key, JSON.stringify({ version: 1, lines })), { key: CART_STORAGE_KEY, lines });
    await page.reload();
    await expect(page.getByRole("link", { name: `TEST ONLY ${locale} published item`, exact: true })).toHaveAttribute("href", `/${locale}/products/${publishedSlug}`);
    await expect(page.getByText(cart.unavailable, { exact: true })).toHaveCount(2);
    await expect(page.getByRole("spinbutton")).toHaveCount(1);
    await expectHeaderQuantity(page, 9);
    expect(await page.evaluate(key => JSON.parse(localStorage.getItem(key)!).lines, CART_STORAGE_KEY)).toEqual(lines);
    await page.locator("main li").last().getByRole("button").press("Enter");
    await expect(page.locator("main li")).toHaveCount(2);
    await expect(page.locator("main li").last().getByRole("button")).toBeFocused();
    const invalid = JSON.stringify({ version: 1, lines: [{ publicId: lines[0].publicId, quantity: -2 }] });
    await page.evaluate(({ key, invalid }) => localStorage.setItem(key, invalid), { key: CART_STORAGE_KEY, invalid });
    await page.reload();
    await expect(page.getByText(cart.invalidStorage, { exact: true })).toBeVisible();
    await visit(page, `/${locale}/products/${publishedSlug}`);
    await expect(page.getByRole("button", { name: cart.add, exact: true })).toBeDisabled();
    expect(await page.evaluate(key => localStorage.getItem(key), CART_STORAGE_KEY)).toBe(invalid);
    await page.locator("main section").getByRole("link", { name: cart.cart, exact: true }).press("Enter");
    await expect(page.getByRole("button", { name: cart.reset, exact: true })).toBeVisible();
    const otherTab = await page.context().newPage();
    try {
      await otherTab.goto(`/${locale}/cart`);
      await expect(otherTab.getByText(cart.invalidStorage, { exact: true })).toBeVisible();
      await page.getByRole("button", { name: cart.reset, exact: true }).press("Enter");
      await expect(page.getByRole("link", { name: cart.browse, exact: true })).toBeFocused();
      await expect(otherTab.getByText(cart.invalidStorage, { exact: true })).toHaveCount(0);
      expect(await page.evaluate(key => JSON.parse(localStorage.getItem(key)!), CART_STORAGE_KEY)).toEqual({ version: 1, lines: [] });
    } finally { await otherTab.close(); }
    await expectHeaderQuantity(page, 0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(page.viewportSize()!.width + 1);
  });
  test.describe(`${locale}: JavaScript disabled`, () => {
    test.use({ javaScriptEnabled: false });
    test("media gallery retains first native image and no inert selection controls", async ({ page }) => {
      await page.goto(`/${locale}/products/${gallerySlug}`);
      const gallery = page.getByRole("group", { name: labels.gallery, exact: true });
      await expect(gallery).toHaveCount(1);
      const image = gallery.getByRole("img", { name: `TEST ONLY ${locale} gallery first`, exact: true });
      await expect(image).toBeVisible();
      expect(await image.evaluate(async node => { await (node as HTMLImageElement).decode(); return (node as HTMLImageElement).naturalWidth; })).toBeGreaterThan(0);
      await expect(gallery.getByRole("button")).toHaveCount(0);
    });
    test("normal listing/detail images retain native visibility and editorial alt", async ({ page }, testInfo) => {
      const criteria = expectedQuery("TEST ONLY", "Round Lab");
      for (const path of [`/${locale}/products${criteria}`, `/${locale}/products/${publishedSlug}${criteria}`]) {
        expect((await page.goto(path))?.status()).toBe(200);
        const image = page.getByRole("img", { name: `TEST ONLY ${locale} image`, exact: true });
        await expect(image).toHaveCount(1);
        await image.scrollIntoViewIfNeeded();
        await expect(image).toBeVisible();
        await expect(image).toHaveCSS("opacity", "1");
        expect(await image.evaluate(async node => {
          await (node as HTMLImageElement).decode();
          return (node as HTMLImageElement).naturalWidth;
        })).toBeGreaterThan(0);
        const frame = await image.locator("../..").boundingBox();
        expect(frame).not.toBeNull();
        expect(Math.abs(frame!.width - frame!.height)).toBeLessThanOrEqual(1);
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(page.viewportSize()!.width + 1);
      }
      await expect(page.getByRole("link", { name: labels.back, exact: true })).toHaveAttribute("href", `/${locale}/products${criteria}`);
      await page.screenshot({ path: testInfo.outputPath(`no-javascript-${locale}.png`), fullPage: true });
    });
  });
  test(`${locale}: image decode, missing/corrupt recovery and source replacement preserve browse context`, async ({ page }, testInfo) => {
    const imagePath = `/file.svg?locale=${locale}`;
    const other = locale === "en" ? "hu" : "en";
    const criteria = expectedQuery("TEST ONLY", "Round Lab");
    for (const failure of ["missing", "corrupt"] as const) {
      await page.route(`**${imagePath}`, route => route.fulfill({
        status: failure === "missing" ? 404 : 200,
        contentType: failure === "missing" ? "text/plain" : "image/png",
        body: "TEST ONLY invalid image bytes",
      }));
      await visit(page, `/${locale}/products${criteria}`);
      const fallback = page.getByRole("img", { name: `TEST ONLY ${locale} image`, exact: true });
      await expect(fallback).toHaveJSProperty("tagName", "DIV");
      await expect(fallback).toBeVisible();
      await expect(page.locator('img[src*="file.svg"]')).toHaveCount(0);
      const frame = await fallback.locator("..").boundingBox();
      expect(frame).not.toBeNull();
      expect(Math.abs(frame!.width - frame!.height)).toBeLessThanOrEqual(1);
      // Listing retains the same product key: exercise src replacement without
      // relying on the detail gallery's per-source key to remount the leaf.
      for (const nextLocale of [other, locale]) {
        if (page.viewportSize()!.width < 1024) await page.locator('[aria-controls="mobile-navigation"]').click();
        const name = nextLocale === "hu" ? "Magyar" : nextLocale === "ko" ? "한국어" : "English";
        await page.getByRole("link", { name, exact: true }).filter({ visible: true }).press("Enter");
        await expect(page).toHaveURL(`/${nextLocale}/products${criteria}`);
        const image = page.getByRole("img", { name: `TEST ONLY ${nextLocale} image`, exact: true });
        await expect(image).toHaveJSProperty("tagName", nextLocale === locale ? "DIV" : "IMG");
        if (nextLocale !== locale) {
          expect(await image.evaluate(async node => {
            await (node as HTMLImageElement).decode();
            return (node as HTMLImageElement).naturalWidth;
          })).toBeGreaterThan(0);
          await expect(image).toHaveCSS("opacity", "1");
        }
      }
      await page.getByRole("link", { name: `TEST ONLY ${locale} published item`, exact: true }).press("Enter");
      await expect(page).toHaveURL(`/${locale}/products/${publishedSlug}${criteria}`);
      await expect(fallback).toHaveJSProperty("tagName", "DIV");
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(`TEST ONLY ${locale} published item`);
      await page.evaluate(() => document.fonts.ready);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(page.viewportSize()!.width + 1);
      await page.screenshot({ path: testInfo.outputPath(`${failure}-${locale}.png`), fullPage: true });
      if (page.viewportSize()!.width < 1024) await page.locator('[aria-controls="mobile-navigation"]').click();
      await page.getByRole("link", { name: other === "hu" ? "Magyar" : "English", exact: true }).filter({ visible: true }).press("Enter");
      await expect(page).toHaveURL(`/${other}/products/${publishedSlug}${criteria}`);
      const replacement = page.getByRole("img", { name: `TEST ONLY ${other} image`, exact: true });
      await expect(replacement).toHaveJSProperty("tagName", "IMG");
      await expect(replacement).toHaveCSS("opacity", "1");
      expect(await replacement.evaluate(async image => {
        await (image as HTMLImageElement).decode();
        return (image as HTMLImageElement).naturalWidth;
      })).toBeGreaterThan(0);
      await page.getByRole("link", { name: storefrontLabels[other].back, exact: true }).press("Enter");
      await expect(page).toHaveURL(`/${other}/products${criteria}`);
      await page.evaluate(() => document.fonts.ready);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(page.viewportSize()!.width + 1);
      await page.unroute(`**${imagePath}`);
    }
  });
  test(`${locale}: published Brands → filtered listing → detail → Back, history and locale context`, async ({ page }) => {
    await visit(page, `/${locale}`);
    const featured = page.getByRole("article").filter({ has: page.getByRole("heading", { name: "Round Lab", exact: true }) });
    const discover = featured.getByRole("link");
    await expect(discover).toHaveAttribute("href", `/${locale}/products?brand=Round+Lab`);
    for (const name of ["Anua", "SKIN1004"]) {
      await expect(page.getByRole("article").filter({ has: page.getByRole("heading", { name, exact: true }) }).getByRole("link")).toHaveCount(0);
    }
    await discover.press("Enter");
    await expect(page).toHaveURL(`/${locale}/products?brand=Round+Lab`);
    await expect(page.getByRole("link", { name: `TEST ONLY ${locale} published item`, exact: true })).toBeVisible();
    await visit(page, `/${locale}/brands`);
    const directory = marketingCopy[locale].directory;
    const region = page.getByRole("region", { name: directory.browse, exact: true });
    await expect(region.getByRole("link")).toHaveText(["beplain", "Round Lab"]);
    await expect(region.getByRole("button", { name: "A", exact: true })).toBeDisabled();
    const search = page.getByRole("searchbox", { name: directory.searchLabel });
    await search.fill("zzzz-no-such-brand");
    await expect(region.getByRole("heading", { name: directory.empty, exact: true })).toBeVisible();
    await search.fill("");
    const letter = region.getByRole("button", { name: "R", exact: true });
    await letter.focus(); await page.keyboard.press("Space");
    await expect(letter).toHaveAttribute("aria-pressed", "true");
    await expect(region.getByRole("link")).toHaveText(["Round Lab"]);
    await region.getByRole("button", { name: directory.all, exact: true }).press("Enter");
    await expect(region.getByRole("link")).toHaveText(["beplain", "Round Lab"]);
    await search.fill("round");
    const brandLink = page.getByRole("link", { name: "Round Lab", exact: true });
    await brandLink.focus();
    await page.keyboard.press("Enter");
    const brandQuery = expectedQuery("", "Round Lab");
    await expect(page).toHaveURL(`/${locale}/products${brandQuery}`);
    await expect(page.getByLabel(labels.filterBrand, { exact: true })).toHaveValue("Round Lab");
    await expect(page.locator('#catalogue-brand option')).toHaveText([labels.allBrands, "beplain", "Round Lab"]);
    await expect(page.locator('li h2 a[href*="/products/"]')).toHaveCount(1);
    await expect(page.getByRole("link", { name: /draft/i })).toHaveCount(0);

    const query = "TEST ONLY";
    const criteria = expectedQuery(query, "Round Lab");
    await page.getByRole("searchbox", { name: labels.searchProducts, exact: true }).fill(query);
    await page.getByRole("button", { name: labels.apply, exact: true }).press("Enter");
    await expect(page).toHaveURL(`/${locale}/products${criteria}&sort=`);
    const card = page.getByRole("link", { name: `TEST ONLY ${locale} published item`, exact: true });
    await expect(card).toHaveAttribute("href", `/${locale}/products/${publishedSlug}${criteria}`);
    await card.focus();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(`/${locale}/products/${publishedSlug}${criteria}`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(`TEST ONLY ${locale} published item`);
    await expect(page.getByRole("img", { name: `TEST ONLY ${locale} image` })).toBeVisible();
    expect(await page.getByRole("img", { name: `TEST ONLY ${locale} image` }).evaluate(async image => {
      await (image as HTMLImageElement).decode();
      return (image as HTMLImageElement).naturalWidth;
    })).toBeGreaterThan(0);
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
    await expect(page.locator('li h2 a[href*="/products/"]')).toHaveCount(4);
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


// [web19] SOURCE WRITTEN ONLY in A-stage. Run solely through the owned runner
// after separate Build/Browser/workspace approval; never against real product data.
const web19Public = publishedCatalogueFixtures.filter(product => product.state === "published");
const web19Product = web19Public.find(product => product.slug === publishedSlug)!;
const web19Gallery = web19Public.find(product => product.slug === gallerySlug)!;

for (const { locale, width } of [
  { locale: "en", width: 375 }, { locale: "hu", width: 390 }, { locale: "ko", width: 430 },
] as const) {
  test(`[web19] suggestion keyboard and encoded Plan/detail/Back continuity ${locale}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const labels = storefrontLabels[locale];
    const payload = portablePayload([{ publicId: web19Product.publicId, quantity: 2 }]);
    const matchCount = web19Public.filter(product => product.translations[locale] !== null).length;
    expect(payload).not.toBeNull();
    const criteria = new URLSearchParams({ q: "TEST ONLY", brand: "Round Lab", sort: "name-asc", cartPlan: payload! });
    await visit(page, `/${locale}/products?${criteria}`);
    const input = page.locator("#catalogue-search");
    const suggestions = page.locator("a[data-search-suggestion]");
    await expect(suggestions).toHaveCount(matchCount);
    await input.focus(); await input.press("ArrowDown");
    await expect(suggestions.first()).toBeFocused();
    await suggestions.first().press("ArrowDown"); await expect(suggestions.nth(1)).toBeFocused();
    await suggestions.nth(1).press("ArrowUp"); await expect(suggestions.first()).toBeFocused();
    await suggestions.first().press("ArrowUp"); await expect(input).toBeFocused();
    await input.press("Control+ArrowDown"); await expect(input).toBeFocused();
    // Deterministic composition-flag dispatch, not hardware IME certification.
    await input.dispatchEvent("keydown", { key: "ArrowDown", isComposing: true, bubbles: true });
    await expect(input).toBeFocused();
    await input.press("Tab"); await expect(suggestions.first()).toBeFocused();
    await suggestions.first().press("Escape");
    await expect(input).toBeFocused(); await expect(suggestions).toHaveCount(0);
    await expect(input).toHaveValue("TEST ONLY");
    await input.fill("gallery"); await expect(suggestions).toHaveCount(1);
    await expect(suggestions.filter({ hasText: `TEST ONLY ${locale} published item` })).toHaveCount(0);
    const selectedHref = await suggestions.first().getAttribute("href");
    expect(selectedHref).not.toBeNull();
    const selected = new URL(selectedHref!, page.url());
    expect(selected.pathname).toBe(`/${locale}/products/${gallerySlug}`);
    expect(selected.searchParams.get("q")).toBe("gallery");
    expect(selected.searchParams.get("brand")).toBe("Round Lab");
    expect(selected.searchParams.get("cartPlan")).toBe(payload);
    expect(selectedHref!.length).toBeLessThanOrEqual(8192);
    await input.press("ArrowDown"); await suggestions.first().press("Enter");
    await expect(page).toHaveURL(selected.href);
    const back = page.getByRole("link", { name: labels.back, exact: true });
    const backHref = await back.getAttribute("href");
    expect(backHref).not.toBeNull();
    const backURL = new URL(backHref!, page.url());
    expect(backURL.pathname).toBe(`/${locale}/products`);
    expect(backURL.searchParams.get("q")).toBe("gallery");
    expect(backURL.searchParams.get("cartPlan")).toBe(payload);
    await back.press("Enter"); await expect(page).toHaveURL(backURL.href);
    await expect(input).toHaveValue("gallery");
    await input.fill("TEST ONLY"); await expect(suggestions).toHaveCount(matchCount);
    await expect(suggestions.filter({ hasText: `TEST ONLY ${locale} published item` })).toHaveCount(1);
    await input.fill("no-matching-web19-query"); await expect(suggestions).toHaveCount(0);
    await input.press("Enter"); // Actual native GET; no custom submit or app callback.
    await expect(page).toHaveURL(url => url.searchParams.get("q") === "no-matching-web19-query");
    expect(new URL(page.url()).searchParams.get("cartPlan")).toBe(payload);
    await expect(page.getByRole("heading", { name: labels.noResults, exact: true })).toBeVisible();
    expect(await page.evaluate(key => localStorage.getItem(key), CART_STORAGE_KEY)).toBeNull();
  });
}

test("[web19] current-page public pair and explicit Plan-to-Cart preview boundary", async ({ page }) => {
  const labels = storefrontLabels.en;
  await page.setViewportSize({ width: 1280, height: 900 });
  await visit(page, "/en/products?q=TEST+ONLY");
  const initial = await page.evaluate(key => localStorage.getItem(key), CART_STORAGE_KEY);
  expect(initial).toBeNull();
  const first = page.getByRole("checkbox", { name: `${labels.selectResultComparison}: TEST ONLY en published item`, exact: true });
  const second = page.getByRole("checkbox", { name: `${labels.selectResultComparison}: TEST ONLY en gallery item`, exact: true });
  await first.check(); await second.check();
  const compare = page.getByRole("button", { name: labels.compareSelectedResults, exact: true });
  await expect(compare).toBeEnabled(); await compare.press("Enter");
  await expect(page).toHaveURL(url => url.searchParams.get("compareFirst") === web19Product.publicId &&
    url.searchParams.get("compareSecond") === web19Gallery.publicId && url.hash === "#catalogue-comparison");
  const comparison = page.locator("#catalogue-comparison");
  await expect(comparison).toBeVisible();
  await expect(comparison).toBeFocused();
  await comparison.getByRole("button", { name: labels.planAddPair, exact: true }).press("Enter");
  await expect(page).toHaveURL(url => url.searchParams.has("cartPlan") && !url.searchParams.has("compareFirst"));
  const plan = page.getByRole("region", { name: labels.planHeading, exact: true });
  const line = plan.locator("li").filter({ has: page.getByRole("link", { name: "TEST ONLY en published item", exact: true }) });
  await line.getByRole("spinbutton", { name: `${labels.planQuantity}: TEST ONLY en published item`, exact: true }).fill("3");
  await line.getByRole("button", { name: labels.planSet, exact: true }).press("Enter");
  await expect(page).toHaveURL(url => {
    const state = readShoppingPlan(url.searchParams.get("cartPlan"), web19Public);
    return state.status === "ready" && state.lines.find(item => item.publicId === web19Product.publicId)?.quantity === 3;
  });
  expect(await page.evaluate(key => localStorage.getItem(key), CART_STORAGE_KEY)).toBe(initial);
  const review = plan.getByRole("link", { name: labels.planReviewCart, exact: true });
  const reviewHref = await review.getAttribute("href");
  expect(reviewHref).not.toBeNull();
  expect(new URL(reviewHref!, page.url()).searchParams.has("cartDraft")).toBe(true);
  await review.press("Enter"); await expect(page).toHaveURL(new URL(reviewHref!, "http://127.0.0.1:3101").href);
  await expect(page.getByRole("heading", { name: cartLabels.en.portablePreview, exact: true })).toBeVisible();
  await expect(page.getByRole("list", { name: cartLabels.en.portablePreview, exact: true })).toContainText("TEST ONLY en published item");
  expect(await page.evaluate(key => localStorage.getItem(key), CART_STORAGE_KEY)).toBe(initial);
  // Review is not acceptance/merge: no automatic Cart write is permitted.
});

test("[web19] gallery inspection eligibility, dialog Escape and launcher focus", async ({ page }) => {
  await page.setViewportSize({ width: 430, height: 900 });
  const labels = storefrontLabels.ko;
  let releaseImage: (() => void) | undefined;
  const imageGate = new Promise<void>(resolve => { releaseImage = () => resolve(); });
  await page.route("**/file.svg?gallery=1&locale=ko", async route => {
    await imageGate; await route.continue();
  });
  await page.route("**/file.svg?gallery=3&locale=ko", route =>
    route.fulfill({ status: 200, contentType: "image/svg+xml", body: "TEST ONLY corrupt web19 image" }));
  await page.goto(`/ko/products/${gallerySlug}`, { waitUntil: "domcontentloaded" });
  const gallery = page.getByRole("group", { name: labels.gallery, exact: true });
  const launcher = gallery.getByRole("button", { name: labels.inspectImage, exact: true });
  try { await expect(launcher).toBeDisabled(); }
  finally { releaseImage?.(); }
  const image = gallery.locator("img:not(noscript img)").first();
  expect(await image.evaluate(async node => { await (node as HTMLImageElement).decode(); return (node as HTMLImageElement).naturalWidth; })).toBeGreaterThan(0);
  await expect(launcher).toBeEnabled();
  await launcher.press("Enter");
  const dialog = page.getByRole("dialog", { name: `${labels.inspectImage}: TEST ONLY ko gallery first`, exact: true });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("button", { name: labels.closeImage, exact: true })).toBeFocused();
  await page.keyboard.press("Escape"); await expect(dialog).toBeHidden(); await expect(launcher).toBeFocused();
  const thumbs = gallery.locator("button[aria-pressed]");
  await expect(thumbs).toHaveCount(3);
  await thumbs.nth(1).press("Space"); await expect(thumbs.nth(1)).toHaveAttribute("aria-pressed", "true");
  await expect(launcher).toBeDisabled(); await expect(page.getByRole("dialog")).toHaveCount(0);
  await thumbs.nth(2).press("Enter"); await expect(thumbs.nth(2)).toHaveAttribute("aria-pressed", "true");
  await expect(launcher).toBeDisabled();
  await thumbs.first().press("Enter"); await expect(launcher).toBeEnabled();
  await expect(thumbs.first()).toBeFocused();
});

test.describe("[web19] no-JS inspection boundary", () => {
  test.use({ javaScriptEnabled: false });
  test("[web19] native first gallery image remains visible with no inert inspection controls", async ({ page }) => {
    await page.goto(`/en/products/${gallerySlug}`);
    const image = page.getByRole("group", { name: storefrontLabels.en.gallery, exact: true })
      .getByRole("img", { name: "TEST ONLY en gallery first", exact: true });
    await expect(image).toBeVisible();
    expect(await image.evaluate(async node => { await (node as HTMLImageElement).decode(); return (node as HTMLImageElement).naturalWidth; })).toBeGreaterThan(0);
    await expect(page.getByRole("group", { name: storefrontLabels.en.gallery, exact: true }).getByRole("button")).toHaveCount(0);
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });
});

test("[web19] strict detail Add confirms Cart readback and rejects alternate notation", async ({ page }) => {
  const cart = cartLabels.en;
  await visit(page, `/en/products/${publishedSlug}`);
  const add = page.getByRole("button", { name: cart.add, exact: true });
  const quantity = page.getByLabel(cart.quantity, { exact: true });
  const section = add.locator("xpath=ancestor::section[1]");
  const before = await page.evaluate(key => localStorage.getItem(key), CART_STORAGE_KEY);
  for (const raw of ["0", "1e2"]) {
    await quantity.fill(raw); await add.press("Enter");
    expect(await page.evaluate(key => localStorage.getItem(key), CART_STORAGE_KEY)).toBe(before);
    await expect(section).not.toContainText(cart.added);
  }
  await quantity.fill("2"); await add.press("Enter");
  await expect(section).toContainText(cart.added);
  expect(await page.evaluate(key => JSON.parse(localStorage.getItem(key)!), CART_STORAGE_KEY))
    .toEqual({ version: 1, lines: [{ publicId: web19Product.publicId, quantity: 2 }] });
  const header = page.locator("header");
  const cartLink = header.getByRole("link", { name: `${cart.cart}: ${cart.selectedQuantity} 2`, exact: true }).filter({ visible: true });
  if (page.viewportSize()!.width < 1024) await header.locator('[aria-controls="mobile-navigation"]').press("Enter");
  await expect(cartLink).toBeVisible(); await cartLink.press("Enter");
  await expect(page).toHaveURL("/en/cart");
  await expect(page.getByRole("spinbutton")).toHaveValue("2");
});

for (const mode of ["write-denied", "readback-denied"] as const) {
  test(`[web19] detail ${mode} never announces added or allows stale repeat mutation`, async ({ page }) => {
    // Per-test BrowserContext owns this fault. No OS/system clipboard or user data.
    await page.addInitScript(({ key, mode }) => {
      const get = Storage.prototype.getItem, set = Storage.prototype.setItem;
      let firstWrite = true, denyReadback = false;
      Storage.prototype.setItem = function (name, value) {
        if (name === key && firstWrite) {
          firstWrite = false;
          if (mode === "write-denied") throw new DOMException("TEST ONLY denied", "SecurityError");
          set.call(this, name, value); denyReadback = true; return;
        }
        set.call(this, name, value);
      };
      Storage.prototype.getItem = function (name) {
        if (name === key && denyReadback) { denyReadback = false; throw new DOMException("TEST ONLY readback denied", "SecurityError"); }
        return get.call(this, name);
      };
    }, { key: CART_STORAGE_KEY, mode });
    await visit(page, `/en/products/${publishedSlug}`);
    const add = page.getByRole("button", { name: cartLabels.en.add, exact: true });
    const section = add.locator("xpath=ancestor::section[1]");
    await add.press("Enter");
    await expect(section).toContainText(cartLabels.en.selectionWriteFailed);
    await expect(section).not.toContainText(cartLabels.en.added);
    await expect(add).toBeDisabled();
    const saved = await page.evaluate(key => localStorage.getItem(key), CART_STORAGE_KEY);
    await page.getByRole("button", { name: `${cartLabels.en.presetQuantity}: 2`, exact: true }).press("Enter");
    await expect(add).toBeDisabled();
    expect(await page.evaluate(key => localStorage.getItem(key), CART_STORAGE_KEY)).toBe(saved);
  });
}

test("[web19] explicit corrupt Cart reset failure then same-screen confirmed retry", async ({ page }) => {
  await page.addInitScript(key => {
    const set = Storage.prototype.setItem;
    set.call(localStorage, key, "TEST ONLY malformed cart");
    let deniedOnce = false;
    Storage.prototype.setItem = function (name, value) {
      if (name === key && !deniedOnce) { deniedOnce = true; throw new DOMException("TEST ONLY first reset denied", "SecurityError"); }
      set.call(this, name, value);
    };
  }, CART_STORAGE_KEY);
  await visit(page, "/en/cart");
  const cart = cartLabels.en;
  const reset = page.getByRole("button", { name: cart.reset, exact: true });
  await reset.press("Enter");
  await expect(page.getByRole("status").filter({ hasText: cart.selectionUnavailable })).toBeVisible();
  await expect(page.locator("main")).not.toContainText(cart.updated);
  await reset.press("Enter");
  await expect(page.getByRole("status").filter({ hasText: cart.updated })).toBeVisible();
  expect(await page.evaluate(key => JSON.parse(localStorage.getItem(key)!), CART_STORAGE_KEY)).toEqual({ version: 1, lines: [] });
  await expect(page.getByRole("searchbox", { name: cart.find, exact: true })).toBeEnabled();
  await expect(page.getByRole("link", { name: cart.browse, exact: true })).toBeFocused();
});

// Deliberate unresolved claims: these are not empty tests reported as PASS.
test.fixme("[web19] BLOCKED hydrated cross-page pair requires approved 13+ published fixture", async () => {
  // Existing fixture has four published records, PAGE_SIZE=12. No fixture edits authorized.
});
test.fixme("[web19] BLOCKED Location.assign exception uses existing synthetic-only evidence", async () => {
  // Native Location is not replaced or given production hooks for fault injection.
});
test.fixme("[web19] BLOCKED deferred Clipboard receipt needs separately reviewed owned instrumentation", async () => {
  // No real/system clipboard; do not introduce a global deferred Promise hook in A-stage.
});

// WEB #20 SOURCE ONLY until separate runtime approval. The opt-in owned runner
// selects the paginated fixture; base selectors and all three #19 fixmes remain.
type Web20Control = { writes: number; denyAfterWrite: boolean };
type Web20Clipboard = { calls: string[]; settle?: (reject: boolean) => void };
const web20First = journeyCatalogueProducts[0], web20Second = journeyCatalogueProducts[12];
const web20Lines = [{ publicId: web20First.publicId, quantity: 3 }, { publicId: web20Second.publicId, quantity: 1 }];

async function web20Seed(page: Page, populated = false) {
  await page.addInitScript(({ key, seed, favoritesKey, recentKey, favorites, recent }) => {
    const get = Storage.prototype.getItem, set = Storage.prototype.setItem;
    if (seed && get.call(localStorage, key) === null) set.call(localStorage, key, seed);
    if (favorites && get.call(localStorage, favoritesKey) === null) set.call(localStorage, favoritesKey, favorites);
    if (recent && get.call(localStorage, recentKey) === null) set.call(localStorage, recentKey, recent);
    const state = { writes: 0, denyAfterWrite: false };
    (window as unknown as { __web20Cart: Web20Control }).__web20Cart = state;
    Storage.prototype.getItem = function (name) {
      if (name === key && state.denyAfterWrite && state.writes > 0) throw new Error("TEST ONLY WEB20 readback denied");
      return get.call(this, name);
    };
    Storage.prototype.setItem = function (name, value) {
      if (this === localStorage && name === key) state.writes++;
      return set.call(this, name, value);
    };
  }, {
    key: CART_STORAGE_KEY,
    seed: populated ? JSON.stringify({ version: 1, lines: [{ publicId: web20First.publicId, quantity: 2 }] }) : null,
    favoritesKey: FAVORITES_STORAGE_KEY, recentKey: RECENT_STORAGE_KEY,
    favorites: populated ? serializeFavorites([web20First.publicId, web20Second.publicId]) : null,
    recent: populated ? serializeRecent([web20Second.publicId, web20First.publicId]) : null,
  });
}

for (const locale of storefrontLocales) {
  test(`[web20] paginated comparison to detail and locale Back ${locale}`, async ({ page }) => {
    const labels = storefrontLabels[locale], comparison = comparisonLabels[locale];
    await web20Seed(page);
    const query = new URLSearchParams({ q: "TEST ONLY JOURNEY", brand: "Round Lab", sort: "name-asc", withLocaleInfo: "1", withLocaleImage: "1" });
    await visit(page, `/${locale}/products?${query}`);
    const firstName = web20First.translations[locale].name;
    await page.getByRole("link", { name: `${labels.chooseFirstResult}: ${firstName}`, exact: true }).press("Enter");
    await expect(page).toHaveURL(url => url.searchParams.get("pickFirst") === web20First.publicId);
    const pages = page.getByRole("navigation", { name: labels.resultPages, exact: true });
    await pages.getByRole("link", { name: labels.nextPage, exact: true }).press("Enter");
    await expect(page).toHaveURL(url => url.searchParams.get("page") === "2" && url.searchParams.get("pickFirst") === web20First.publicId);
    await expect(page.locator("main li h2")).toHaveCount(2);
    await page.getByRole("link", { name: `${labels.chooseSecondResult}: ${web20Second.translations[locale].name}`, exact: true }).press("Enter");
    // CLOSED comparison URLs carry q/brand/sort, not presentation-only filters.
    await expect(page).toHaveURL(url => url.searchParams.get("compareFirst") === web20First.publicId && url.searchParams.get("compareSecond") === web20Second.publicId &&
      !url.searchParams.has("withLocaleInfo") && !url.searchParams.has("withLocaleImage"));
    const panel = page.locator("#catalogue-comparison");
    await expect(panel.getByRole("heading", { name: comparison.heading, exact: true })).toBeVisible();
    await panel.getByRole("link", { name: `${labels.details}: ${firstName}`, exact: true }).press("Enter");
    await expect(page.getByRole("heading", { level: 1, name: firstName, exact: true })).toBeVisible();
    await expect(page).toHaveURL(url => url.pathname === `/${locale}/products/${web20First.slug}` && url.searchParams.get("q") === "TEST ONLY JOURNEY" &&
      url.searchParams.get("compareFirst") === web20First.publicId && url.searchParams.get("compareSecond") === web20Second.publicId &&
      !url.searchParams.has("withLocaleInfo") && !url.searchParams.has("withLocaleImage"));
    const target = locale === "hu" ? "ko" : "hu";
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.locator("header").getByRole("link", { name: target === "hu" ? "Magyar" : "한국어", exact: true }).press("Enter");
    await expect(page).toHaveURL(url => url.pathname === `/${target}/products/${web20First.slug}` &&
      url.searchParams.get("compareFirst") === web20First.publicId && url.searchParams.get("compareSecond") === web20Second.publicId &&
      !url.searchParams.has("withLocaleInfo") && !url.searchParams.has("withLocaleImage"));
    await expect(page.getByRole("link", { name: comparisonLabels[target].backToComparison, exact: true })).toHaveAttribute("href",
      `/${target}/products?${new URLSearchParams({ q: "TEST ONLY JOURNEY", brand: "Round Lab", sort: "name-asc", compareFirst: web20First.publicId, compareSecond: web20Second.publicId })}#catalogue-comparison`);
    await page.getByRole("link", { name: storefrontLabels[target].back, exact: true }).press("Enter");
    await expect(page).toHaveURL(url => url.pathname === `/${target}/products` && url.searchParams.get("q") === "TEST ONLY JOURNEY" && url.searchParams.get("brand") === "Round Lab" && url.searchParams.get("sort") === "name-asc");
    expect(await page.evaluate(key => localStorage.getItem(key), CART_STORAGE_KEY)).toBeNull();
    await expect(page.locator('a[href*="test-only-journey-draft"]')).toHaveCount(0);
  });
}

for (const denied of [false, true]) test(`[web20] Plan to Cart explicit merge ${denied ? "readback refusal" : "confirmed once"}`, async ({ page }) => {
  const labels = storefrontLabels.en, cart = cartLabels.en;
  await web20Seed(page, true);
  const payload = portablePayload(web20Lines)!;
  await visit(page, `/en/products?${new URLSearchParams({ q: "TEST ONLY JOURNEY", cartPlan: payload })}`);
  const plan = page.getByRole("region", { name: labels.planHeading, exact: true });
  await plan.getByRole("link", { name: labels.planReviewCart, exact: true }).press("Enter");
  await expect(page.getByRole("heading", { name: cart.portablePreview, exact: true })).toBeVisible();
  expect(await page.evaluate(key => JSON.parse(localStorage.getItem(key)!), CART_STORAGE_KEY))
    .toEqual({ version: 1, lines: [{ publicId: web20First.publicId, quantity: 2 }] });
  expect(await page.evaluate(() => (window as unknown as { __web20Cart: Web20Control }).__web20Cart.writes)).toBe(0);
  const merge = page.getByRole("button", { name: cart.portableMerge, exact: true });
  await expect(merge).toBeEnabled();
  if (denied) await page.evaluate(() => { (window as unknown as { __web20Cart: Web20Control }).__web20Cart.denyAfterWrite = true; });
  await merge.press("Enter");
  await expect(merge).toBeDisabled();
  expect(await page.evaluate(() => (window as unknown as { __web20Cart: Web20Control }).__web20Cart.writes)).toBe(1);
  if (denied) {
    await expect(page.getByRole("status").filter({ hasText: cart.portableMerged })).toHaveCount(0);
    await page.evaluate(() => { (window as unknown as { __web20Cart: Web20Control }).__web20Cart.denyAfterWrite = false; });
    await expect(merge).toBeDisabled(); // Re-enabling reads cannot certify the earlier write.
  } else {
    await expect(page.getByRole("status").filter({ hasText: cart.portableMerged })).toHaveCount(1);
    expect(await page.evaluate(key => JSON.parse(localStorage.getItem(key)!), CART_STORAGE_KEY))
      .toEqual({ version: 1, lines: [{ publicId: web20First.publicId, quantity: 5 }, { publicId: web20Second.publicId, quantity: 1 }] });
  }
});

for (const width of [320, 375, 400]) test(`[web20] Korean catalogue heading keeps complete last word ${width}`, async ({ page }) => {
  await page.setViewportSize({ width, height: 900 });
  await visit(page, "/ko/products?q=TEST+ONLY+JOURNEY");
  await page.evaluate(() => document.fonts.ready);
  const heading = page.getByRole("heading", { level: 1, name: storefrontLabels.ko.heading, exact: true });
  await expect(heading).toBeVisible();
  const lines = await heading.evaluate(node => {
    const range = document.createRange(); range.selectNodeContents(node);
    return new Set([...range.getClientRects()].filter(rect => rect.width > 0).map(rect => Math.round(rect.top))).size;
  });
  expect(lines).toBe(1);
  await expect(heading).toHaveCSS("font-size", width < 375 ? "30px" : "36px");
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width + 1);
});

for (const mode of ["current", "reject", "filter"] as const) test(`[web20] owned deferred Search clipboard receipt ${mode}`, async ({ page }) => {
  const labels = storefrontLabels.en;
  await web20Seed(page);
  // This BrowserContext owns the fake. No system clipboard permission/read/write.
  await page.addInitScript(() => {
    const state: Web20Clipboard = { calls: [] };
    (window as unknown as { __web20Clipboard: Web20Clipboard }).__web20Clipboard = state;
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: {
      writeText(value: string) { state.calls.push(value); return new Promise<void>((resolve, reject) => {
        state.settle = failed => failed ? reject(new Error("TEST ONLY WEB20 clipboard denied")) : resolve();
      }); },
    } });
  });
  await visit(page, "/en/products?q=TEST+ONLY+JOURNEY&brand=Round+Lab");
  const copy = page.getByRole("button", { name: labels.copySearchLink, exact: true });
  await copy.press("Enter"); await expect(copy).toBeDisabled();
  expect(await page.evaluate(() => (window as unknown as { __web20Clipboard: Web20Clipboard }).__web20Clipboard.calls))
    .toEqual(["http://127.0.0.1:3101/en/products?q=TEST+ONLY+JOURNEY&brand=Round+Lab"]);
  if (mode === "filter") {
    await page.getByRole("region", { name: labels.activeFilters, exact: true })
      .getByRole("link", { name: `${labels.removeFilter}: ${labels.filterBrand}: Round Lab`, exact: true }).press("Enter");
    await expect(page).toHaveURL(url => !url.searchParams.has("brand"));
    // Next Link keeps the same owned context: if it does not, fail honestly.
    expect(await page.evaluate(() => (window as unknown as { __web20Clipboard: Web20Clipboard }).__web20Clipboard.calls.length)).toBe(1);
  }
  await page.evaluate(failed => (window as unknown as { __web20Clipboard: Web20Clipboard }).__web20Clipboard.settle!(failed), mode === "reject");
  if (mode === "filter") await page.evaluate(() => new Promise<void>(resolve => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  })); // Let the old receipt continuation and React render settle before a negative assertion.
  if (mode === "current") await expect(page.getByRole("status").filter({ hasText: labels.searchLinkCopied })).toHaveCount(1);
  else if (mode === "reject") await expect(page.getByRole("status").filter({ hasText: labels.searchLinkFailed })).toHaveCount(1);
  else await expect(page.getByRole("status").filter({ hasText: labels.searchLinkCopied })).toHaveCount(0);
  expect(await page.evaluate(key => localStorage.getItem(key), CART_STORAGE_KEY)).toBeNull();
});

for (const scenario of [
  { locale: "en", width: 320 }, { locale: "hu", width: 375 }, { locale: "ko", width: 390 },
  { locale: "hu", width: 430 }, { locale: "hu", width: 768 }, { locale: "ko", width: 1024 }, { locale: "en", width: 1280 },
] as const) test(`[web20] populated Plan comparison and Cart fit ${scenario.locale} ${scenario.width}`, async ({ page }) => {
  const { locale, width } = scenario, labels = storefrontLabels[locale], comparison = comparisonLabels[locale];
  await web20Seed(page, true); await page.setViewportSize({ width, height: 900 });
  await visit(page, `/${locale}/products?${new URLSearchParams({ q: "TEST ONLY JOURNEY", cartPlan: portablePayload(web20Lines)! })}`);
  await page.evaluate(() => document.fonts.ready);
  const plan = page.getByRole("region", { name: labels.planHeading, exact: true });
  await expect(plan).toBeVisible();
  await expect(plan.getByRole("spinbutton", { name: `${labels.planQuantity}: ${web20First.translations[locale].name}`, exact: true })).toHaveValue("3");
  const panel = page.locator("#catalogue-comparison");
  const firstPanel = panel.getByRole("link", { name: comparison.jumpFirst, exact: true });
  for (const region of [plan, panel]) {
    const box = await region.boundingBox(); expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(-1); expect(box!.x + box!.width).toBeLessThanOrEqual(width + 1);
  }
  const review = plan.getByRole("link", { name: labels.planReviewCart, exact: true });
  await review.scrollIntoViewIfNeeded(); const bounds = await review.boundingBox();
  expect(bounds!.height).toBeGreaterThanOrEqual(44);
  await review.press("Enter");
  await expect(page.getByRole("heading", { name: cartLabels[locale].portablePreview, exact: true })).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width + 1);
  expect(await page.evaluate(() => (window as unknown as { __web20Cart: Web20Control }).__web20Cart.writes)).toBe(0);
  await page.goBack();
  await expect(plan).toBeVisible();
  await firstPanel.press("Enter");
  const target = await firstPanel.getAttribute("href");
  await expect(panel.locator(target!)).toBeFocused();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width + 1);
});

// WEB23 opt-in only: authored evidence scenarios, NOT a claim of Browser PASS.
// One project avoids duplicating each explicit viewport on both configured projects.
const web23Widths = [
  { locale: "en", width: 320 }, { locale: "hu", width: 375 }, { locale: "ko", width: 390 },
  { locale: "ko", width: 400 }, { locale: "hu", width: 430 }, { locale: "hu", width: 768 },
  { locale: "ko", width: 1024 }, { locale: "en", width: 1280 },
] as const;

async function web23NoOverflow(page: Page) {
  await page.evaluate(() => document.fonts.ready);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(page.viewportSize()!.width + 1);
}

/** Observe actual focus, clipping ancestors and header occlusion; no CSS goldens. */
async function web23FocusVisible(page: Page, suggestion = false) {
  await expect.poll(() => page.evaluate(checkOutline => {
    const active = document.activeElement;
    if (!(active instanceof HTMLElement)) return false;
    const box = active.getBoundingClientRect();
    const header = document.querySelector("header")?.getBoundingClientRect();
    if (box.width <= 0 || box.height <= 0 || box.left < -1 || box.right > innerWidth + 1 ||
      box.top < (header?.bottom ?? 0) - 1 || box.bottom > innerHeight + 1) return false;
    for (let parent = active.parentElement; parent; parent = parent.parentElement) {
      const style = getComputedStyle(parent), rect = parent.getBoundingClientRect();
      if (/(auto|scroll|hidden|clip)/.test(style.overflowY) &&
        (box.top < rect.top - 1 || box.bottom > rect.bottom + 1)) return false;
      if (/(auto|scroll|hidden|clip)/.test(style.overflowX) &&
        (box.left < rect.left - 1 || box.right > rect.right + 1)) return false;
    }
    const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
    if (!hit || !active.contains(hit)) return false;
    const style = getComputedStyle(active);
    return !checkOutline || (style.outlineStyle !== "none" && parseFloat(style.outlineWidth) >= 2 &&
      parseFloat(style.outlineOffset) <= -parseFloat(style.outlineWidth));
  }, suggestion)).toBe(true);
}

for (const scenario of web23Widths) test(`[web23] expanded suggestions remain operable ${scenario.locale} ${scenario.width}`, async ({ page }) => {
  const { locale, width } = scenario, labels = storefrontLabels[locale];
  await page.setViewportSize({ width, height: 900 });
  await web20Seed(page, true);
  const payload = portablePayload(web20Lines)!;
  await visit(page, `/${locale}/products?${new URLSearchParams({ cartPlan: payload })}`);
  const form = page.getByRole("search", { name: labels.searchProducts, exact: true });
  const input = form.getByRole("searchbox", { name: labels.searchProducts, exact: true });
  const brand = form.getByRole("combobox", { name: labels.filterBrand, exact: true });
  const sort = form.getByRole("combobox", { name: labels.sortBy, exact: true });
  await page.evaluate(() => document.fonts.ready);
  const before = await Promise.all([input.boundingBox(), brand.boundingBox(), sort.boundingBox()]);
  await input.fill("TEST ONLY JOURNEY");
  const suggestions = form.getByRole("list", { name: searchSuggestionLabels[locale].heading, exact: true });
  const links = suggestions.locator("a[data-search-suggestion]");
  await expect(links).toHaveCount(5);
  await expect(links.first()).toContainText(journeyCatalogueProducts[0].translations[locale].name);
  const after = await Promise.all([input.boundingBox(), brand.boundingBox(), sort.boundingBox()]);
  await test.info().attach("search-controls-before-after.json", {
    body: JSON.stringify({ locale, width, before, after }), contentType: "application/json",
  }); // Movement itself is allowed; reachability/occlusion is the contract.
  for (const boxes of [before, after]) for (const box of boxes) {
    expect(box).not.toBeNull();
    expect(box!.width).toBeGreaterThan(0);
    expect(box!.x).toBeGreaterThanOrEqual(-1);
    expect(box!.x + box!.width).toBeLessThanOrEqual(width + 1);
  }
  await web23NoOverflow(page);
  // Native focus scrolling must expose the full first/middle/last result.
  await input.press("ArrowDown");
  for (let index = 0; index < 5; index++) {
    await expect(links.nth(index)).toBeFocused();
    await web23FocusVisible(page, true);
    if (index < 4) await links.nth(index).press("ArrowDown");
  }
  await links.last().press("ArrowUp");
  await expect(links.nth(3)).toBeFocused();
  await links.nth(3).press("Escape");
  await expect(input).toBeFocused();
  await expect(input).toHaveValue("TEST ONLY JOURNEY");
  await expect(suggestions).toBeHidden();
  // Reopen, then Tab naturally leaves the five links for native Brand/Sort.
  await input.fill("TEST ONLY JOURNEY ");
  await input.press("ArrowDown");
  for (let index = 0; index < 5; index++) await page.keyboard.press("Tab");
  await expect(brand).toBeFocused();
  await web23FocusVisible(page);
  await brand.selectOption("Round Lab");
  await brand.press("Tab");
  await expect(sort).toBeFocused();
  await web23FocusVisible(page);
  await sort.selectOption("name-desc");
  await form.getByRole("button", { name: labels.apply, exact: true }).press("Enter");
  await expect(page).toHaveURL(url => url.pathname === `/${locale}/products` &&
    url.searchParams.get("q")?.trim() === "TEST ONLY JOURNEY" && url.searchParams.get("brand") === "Round Lab" &&
    url.searchParams.get("sort") === "name-desc" && url.searchParams.get("cartPlan") === payload);
  await web23NoOverflow(page);
});

test("[web23] populated discovery keeps first Search and focus across breakpoints", async ({ page }) => {
  const labels = storefrontLabels.en;
  await page.setViewportSize({ width: 375, height: 900 });
  await web20Seed(page, true);
  await visit(page, "/en/brands");
  const toggle = page.locator('[aria-controls="mobile-navigation"]');
  await toggle.press("Enter");
  await page.locator("#mobile-navigation").getByRole("link", { name: labels.search, exact: true }).press("Enter");
  await expect(page).toHaveURL("http://127.0.0.1:3101/en/products#catalogue-search");
  const input = page.getByRole("searchbox", { name: labels.searchProducts, exact: true });
  await expect(input).toBeInViewport();
  await input.fill("TEST ONLY JOURNEY");
  const suggestions = page.getByRole("search", { name: labels.searchProducts, exact: true })
    .getByRole("list", { name: searchSuggestionLabels.en.heading, exact: true });
  const links = suggestions.locator("a[data-search-suggestion]");
  await expect(links).toHaveCount(5);
  await input.press("ArrowDown");
  await expect(links.first()).toBeFocused();
  await web23FocusVisible(page, true);
  await toggle.click();
  await page.locator("#mobile-navigation").getByRole("link", { name: labels.home, exact: true }).focus();
  await page.setViewportSize({ width: 1024, height: 900 });
  await expect(page.getByRole("navigation", { name: labels.primaryNavigation, exact: true })
    .getByRole("link", { name: labels.shop, exact: true })).toBeFocused();
  await expect(page.locator("#mobile-navigation")).toBeHidden();
  await page.setViewportSize({ width: 375, height: 900 });
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  // Breakpoint changes must not discard typed search or populated session data.
  await expect(input).toHaveValue("TEST ONLY JOURNEY");
  await input.focus(); await input.press("ArrowDown");
  await web23FocusVisible(page, true);
  await web23NoOverflow(page);
  expect(await page.evaluate(key => JSON.parse(localStorage.getItem(key)!).ids.length, FAVORITES_STORAGE_KEY)).toBe(2);
});

test("[web23] HU320 saved and recent history restores Plan and public identity across locale", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 900 });
  const hiddenId = "81999999-abcd-1234-abcd-123456789abc";
  const favorites = serializeFavorites([web20First.publicId, web20Second.publicId, hiddenId]);
  const recent = serializeRecent([web20Second.publicId, web20First.publicId, hiddenId]);
  await page.addInitScript(({ favoriteKey, recentKey, favorites, recent }) => {
    if (localStorage.getItem(favoriteKey) === null) localStorage.setItem(favoriteKey, favorites);
    if (localStorage.getItem(recentKey) === null) localStorage.setItem(recentKey, recent);
  }, { favoriteKey: FAVORITES_STORAGE_KEY, recentKey: RECENT_STORAGE_KEY, favorites, recent });
  const payload = portablePayload(web20Lines)!;
  const path = `/hu/products?${new URLSearchParams({ q: "TEST ONLY JOURNEY", brand: "Round Lab", sort: "name-desc", cartPlan: payload })}`;
  await visit(page, path);
  for (const [heading, product] of [
    [favoriteLabels.hu.heading, web20First], ["Legutóbb megtekintett termékek", web20Second],
  ] as const) {
    const region = page.getByRole("region", { name: heading, exact: true });
    const link = region.getByRole("link", { name: product.translations.hu.name, exact: true });
    // CLOSED saved/recent links intentionally use clean detail URLs. History Back,
    // rather than inventing a new href contract, must restore the listing context.
    await expect(link).toHaveAttribute("href", `/hu/products/${product.slug}`);
    await link.press("Enter");
    await expect(page.getByRole("heading", { level: 1, name: product.translations.hu.name, exact: true })).toBeVisible();
    await page.goBack();
    await expect(page).toHaveURL(`http://127.0.0.1:3101${path}`);
    await expect(page.getByRole("region", { name: storefrontLabels.hu.planHeading, exact: true })).toBeVisible();
    // Exercise keyboard access after history restore; no undocumented automatic
    // focus-restoration promise for Next history is imposed by this test.
    await region.getByRole("link", { name: product.translations.hu.name, exact: true }).press("Tab");
    await web23FocusVisible(page);
    await expect(page.locator('main a[href*="test-only-journey-draft"]')).toHaveCount(0);
  }
  const toggle = page.locator('[aria-controls="mobile-navigation"]');
  await toggle.click();
  await page.locator("#mobile-navigation").getByRole("link", { name: "한국어", exact: true }).press("Enter");
  await expect(page).toHaveURL(url => url.pathname === "/ko/products" && url.searchParams.get("cartPlan") === payload &&
    url.searchParams.get("q") === "TEST ONLY JOURNEY" && url.searchParams.get("brand") === "Round Lab" && url.searchParams.get("sort") === "name-desc");
  await expect(page.getByRole("region", { name: favoriteLabels.ko.heading, exact: true })).toBeVisible();
  expect(await page.evaluate(key => localStorage.getItem(key), FAVORITES_STORAGE_KEY)).toBe(favorites);
  expect(await page.evaluate(key => JSON.parse(localStorage.getItem(key)!), RECENT_STORAGE_KEY))
    .toEqual({ version: 1, ids: [web20Second.publicId, web20First.publicId, hiddenId] });
  await expect(page.locator('main a[href*="test-only-journey-draft"]')).toHaveCount(0);
  await web23NoOverflow(page);
});

for (const change of ["locale", "route"] as const) test(`[web23] owned pending clipboard expires on ${change}`, async ({ page }) => {
  await page.setViewportSize({ width: 430, height: 900 });
  const labels = storefrontLabels.ko;
  await page.addInitScript(() => {
    const state = { calls: [] as string[], settle: undefined as undefined | (() => void), done: false };
    (window as unknown as { __web23Clipboard: typeof state }).__web23Clipboard = state;
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: {
      writeText(value: string) {
        state.calls.push(value);
        const deferred = new Promise<void>(resolve => { state.settle = resolve; });
        void deferred.then(() => { state.done = true; });
        return deferred;
      },
    } });
  });
  type Clipboard = { calls: string[]; settle?: () => void; done: boolean };
  const read = () => page.evaluate(() => (window as unknown as { __web23Clipboard: Clipboard }).__web23Clipboard);
  await visit(page, "/ko/products?q=TEST+ONLY+JOURNEY&brand=Round+Lab");
  const copy = page.getByRole("button", { name: labels.copySearchLink, exact: true });
  await copy.press("Enter"); await expect(copy).toBeDisabled();
  const original = "http://127.0.0.1:3101/ko/products?q=TEST+ONLY+JOURNEY&brand=Round+Lab";
  expect((await read()).calls).toEqual([original]);
  const toggle = page.locator('[aria-controls="mobile-navigation"]');
  await toggle.click();
  const mobile = page.locator("#mobile-navigation");
  await mobile.getByRole("link", { name: change === "locale" ? "Magyar" : labels.brands, exact: true }).press("Enter");
  await expect(page).toHaveURL(url => url.pathname === (change === "locale" ? "/hu/products" : "/ko/brands"));
  // Require the SAME document-owned fake to survive client navigation. A new
  // context/reset fake cannot accidentally stand in for the original promise.
  expect((await read()).calls).toEqual([original]);
  await page.evaluate(() => { (window as unknown as { __web23Clipboard: Clipboard }).__web23Clipboard.settle!(); });
  await expect.poll(async () => (await read()).done).toBe(true);
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  for (const locale of storefrontLocales) {
    await expect(page.getByRole("status").filter({ hasText: storefrontLabels[locale].searchLinkCopied })).toHaveCount(0);
  }
  expect((await read()).calls).toEqual([original]);
  expect(await page.evaluate(key => localStorage.getItem(key), CART_STORAGE_KEY)).toBeNull();
});

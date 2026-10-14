import { test as base, expect, type Page } from "@playwright/test";
import { storefrontLabels, storefrontLocales } from "../../lib/storefront/localization";
import { marketingCopy } from "../../lib/storefront/marketing-copy";
import { publishedSlug, draftSlug, missingLocaleSlug, gallerySlug, textOnlySlug } from "./published-catalogue-fixtures.mjs";
import { cartLabels } from "../../lib/cart/labels";
import { CART_STORAGE_KEY } from "../../lib/cart/cart-state";

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
    const media = page.locator("article > div").first();
    const buttons = media.getByRole("button");
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
    await expect(page.locator("article > div").first().getByRole("button")).toHaveCount(0);
    await visit(page, `/${locale}/products/${textOnlySlug}`);
    await expect(page.locator("article").getByRole("img")).toHaveCount(0);
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
      const image = page.getByRole("img", { name: `TEST ONLY ${locale} gallery first`, exact: true });
      await expect(image).toBeVisible();
      expect(await image.evaluate(async node => { await (node as HTMLImageElement).decode(); return (node as HTMLImageElement).naturalWidth; })).toBeGreaterThan(0);
      await expect(page.locator("article > div").first().getByRole("button")).toHaveCount(0);
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

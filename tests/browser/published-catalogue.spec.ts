import { test as base, expect, type Page } from "@playwright/test";
import { storefrontLabels, storefrontLocales } from "../../lib/storefront/localization";
import { marketingCopy } from "../../lib/storefront/marketing-copy";
import { publishedSlug, draftSlug, missingLocaleSlug } from "./published-catalogue-fixtures.mjs";
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

for (const locale of storefrontLocales) {
  const labels = storefrontLabels[locale];
  const cart = cartLabels[locale];
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

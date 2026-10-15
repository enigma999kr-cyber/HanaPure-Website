import { test as base, expect, type Page } from "@playwright/test";
import { storefrontLabels, storefrontLocales } from "../../lib/storefront/localization";
import { marketingCopy } from "../../lib/storefront/marketing-copy";
import { cartLabels } from "../../lib/cart/labels";

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

test("draft preview production isolation: no preview route or draft data in public storefront/SEO/cart", async ({ page }) => {
  const slug = "test-only-private-draft-preview";
  const marker = "TEST ONLY PRIVATE DRAFT PREVIEW";
  for (const root of ["", "/en", "/hu", "/ko"]) {
    for (const path of [`${root}/draft-preview`, `${root}/draft/0`, `${root}/products/${slug}`, `${root}/products/${slug}-0`, `${root}/products/${slug}-1`]) {
      const response = await page.goto(path); expect(response?.status()).toBe(404);
      expect(await response!.text()).not.toContain(`${marker} en`);
      expect(await response!.text()).not.toMatch(/TEST ONLY PRIVATE DRAFT PREVIEW [01] (en|hu|ko)/);
    }
    for (const path of [`${root}/products?q=${encodeURIComponent(marker)}&brand=beplain&sort=name-asc`, `${root}/brands`, `${root}/cart`]) {
      const response = await page.goto(path); expect(response?.status()).toBe(200);
      expect(await response!.text()).not.toContain(`${marker} en`);
      expect(await page.locator("body").textContent()).not.toContain(slug);
    }
  }
  for (const path of ["/sitemap.xml", "/robots.txt"]) {
    const response = await page.request.get(path); expect(response.status()).toBe(200);
    expect(await response.text()).not.toContain(slug);
  }
});

for (const routeLocale of [null, ...storefrontLocales]) for (const javaScriptEnabled of [true, false]) {
  const locale = routeLocale ?? "en";
  const labels = storefrontLabels[locale];
  const root = routeLocale ? `/${routeLocale}` : "";
  const paths = [root || "/", `${root}/products`, `${root}/brands`, `${root}/cart`];
  test.describe(`${routeLocale ?? "legacy"}: Footer JS ${javaScriptEnabled}`, () => {
    test.use({ javaScriptEnabled });
    test("public routes have one accessible Footer; invalid destinations have none", async ({ page }) => {
      for (const path of paths) {
        expect((await page.goto(path))?.status()).toBe(200);
        const footer = page.getByRole("contentinfo", { name: "HanaPure", exact: true });
        await expect(footer).toHaveCount(1);
        await expect(page.locator("main footer")).toHaveCount(0);
        const links = footer.getByRole("navigation", { name: "HanaPure", exact: true }).getByRole("link");
        await expect(links).toHaveText([labels.home, labels.shop, labels.brands, cartLabels[locale].cart]);
        for (let index = 0; index < paths.length; index++) await expect(links.nth(index)).toHaveAttribute("href", paths[index]);
        await links.first().focus(); await page.keyboard.press("Tab");
        await expect(links.nth(1)).toBeFocused();
        await expect(links.nth(1)).toHaveCSS("outline-style", "solid");
        await page.keyboard.press("Enter");
        await expect(page).toHaveURL(`${root}/products`);
        await noOverflow(page);
      }
      for (const path of [`${root}/unknown-footer-route`, `${root}/products/unknown-footer-item`, "/fr"]) {
        expect((await page.goto(path))?.status()).toBe(404);
        await expect(page.getByRole("contentinfo")).toHaveCount(0);
      }
    });
  });
}

for (const routeLocale of [null, ...storefrontLocales]) {
  const locale = routeLocale ?? "en";
  const labels = storefrontLabels[locale];
  const href = (path: string) => routeLocale ? `/${routeLocale}${path === "/" ? "" : path}` : path;
  test(`${routeLocale ?? "legacy"}: discovery entry Search preserves menu, focus and browse query`, async ({ page }) => {
    const query = new URLSearchParams({ q: "테스트 & cleanser", brand: "Round Lab" }).toString();
    for (const path of [href("/"), href("/brands"), href("/cart"), `${href("/products")}?${query}`]) {
      await visit(page, path);
      const mobile = page.viewportSize()!.width < 1024;
      if (mobile) {
        const toggle = page.locator('[aria-controls="mobile-navigation"]');
        await toggle.press("Enter"); await page.keyboard.press("Escape");
        await expect(toggle).toBeFocused(); await toggle.press("Space");
      }
      const searchLink = page.locator("header").getByRole("link", { name: labels.search, exact: true }).filter({ visible: true });
      const suffix = path.includes("?") ? `?${query}` : "";
      await expect(searchLink).toHaveAttribute("href", `${href("/products")}${suffix}#catalogue-search`);
      await searchLink.press("Enter");
      await expect(page).toHaveURL(`${href("/products")}${suffix}#catalogue-search`);
      await expect(page.locator('[aria-controls="mobile-navigation"]')).toHaveAttribute("aria-expanded", "false");
      const input = page.getByRole("searchbox", { name: labels.searchProducts, exact: true });
      await expect(input).toBeFocused();
      await expect(input).toHaveValue(suffix ? "테스트 & cleanser" : "");
      const box = await input.boundingBox(); expect(box!.y).toBeGreaterThanOrEqual(80);
      await page.keyboard.press("Tab");
      await expect(page.getByLabel(labels.filterBrand, { exact: true })).toBeFocused();
      await noOverflow(page);
    }
  });
  test(`${routeLocale ?? "legacy"}: homepage action integrity and existing navigation`, async ({ page }) => {
    await visit(page, href("/"));
    const hero = page.locator("main > section").first();
    await expect(hero.getByRole("button")).toHaveCount(0);
    await expect(hero).not.toContainText(marketingCopy[locale].hero.routine);
    const shop = hero.getByRole("link", { name: marketingCopy[locale].hero.shop, exact: true });
    await expect(shop).toHaveAttribute("href", href("/products"));
    const header = page.locator("header");
    for (const text of ["Skin Concerns", "Best Sellers", "New Arrivals", "Why HanaPure"]) {
      await expect(header).not.toContainText(text);
    }
    const mobile = page.viewportSize()!.width < 1024;
    if (!mobile) {
      await expect(header.getByRole("navigation", { name: labels.primaryNavigation }).getByRole("link"))
        .toHaveText([labels.shop, labels.brands]);
      await expect(header.getByRole("link", { name: labels.search, exact: true }))
        .toHaveAttribute("href", `${href("/products")}#catalogue-search`);
    }
    await noOverflow(page);
    await shop.focus();
    await page.keyboard.press("Shift+Tab");
    if (mobile) await expect(header.locator('[aria-controls="mobile-navigation"]')).toBeFocused();
    else await expect(header.locator(`a[href="${href("/cart")}"]`).filter({ visible: true })).toBeFocused();
    await shop.focus(); await page.keyboard.press("Enter");
    await expect(page).toHaveURL(href("/products"));
    if (mobile) await page.locator('[aria-controls="mobile-navigation"]').press("Enter");
    await header.getByRole("link", { name: labels.brands, exact: true }).filter({ visible: true }).press("Enter");
    await expect(page).toHaveURL(href("/brands"));
    if (mobile) await page.locator('[aria-controls="mobile-navigation"]').press("Enter");
    await header.locator(`a[href="${href("/cart")}"][aria-label]`).filter({ visible: true }).press("Enter");
    await expect(page).toHaveURL(href("/cart"));
    if (mobile) await page.locator('[aria-controls="mobile-navigation"]').press("Enter");
    const target = locale === "hu" ? "en" : "hu";
    await header.getByRole("link", { name: target === "en" ? "English" : "Magyar", exact: true }).filter({ visible: true }).press("Enter");
    await expect(page).toHaveURL(`/${target}/cart`);
    await noOverflow(page);
  });
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

  test(`${locale}: Brands empty published catalogue does not expose candidate navigation`, async ({ page }) => {
    await visit(page, `/${locale}`);
    for (const name of ["Round Lab", "Anua", "SKIN1004"]) {
      const card = page.getByRole("article").filter({ has: page.getByRole("heading", { name, exact: true }) });
      await expect(card).toBeVisible();
      await expect(card.getByRole("link")).toHaveCount(0);
      await expect(card.locator(".min-h-5")).toHaveCSS("min-height", "20px");
    }
    await noOverflow(page);
    await visit(page, `/${locale}/brands`);
    const section = page.getByRole("region", { name: directory.browse, exact: true });
    const search = page.getByRole("searchbox", { name: directory.searchLabel });
    await expect(section.getByRole("listitem")).toHaveCount(0);
    await expect(section.getByRole("link")).toHaveCount(0);
    await expect(section.getByRole("heading", { name: labels.empty, exact: true })).toBeVisible();
    await expect(section.getByRole("button", { name: "R", exact: true })).toBeDisabled();
    await noOverflow(page);
    await search.fill("round");
    await expect(section.getByRole("listitem")).toHaveCount(0);
    await search.fill("zzzz-no-such-brand");
    await expect(section.getByRole("heading", { name: labels.empty, exact: true })).toBeVisible();
    await expect(section.getByRole("listitem")).toHaveCount(0);
    await search.fill("");
    await section.getByRole("button", { name: directory.all, exact: true }).press("Enter");
    await expect(section.getByRole("listitem")).toHaveCount(0);
    await noOverflow(page);
  });

  test(`${locale}: native GET apply/reset and locale query preservation`, async ({ page }) => {
    // A historical brand URL stays explicit even without published products.
    await visit(page, `/${locale}/products?brand=Dr.+Althea`);
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

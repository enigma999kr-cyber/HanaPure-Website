import assert from "node:assert/strict";
import test from "node:test";
import { registerHooks } from "node:module";
import { isStorefrontLocale, localeFromPath, storefrontHref, switchLocalePath, storefrontLabels } from "../lib/storefront/localization.ts";
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "next/navigation") return nextResolve("next/dist/client/components/navigation.react-server.js", context);
    return nextResolve(specifier, context);
  },
});
const { requireStorefrontLocale } = await import("../lib/storefront/require-locale.ts");

test("supported locale validation is exact; invalid route locales use notFound", () => {
  for (const locale of ["en", "hu", "ko"]) assert.equal(requireStorefrontLocale(locale), locale);
  for (const locale of ["fr", "HU", "__proto__", "", "en-US"]) {
    assert.equal(isStorefrontLocale(locale), false);
    assert.throws(() => requireStorefrontLocale(locale), (error) => error.digest === "NEXT_HTTP_ERROR_FALLBACK;404");
  }
});

test("switching from legacy and localized routes preserves logical destination and product slug", () => {
  for (const locale of ["en", "hu", "ko"]) {
    for (const path of ["/", "/brands", "/products", "/products/unchanged-slug"]) {
      const expected = storefrontHref(path, locale);
      assert.equal(switchLocalePath(path, locale), expected);
      for (const current of ["en", "hu", "ko"]) assert.equal(switchLocalePath(storefrontHref(path, current), locale), expected);
    }
    assert.equal(switchLocalePath("/hu/products/unchanged-slug?view=all#usage", locale), `/${locale}/products/unchanged-slug?view=all#usage`);
    assert.equal(switchLocalePath("//evil.invalid", locale), `/${locale}`);
    assert.equal(switchLocalePath("/fr/products", locale), `/${locale}`);
  }
});

test("legacy navigation remains English-compatible while localized links keep locale", () => {
  assert.equal(localeFromPath("/products"), null);
  assert.equal(storefrontHref("/products", null), "/products");
  for (const locale of ["en", "hu", "ko"]) {
    assert.equal(localeFromPath(`/${locale}/products/slug`), locale);
    assert.equal(storefrontHref("/brands", locale), `/${locale}/brands`);
    assert.equal(storefrontHref("/", locale), `/${locale}`);
    assert.deepEqual(Object.keys(storefrontLabels[locale]), Object.keys(storefrontLabels.en));
  }
});

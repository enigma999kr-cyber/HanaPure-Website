import assert from "node:assert/strict";
import { registerHooks, createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";
import ts from "typescript";
import { marketingCopy } from "../lib/storefront/marketing-copy.ts";
import { brandNames } from "../data/brands.ts";

// Same installed TypeScript/React loader convention as catalogue-storefront tests.
const require = createRequire(import.meta.url);
const repo = dirname(dirname(fileURLToPath(import.meta.url)));
const reactRoot = dirname(require.resolve("react/package.json"));
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "react") return { url: pathToFileURL(join(reactRoot, "index.js")).href, shortCircuit: true };
    if (specifier === "react-dom") return { url: pathToFileURL(join(dirname(require.resolve("react-dom/package.json")), "index.js")).href, shortCircuit: true };
    if (specifier === "react/jsx-runtime") return { url: pathToFileURL(join(reactRoot, "jsx-runtime.js")).href, shortCircuit: true };
    if (specifier === "next/link") return nextResolve("next/link.js", context);
    if (specifier === "next/navigation") return nextResolve("next/navigation.js", context);
    if (specifier.startsWith("@/")) specifier = pathToFileURL(join(repo, specifier.slice(2))).href;
    try { return nextResolve(specifier, context); }
    catch (error) {
      if (error.code !== "ERR_MODULE_NOT_FOUND") throw error;
      for (const extension of [".ts", ".tsx"]) {
        try { return nextResolve(`${specifier}${extension}`, context); } catch { /* Next extension. */ }
      }
      throw error;
    }
  },
  load(url, context, nextLoad) {
    if (url.endsWith(".tsx")) return { format: "module", shortCircuit: true,
      source: ts.transpileModule(readFileSync(fileURLToPath(url), "utf8"), {
        compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
      }).outputText };
    return nextLoad(url, context);
  },
});
const { renderToStaticMarkup } = await import(pathToFileURL(join(dirname(require.resolve("react-dom/package.json")), "server.node.js")).href);
const { default: Header } = await import("../components/layout/Header.tsx");
const { default: Home } = await import("../app/page.tsx");
const { default: Brands } = await import("../app/brands/page.tsx");
const { default: LocalizedHome } = await import("../app/[locale]/page.tsx");
const { default: LocalizedBrands } = await import("../app/[locale]/brands/page.tsx");

// Header pathname hooks belong to Next's browser router; its unchanged behavior
// is covered separately. Render the actual body, including the real BrandDirectory.
function body(element) {
  const main = element.type(element.props);
  return { ...main, props: { ...main.props,
    children: main.props.children.filter(child => child?.type !== Header) } };
}
const render = element => renderToStaticMarkup(body(element));

test("actual EN/HU/KO Home and Brands routes render their selected body and directory labels", async () => {
  for (const locale of ["en", "hu", "ko"]) {
    const props = { params: Promise.resolve({ locale }) };
    const home = render(await LocalizedHome(props));
    const brands = render(await LocalizedBrands(props));
    const copy = marketingCopy[locale];
    assert.ok(home.includes(`lang="${locale}"`));
    assert.ok(brands.includes(`lang="${locale}"`));
    for (const value of [copy.hero.heading, copy.hero.description, copy.hero.shop, copy.hero.routine,
      ...copy.hero.trust, copy.featured.eyebrow, copy.featured.heading, copy.featured.headingEnd,
      copy.featured.description, copy.featured.discover, ...[copy.featured.roundLab, copy.featured.anua, copy.featured.skin1004].flatMap(item => [item.tagline, item.description]),
      copy.why.heading, copy.why.description, ...copy.why.points.flatMap(item => [item.title, item.description])]) {
      assert.ok(home.includes(value), `${locale} missing body string: ${value}`);
    }
    for (const value of [copy.brands.heading, copy.brands.description, copy.directory.browse,
      copy.directory.searchLabel, copy.directory.searchPlaceholder, copy.directory.filterLabel,
      copy.directory.alphabet, copy.directory.all, copy.directory.resultMany.replace("{count}", "16")]) {
      assert.ok(brands.includes(value), `${locale} missing directory string: ${value}`);
    }
    for (const brand of brandNames) assert.ok(brands.includes(`>${brand}</li>`), brand);
    assert.equal((brands.match(/aria-pressed=/g) ?? []).length, 27);
    assert.ok(home.includes('href="#"')); // Existing CTA policy was not implemented.
    assert.equal((home.match(/<button/g) ?? []).length, 2);
    if (locale !== "en") {
      assert.ok(!home.includes(marketingCopy.en.hero.heading));
      assert.ok(!brands.includes(marketingCopy.en.directory.searchLabel));
    }
  }
});

test("legacy routes retain the same English body as EN routes and source claims", async () => {
  assert.equal(render(Home()), render(await LocalizedHome({ params: Promise.resolve({ locale: "en" }) })));
  assert.equal(render(Brands()), render(await LocalizedBrands({ params: Promise.resolve({ locale: "en" }) })));
  assert.ok(render(Home()).includes("Feel confident in your skin."));
  assert.ok(render(Brands()).includes("16 brands found"));
  for (const route of [LocalizedHome, LocalizedBrands]) {
    await assert.rejects(route({ params: Promise.resolve({ locale: "fr" }) }), error => error.digest === "NEXT_HTTP_ERROR_FALLBACK;404");
  }
});

test("marketing locales expose the same complete string structure, including zero-results and count patterns", () => {
  function leaves(value, prefix = "") {
    return typeof value === "string" ? [[prefix, value]] : Object.entries(value).flatMap(([key, child]) => leaves(child, `${prefix}.${key}`));
  }
  const keys = leaves(marketingCopy.en).map(([key]) => key);
  for (const locale of ["en", "hu", "ko"]) {
    assert.deepEqual(leaves(marketingCopy[locale]).map(([key]) => key), keys);
    for (const [, text] of leaves(marketingCopy[locale])) assert.ok(text.trim());
    for (const count of [0, 1, 16]) {
      const labels = marketingCopy[locale].directory;
      assert.ok((count === 1 ? labels.resultOne : labels.resultMany).replace("{count}", String(count)).includes(String(count)));
    }
  }
});

import assert from "node:assert/strict";
import test from "node:test";
import { request } from "node:http";
import { registerHooks } from "node:module";
import { spawnSync } from "node:child_process";
import { networkInterfaces, tmpdir } from "node:os";
import { mkdtempSync, writeFileSync, rmSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { chromium } from "@playwright/test";
import { startDraftPreview } from "../scripts/editorial-draft-preview.mjs";
import { createLocalCatalogueReader } from "../lib/catalog/editorial-catalogue.ts";
import { localCatalogue } from "../lib/catalog/local-catalogue.ts";
import { discoverCatalogue, publishedCatalogueBrands } from "../lib/catalog/catalogue-discovery.ts";
import { reconcileCart } from "../lib/cart/cart-state.ts";
import { storefrontLabels } from "../lib/storefront/localization.ts";

registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier === "next/navigation") return nextResolve("next/dist/client/components/navigation.react-server.js", context);
  return nextResolve(specifier, context);
} });
const { productMetadata, storefrontSitemap } = await import("../lib/storefront/seo.ts");

const environment = { NODE_ENV: "development", HANAPURE_DRAFT_PREVIEW_LOCAL: "1" };
const slug = "test-only-private-draft-preview";
const marker = "TEST ONLY PRIVATE DRAFT PREVIEW";
const draft = () => ({ publicId: "82345678-abcd-1234-abcd-123456789abc", brand: "beplain", slug, state: "draft",
  translations: Object.fromEntries(["en", "hu", "ko"].map(locale => [locale, {
    name: `${marker} ${locale}`, description: `${locale} <script>window.previewLeak=1</script> & supplied text`,
    images: [{ src: "/fixture.png", alt: `${locale} TEST ONLY image alt` }], usage: `${locale} TEST ONLY usage`, caution: `${locale} TEST ONLY caution`,
  }])) });
function get(url, headers = {}) {
  return new Promise((accept, reject) => {
    const req = request(url, { headers, timeout: 1500 }, res => {
      const chunks = []; res.on("data", part => chunks.push(part));
      res.on("end", () => accept({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString() }));
    });
    req.on("error", reject); req.on("timeout", () => req.destroy(new Error("Connection refused/timed out"))); req.end();
  });
}
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "hanapure-draft-preview-"));
  // Only the newly created test directory is removed. No repository cleanup.
  t.after(() => rmSync(root, { recursive: true }));
  writeFileSync(join(root, "fixture.png"), Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6MxAAAAAASUVORK5CYII=", "base64"));
  return root;
}

test("only explicit local development accepts schema-valid drafts; production/staging CLI fails before listening", async t => {
  const file = join(fixture(t), "draft.json"); writeFileSync(file, JSON.stringify(draft()));
  for (const patch of [{ NODE_ENV: "production" }, { NODE_ENV: "staging" }, { NODE_ENV: "test" },
    { APP_ENV: "staging" }, { VERCEL_ENV: "preview" }, { VERCEL: "1" }, { DEPLOYMENT_ENV: "staging" }, { HANAPURE_DRAFT_PREVIEW_LOCAL: "0" }]) {
    await assert.rejects(startDraftPreview({ draft: draft(), environment: { ...environment, ...patch } }), /local development/);
    const result = spawnSync(process.execPath, ["--conditions=react-server", "--import", "./tests/server-only-loader.mjs",
      "./scripts/editorial-draft-preview.mjs", "--file", file], { env: { ...process.env, ...environment, ...patch }, encoding: "utf8", windowsHide: true, timeout: 10000 });
    assert.notEqual(result.status, 0); assert.match(result.stderr, /local development/); assert.equal(result.stdout, "");
  }
  await assert.rejects(startDraftPreview({ draft: { ...draft(), state: "published" }, environment }), /Only one/);
  await assert.rejects(startDraftPreview({ draft: { ...draft(), sellableStock: 1 }, environment }), /Only one/);
  await assert.rejects(startDraftPreview({ draft: draft(), environment, assetsDirectory: resolve("public") }), /outside the repository/);
});

test("actual listener rejects NIC connections, spoofed Host/proxy/cross-site requests and runtime mode changes", async t => {
  const current = { ...environment };
  const preview = await startDraftPreview({ draft: draft(), environment: current }); t.after(preview.close);
  assert.equal(preview.server.address().address, "127.0.0.1");
  const address = Object.values(networkInterfaces()).flat().find(item => item.family === "IPv4" && !item.internal);
  assert.ok(address, "A real non-loopback IPv4 interface is required for this security proof");
  await assert.rejects(get(preview.url.replace("127.0.0.1", address.address)));
  for (const headers of [{ Host: "public.example.invalid" }, { Host: "localhost" }, { Forwarded: "for=127.0.0.1" },
    { "X-Forwarded-For": "127.0.0.1" }, { "X-Forwarded-Host": "127.0.0.1" }, { Via: "local-proxy" },
    { Origin: "https://example.invalid" }, { "Sec-Fetch-Site": "cross-site" }]) {
    const result = await get(preview.url, headers); assert.equal(result.status, 403); assert.ok(!result.body.includes(marker));
  }
  assert.equal((await get(preview.url)).status, 200);
  current.NODE_ENV = "production";
  const refused = await get(preview.url); assert.equal(refused.status, 403); assert.ok(!refused.body.includes(marker));
});

test("local response has no-store/noindex/CSP, escapes content and does not serve arbitrary files or external images", async t => {
  const item = draft(); item.translations.en.images.push({ src: "https://example.invalid/private.png", alt: "TEST ONLY external alt" });
  const preview = await startDraftPreview({ draft: item, environment, assetsDirectory: fixture(t) }); t.after(preview.close);
  const result = await get(preview.url);
  assert.equal(result.headers["cache-control"], "no-store"); assert.match(result.headers["x-robots-tag"], /noindex/);
  assert.match(result.headers["content-security-policy"], /default-src 'none'/);
  assert.ok(result.body.includes("&lt;script&gt;")); assert.ok(!result.body.includes("<script>"));
  assert.ok(result.body.includes("DRAFT — NOT PUBLIC")); assert.ok(!result.body.includes("href=\"/products"));
  for (const path of ["/draft.json", "/.git/index", "/media/en/999", "/media/en/1", "/?locale=fr", "/?locale=en&locale=ko", "/?returnUrl=/products"]) {
    const refused = await get(preview.url + path); assert.ok(refused.status >= 400); assert.ok(!refused.body.includes(marker));
  }
  assert.equal((await get(preview.url + "/media/en/0")).status, 200);
});

test("synthetic draft remains absent from public discovery, metadata, sitemap and cart reconciliation", () => {
  const item = draft(); const reader = createLocalCatalogueReader([item]);
  for (const locale of ["en", "hu", "ko"]) {
    for (const sort of [undefined, "name-asc", "name-desc"]) assert.deepEqual(discoverCatalogue(reader, locale, { query: marker, brand: "beplain", sort }), []);
    assert.equal(reader.findPublishedBySlug(slug), null);
    assert.throws(() => productMetadata(slug, locale, { catalogue: reader, origin: null }), error => error.digest === "NEXT_HTTP_ERROR_FALLBACK;404");
  }
  assert.deepEqual(publishedCatalogueBrands(reader), []);
  assert.ok(!JSON.stringify(storefrontSitemap(reader, "https://example.test")).includes(slug));
  assert.equal(reconcileCart([{ publicId: item.publicId, quantity: 1 }], reader.listPublished())[0].product, null);
  assert.deepEqual(localCatalogue.listPublished(), []);
});

for (const locale of ["en", "hu", "ko"]) test(`Chromium local draft ${locale}: supplied text/image/keyboard/mobile; no public/cart links or scripts`, async t => {
  const preview = await startDraftPreview({ draft: draft(), environment, assetsDirectory: fixture(t) }); t.after(preview.close);
  const browser = await chromium.launch(); t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 320, height: 900 } });
  const external = []; await page.route("**/*", route => {
    if (new URL(route.request().url()).origin === preview.url) return route.continue();
    external.push(route.request().url()); return route.abort();
  });
  await page.goto(`${preview.url}/?locale=${locale}`);
  assert.equal(await page.locator("h1").textContent(), `${marker} ${locale}`);
  assert.ok(await page.getByText(`${locale} TEST ONLY usage`, { exact: true }).isVisible());
  assert.ok(await page.getByText(`${locale} TEST ONLY caution`, { exact: true }).isVisible());
  assert.equal(await page.getByRole("img", { name: `${locale} TEST ONLY image alt`, exact: true }).evaluate(async image => {
    await image.decode(); return image.naturalWidth;
  }), 1);
  await page.getByRole("link", { name: "EN", exact: true }).focus(); await page.keyboard.press("Tab");
  assert.equal(await page.getByRole("link", { name: "HU", exact: true }).evaluate(node => node === document.activeElement), true);
  await Promise.all([page.waitForEvent("framenavigated", { predicate: frame => frame === page.mainFrame() }), page.keyboard.press("Enter")]);
  await page.waitForLoadState("load"); assert.equal(new URL(page.url()).searchParams.get("locale"), "hu");
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= 320));
  assert.equal(await page.locator("button,form,script,a[href*='/products'],a[href*='/cart']").count(), 0);
  assert.equal(await page.evaluate(() => window.previewLeak), undefined); assert.deepEqual(external, []);
});

test("Chromium missing locale is explicit with no fallback and no storage interaction", async t => {
  const item = draft(); item.translations.hu = null;
  const preview = await startDraftPreview({ draft: item, environment }); t.after(preview.close);
  const browser = await chromium.launch(); t.after(() => browser.close());
  const page = await browser.newPage(); await page.goto(`${preview.url}/?locale=hu`);
  assert.ok(await page.getByText(storefrontLabels.hu.missing, { exact: true }).isVisible());
  assert.ok(!(await page.locator("body").textContent()).includes(`${marker} en`));
  assert.equal(await page.evaluate(() => localStorage.length), 0);
});

test("production build assets contain neither private preview fixture nor the local review implementation", () => {
  function inspect(dir) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) inspect(path);
      else if (/\.(?:js|json|html|rsc)$/.test(entry.name)) {
        const text = readFileSync(path, "utf8");
        assert.ok(!text.includes(marker), `Draft marker in ${path}`);
        assert.ok(!text.includes(slug), `Draft slug in ${path}`);
        assert.ok(!text.includes("DRAFT — NOT PUBLIC"), `Local preview UI in ${path}`);
      }
    }
  }
  inspect(resolve(".next/server")); inspect(resolve(".next/static"));
});

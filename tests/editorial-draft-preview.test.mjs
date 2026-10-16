import assert from "node:assert/strict";
import test from "node:test";
import { request } from "node:http";
import { registerHooks } from "node:module";
import { spawnSync } from "node:child_process";
import { networkInterfaces, tmpdir } from "node:os";
import { mkdtempSync, writeFileSync, rmSync, readFileSync, readdirSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { chromium } from "@playwright/test";
import { startDraftPreview, reviewCoverage, reviewCsvCell, reviewMatrixCsv } from "../scripts/editorial-draft-preview.mjs";
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
const drafts = count => Array.from({ length: count }, (_, index) => {
  const item = draft();
  item.publicId = `${index.toString(16).padStart(8, "0")}-abcd-1234-abcd-123456789abc`;
  item.slug = `${slug}-${index}`;
  for (const locale of ["en", "hu", "ko"]) item.translations[locale].name = `${marker} ${index} ${locale}`;
  return item;
});
function get(url, headers = {}, method = "GET") {
  return new Promise((accept, reject) => {
    const req = request(url, { headers, method, timeout: 1500 }, res => {
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
  for (const input of [draft(), drafts(2)]) {
  const current = { ...environment };
  const preview = await startDraftPreview({ draft: input, environment: current }); t.after(preview.close);
  assert.equal(preview.server.address().address, "127.0.0.1");
  const address = Object.values(networkInterfaces()).flat().find(item => item.family === "IPv4" && !item.internal);
  assert.ok(address, "A real non-loopback IPv4 interface is required for this security proof");
  await assert.rejects(get(preview.url.replace("127.0.0.1", address.address)));
  for (const headers of [{ Host: "public.example.invalid" }, { Host: "localhost" }, { Forwarded: "for=127.0.0.1" },
    { "X-Forwarded-For": "127.0.0.1" }, { "X-Forwarded-Host": "127.0.0.1" }, { Via: "local-proxy" },
    { Origin: "https://example.invalid" }, { "Sec-Fetch-Site": "cross-site" }]) {
    for (const path of ["", "/review-matrix.csv"]) {
      const result = await get(preview.url + path, headers); assert.equal(result.status, 403); assert.ok(!result.body.includes(marker));
      assert.ok(!result.body.includes("publicId"));
    }
  }
  assert.equal((await get(preview.url)).status, 200);
  current.NODE_ENV = "production";
  const refused = await get(preview.url); assert.equal(refused.status, 403); assert.ok(!refused.body.includes(marker));
  assert.equal((await get(preview.url + "/review-matrix.csv")).status, 403);
  }
});

const coverageDrafts = () => {
  const items = drafts(3);
  items[1].translations.hu = null;
  items[2].translations.en = { name: " \t", description: " ", images: [], usage: null, caution: "" };
  items[2].translations.ko.images.push({ src: "/missing.png", alt: "  " });
  return items;
};
const csvCells = text => [...text.slice(1).matchAll(/"((?:[^"]|"")*)"(?:,|\r\n)/g)].map(match => match[1].replaceAll('""', '"'));

test("coverage distinguishes missing/blank/core/optional/image-alt facts without publication judgments", () => {
  const items = coverageDrafts();
  assert.deepEqual(reviewCoverage(null), { present: false, nameNonblank: false, descriptionNonblank: false,
    imageCount: 0, altNonblankCount: 0, usageSupplied: false, cautionSupplied: false });
  assert.deepEqual(reviewCoverage(items[2].translations.en), { present: true, nameNonblank: false, descriptionNonblank: false,
    imageCount: 0, altNonblankCount: 0, usageSupplied: false, cautionSupplied: true });
  assert.equal(reviewCoverage(items[2].translations.ko).imageCount, 2);
  assert.equal(reviewCoverage(items[2].translations.ko).altNonblankCount, 1);
  assert.equal(reviewCoverage(items[0].translations.hu).nameNonblank, true);
  assert.ok(items.every(item => item.state === "draft"));
});

test("CSV is deterministic bounded coverage only with fixed headers, UTF-8 BOM, CRLF and formula-safe dynamic strings", () => {
  const records = coverageDrafts();
  const before = JSON.stringify(records);
  const csv = reviewMatrixCsv(records);
  assert.equal(csv, reviewMatrixCsv(records)); assert.equal(csv[0], "\uFEFF"); assert.ok(csv.endsWith("\r\n"));
  const fields = ["present", "name_nonblank", "description_nonblank", "image_count", "alt_nonblank_count", "usage_supplied", "caution_supplied"];
  const cells = csvCells(csv); const width = 24;
  assert.equal(cells.length, width * 4);
  assert.deepEqual(cells.slice(0, width), ["publicId", "slug", "brand", ...["en", "hu", "ko"].flatMap(locale => fields.map(field => `${locale}_${field}`))]);
  for (let i = 0; i < records.length; i++) assert.deepEqual(cells.slice(width * (i + 1), width * (i + 1) + 3), [records[i].publicId, records[i].slug, records[i].brand]);
  assert.deepEqual(cells.slice(width * 3 + 3, width * 3 + 10), ["true", "false", "false", "0", "0", "false", "true"]);
  for (const privateText of [marker, "TEST ONLY usage", "TEST ONLY caution", "TEST ONLY image alt", "/fixture.png", "/missing.png", "window.previewLeak", '"translations"']) assert.ok(!csv.includes(privateText), privateText);
  assert.equal(JSON.stringify(records), before);
  for (const prefix of ["", " ", "\t", "\r\n", "\u0000\u001f", "\u0085", "\u200b\ufeff"]) for (const formula of ["=SUM(1,2)", "+1", "-2", "@CMD"]) {
    const value = prefix + formula;
    assert.equal(reviewCsvCell(value).slice(1, -1).replaceAll('""', '"'), "'" + value);
  }
  for (const value of ['English,"quoted"\r\nnext', "árvíztűrő 한국어", " safe text", "normal=1"]) {
    assert.equal(reviewCsvCell(value), `"${value.replaceAll('"', '""')}"`);
  }
  const defensive = reviewMatrixCsv([{ ...records[0], publicId: " =1", slug: '+"quoted",\r\nvalue', brand: "\t@formula" }]);
  assert.deepEqual(csvCells(defensive).slice(width, width + 3), ["' =1", '\'+"quoted",\r\nvalue', "'\t@formula"]);
  for (const count of [1, 50]) {
    const items = drafts(count); for (const item of items) for (const content of Object.values(item.translations)) content.images = [];
    assert.equal(csvCells(reviewMatrixCsv(items)).length, width * (count + 1));
  }
});

test("matrix filters use explicit predicates/counts, strict query allowlist, and all-draft read-only CSV/HEAD", async t => {
  const root = fixture(t); const file = join(root, "source.json"); const items = coverageDrafts();
  writeFileSync(file, JSON.stringify(items)); const bytes = readFileSync(file); const names = readdirSync(root);
  const preview = await startDraftPreview({ draft: JSON.parse(bytes), environment }); t.after(preview.close);
  for (const [locale, filter, count] of [["en", "all", 3], ["en", "needs-review", 2], ["en", "missing-locale", 1], ["hu", "missing-locale", 1], ["ko", "missing-locale", 0]]) {
    const result = await get(`${preview.url}/?locale=${locale}&filter=${filter}`);
    assert.equal(result.status, 200); assert.ok(result.body.includes(`Showing ${count} of 3 drafts`));
    assert.equal((result.body.match(/scope="row"/g) ?? []).length, count);
  }
  const csv = await get(preview.url + "/review-matrix.csv");
  assert.equal(csv.status, 200); assert.equal(csv.body, reviewMatrixCsv(items));
  assert.equal(csv.headers["content-type"], "text/csv; charset=utf-8");
  assert.equal(csv.headers["content-disposition"], 'attachment; filename="hanapure-draft-review-matrix.csv"');
  assert.equal(csv.headers["cache-control"], "no-store"); assert.match(csv.headers["x-robots-tag"], /noindex/);
  assert.equal(csv.headers["x-content-type-options"], "nosniff"); assert.match(csv.headers["content-security-policy"], /default-src 'none'/);
  const head = await get(preview.url + "/review-matrix.csv", {}, "HEAD");
  assert.equal(head.status, 200); assert.equal(head.body, ""); assert.equal(head.headers["content-disposition"], csv.headers["content-disposition"]);
  for (const path of ["/?filter=bad", "/?filter=all&filter=all", "/draft/1?filter=all&filter=missing-locale", "/review-matrix.csv?locale=en", "/review-matrix.csv?filter=all", "/review-matrix.csv?file=/source.json"]) {
    const result = await get(preview.url + path); assert.ok(result.status >= 400); assert.ok(!result.body.includes("publicId"));
  }
  assert.equal((await get(preview.url + "/review-matrix.csv", {}, "POST")).status, 405);
  assert.deepEqual(readdirSync(root), names); assert.deepEqual(readFileSync(file), bytes);
  const single = await startDraftPreview({ draft: draft(), environment }); t.after(single.close);
  assert.equal((await get(single.url + "/review-matrix.csv")).status, 404);
  assert.equal((await get(single.url + "/?filter=all")).status, 400);
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
  const items = drafts(2); const reader = createLocalCatalogueReader(items);
  for (const locale of ["en", "hu", "ko"]) {
    for (const sort of [undefined, "name-asc", "name-desc"]) assert.deepEqual(discoverCatalogue(reader, locale, { query: marker, brand: "beplain", sort }), []);
    for (const item of items) {
      assert.equal(reader.findPublishedBySlug(item.slug), null);
      assert.throws(() => productMetadata(item.slug, locale, { catalogue: reader, origin: null }), error => error.digest === "NEXT_HTTP_ERROR_FALLBACK;404");
    }
  }
  assert.deepEqual(publishedCatalogueBrands(reader), []);
  assert.ok(!JSON.stringify(storefrontSitemap(reader, "https://example.test")).includes(slug));
  assert.ok(reconcileCart(items.map(item => ({ publicId: item.publicId, quantity: 1 })), reader.listPublished()).every(line => line.product === null));
  assert.deepEqual(localCatalogue.listPublished(), []);
});

test("arrays reject atomically on invalid/published/duplicate/overlimit input and accept boundary counts immutably", async t => {
  for (const count of [1, 50]) {
    const items = drafts(count);
    for (const item of items) for (const content of Object.values(item.translations)) content.images = [];
    const preview = await startDraftPreview({ draft: items, environment });
    try {
      items[0].state = "published"; items[0].translations.en.name = "MUTATED"; items.pop();
      const result = await get(preview.url);
      assert.equal(result.status, 200); assert.ok(result.body.includes(`Drafts (${count})`));
      assert.ok(!result.body.includes("MUTATED"));
    } finally { await preview.close(); }
  }
  const duplicateId = drafts(2); duplicateId[1].publicId = duplicateId[0].publicId.toUpperCase();
  const duplicateSlug = drafts(2); duplicateSlug[1].slug = duplicateSlug[0].slug;
  const published = drafts(2); published[1].state = "published";
  const broken = drafts(2); broken[1].translations.ko.name = 5;
  const manyImages = drafts(1); manyImages[0].translations.en.images = Array(11).fill({ src: "/fixture.png", alt: "TEST ONLY" });
  const totalImages = drafts(4);
  for (const item of totalImages) for (const content of Object.values(item.translations)) content.images = Array(10).fill({ src: "/fixture.png", alt: "TEST ONLY" });
  const large = drafts(1); large[0].translations.en.description = "x".repeat(1_000_001);
  for (const input of [[], drafts(51), duplicateId, duplicateSlug, published, broken, manyImages, totalImages, large]) {
    await assert.rejects(startDraftPreview({ draft: input, environment }));
  }
  // The existing CLI must refuse an oversized private JSON before listening.
  const file = join(fixture(t), "large.json"); writeFileSync(file, JSON.stringify(large));
  const result = spawnSync(process.execPath, ["--conditions=react-server", "--import", "./tests/server-only-loader.mjs", "./scripts/editorial-draft-preview.mjs", "--file", file],
    { env: { ...process.env, ...environment }, encoding: "utf8", windowsHide: true, timeout: 10000 });
  assert.notEqual(result.status, 0); assert.equal(result.stdout, ""); assert.match(result.stderr, /Invalid local draft file/);
});

test("multi-draft strict routes bind media to one validated draft/locale and reject traversal/query pollution", async t => {
  const items = drafts(2); items[1].translations.ko = null;
  items[0].translations.en.images = [];
  items[1].translations.en.images.push({ src: "/missing.png", alt: "TEST ONLY missing image" }, { src: "https://example.invalid/remote.png", alt: "TEST ONLY remote image" });
  const root = fixture(t);
  // A file exists outside the allowed assets directory but is never served.
  const outside = fixture(t); writeFileSync(join(outside, "private.png"), "TEST ONLY PRIVATE BYTES");
  items[0].translations.hu.images = [{ src: `/..%2f${basename(outside)}%2fprivate.png`, alt: "TEST ONLY outside" }];
  const preview = await startDraftPreview({ draft: items, environment, assetsDirectory: root }); t.after(preview.close);
  const first = await get(preview.url + "/draft/0?locale=en"), second = await get(preview.url + "/draft/1?locale=en");
  assert.ok(first.body.includes(`${marker} 0 en`)); assert.ok(!first.body.includes(`${marker} 1 en`));
  assert.ok(second.body.includes("/draft/1/media/en/0")); assert.ok(!second.body.includes("<img src=\"https:"));
  assert.equal((await get(preview.url + "/draft/1/media/en/0")).status, 200);
  for (const path of ["/draft/0/media/en/0", "/draft/1/media/ko/0", "/media/en/0", "/draft/1/media/en/1", "/draft/1/media/en/2", "/draft/0/media/hu/0",
    "/draft/2", "/draft/-1", "/draft/01", "/draft/1.0", "/draft/9007199254740992", "/draft/%31", "/draft/1/../0", "/draft/1/%2e%2e/0", "/%2e%2e/", "/draft/1%2fmedia/en/0",
    "/draft/1?locale=en&locale=hu", "/draft/1?draft=0", "/?index=0", "/draft/0/media/en/0?draft=1", "/draft/1/media/en/0?locale=ko",
    "/%72eview-matrix.csv", "/draft/0/../../review-matrix.csv", "/review-matrix.csv/", "/?filter=all&filter=needs-review"]) {
    // request.path preserves traversal; URL clients may normalize it before sending.
    const result = await new Promise((accept, reject) => {
      const req = request({ hostname: "127.0.0.1", port: new URL(preview.url).port, path }, response => {
        const data = []; response.on("data", chunk => data.push(chunk));
        response.on("end", () => accept({ status: response.statusCode, body: Buffer.concat(data).toString() }));
      }); req.on("error", reject); req.end();
    });
    assert.ok(result.status >= 400, path); assert.ok(!result.body.includes(marker), path);
    assert.ok(!result.body.includes("TEST ONLY PRIVATE BYTES"), path);
  }
  for (const patch of [{ NODE_ENV: "production" }, { APP_ENV: "staging" }, { HANAPURE_DRAFT_PREVIEW_LOCAL: undefined }]) {
    await assert.rejects(startDraftPreview({ draft: items, environment: { ...environment, ...patch } }), /local development/);
  }
});

test("Chromium matrix: accessible 320px table/filter round trip and explicit all-draft CSV download without JS/storage", async t => {
  const items = coverageDrafts();
  const preview = await startDraftPreview({ draft: items, environment }); t.after(preview.close);
  const browser = await chromium.launch(); t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 320, height: 900 }, javaScriptEnabled: false });
  let downloads = 0; page.on("download", () => { downloads++; });
  const external = []; await page.route("**/*", route => {
    if (new URL(route.request().url()).origin === preview.url) return route.continue();
    external.push(route.request().url()); return route.abort();
  });
  const navigate = async action => {
    await Promise.all([page.waitForEvent("framenavigated", { predicate: frame => frame === page.mainFrame() }), action()]);
    await page.waitForLoadState("load");
  };
  await page.goto(preview.url);
  assert.equal(downloads, 0);
  assert.equal(await page.getByRole("columnheader").count(), 6); assert.equal(await page.getByRole("rowheader").count(), 3);
  assert.equal(await page.locator("caption").textContent(), "Draft field coverage — structural presence only");
  const region = page.getByRole("region", { name: "Draft field coverage — structural presence only", exact: true });
  await region.focus(); await page.keyboard.press("ArrowRight");
  await page.waitForFunction(() => document.querySelector(".matrix-scroll").scrollLeft > 0);
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= 320));
  await navigate(() => page.getByRole("link", { name: "Needs content review", exact: true }).press("Enter"));
  assert.equal(await page.getByRole("status").textContent(), "Showing 2 of 3 drafts");
  await navigate(() => page.locator("tbody a").first().press("Enter"));
  assert.equal(new URL(page.url()).pathname, "/draft/1"); assert.equal(new URL(page.url()).searchParams.get("filter"), "needs-review");
  await navigate(() => page.getByRole("link", { name: "Next draft", exact: true }).press("Enter"));
  assert.equal(new URL(page.url()).pathname, "/draft/2");
  await navigate(() => page.getByRole("link", { name: "Previous draft", exact: true }).press("Enter"));
  assert.equal(new URL(page.url()).pathname, "/draft/1");
  await navigate(() => page.getByRole("link", { name: "HU", exact: true }).press("Enter"));
  assert.ok(await page.getByText(storefrontLabels.hu.missing, { exact: true }).isVisible());
  await navigate(() => page.getByRole("link", { name: "Back to drafts", exact: true }).press("Enter"));
  assert.equal(new URL(page.url()).searchParams.get("locale"), "hu"); assert.equal(new URL(page.url()).searchParams.get("filter"), "needs-review");
  await navigate(() => page.getByRole("link", { name: "Missing selected-locale content", exact: true }).press("Enter"));
  assert.equal(await page.getByRole("status").textContent(), "Showing 1 of 3 drafts");
  await navigate(() => page.getByRole("link", { name: "KO", exact: true }).press("Enter"));
  assert.equal(await page.getByRole("status").textContent(), "Showing 0 of 3 drafts");
  assert.ok(await page.getByText("No drafts match this review filter.", { exact: true }).isVisible());
  assert.equal(await page.locator("tbody tr").count(), 0);
  assert.ok(await page.getByText("Exports all drafts (not just filtered rows)", { exact: true }).isVisible());
  assert.equal(downloads, 0);
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("link", { name: "Download Review Matrix CSV", exact: true }).click()]);
  assert.equal(download.suggestedFilename(), "hanapure-draft-review-matrix.csv");
  const stream = await download.createReadStream(); const data = [];
  for await (const chunk of stream) data.push(chunk);
  assert.equal(Buffer.concat(data).toString("utf8"), reviewMatrixCsv(items)); assert.equal(downloads, 1);
  assert.equal(await page.evaluate(() => localStorage.length), 0); assert.deepEqual(external, []);
  // A locale change can remove a selected draft from the filtered list without
  // changing its identity or redirecting to another product.
  await page.goto(`${preview.url}/draft/2?locale=en&filter=missing-locale`);
  await navigate(() => page.getByRole("link", { name: "KO", exact: true }).click());
  assert.equal(new URL(page.url()).pathname, "/draft/2");
  assert.equal(await page.getByRole("link", { name: "Next draft", exact: true }).count(), 0);
  assert.equal(await page.getByRole("link", { name: "Previous draft", exact: true }).count(), 0);
  await navigate(() => page.getByRole("link", { name: "Back to drafts", exact: true }).click());
  assert.equal(await page.getByRole("status").textContent(), "Showing 0 of 3 drafts");
});

for (const locale of ["en", "hu", "ko"]) test(`Chromium multi ${locale}: list/detail/language/back/previous/next at 320px without scripts or cross-draft media`, async t => {
  const items = drafts(2); items[1].translations.hu = null;
  const preview = await startDraftPreview({ draft: items, environment, assetsDirectory: fixture(t) }); t.after(preview.close);
  const browser = await chromium.launch(); t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 320, height: 900 }, javaScriptEnabled: false });
  const external = []; await page.route("**/*", route => {
    if (new URL(route.request().url()).origin === preview.url) return route.continue();
    external.push(route.request().url()); return route.abort();
  });
  const navigate = async action => {
    await Promise.all([page.waitForEvent("framenavigated", { predicate: frame => frame === page.mainFrame() }), action()]);
    await page.waitForLoadState("load");
  };
  await page.goto(`${preview.url}/?locale=${locale}`);
  assert.equal(await page.locator("h1").textContent(), "Drafts (2)");
  assert.ok(await page.getByText("DRAFT — NOT PUBLIC", { exact: true }).isVisible());
  await page.getByRole("link", { name: "KO", exact: true }).focus(); await page.keyboard.press("Tab");
  assert.equal(await page.getByRole("link", { name: "All drafts", exact: true }).evaluate(node => node === document.activeElement), true);
  await page.getByRole("region", { name: "Draft field coverage — structural presence only", exact: true }).focus();
  await page.keyboard.press("Tab");
  const first = page.locator("tbody a").first();
  assert.equal(await first.evaluate(node => node === document.activeElement), true);
  await navigate(() => page.keyboard.press("Enter"));
  assert.equal(new URL(page.url()).pathname, "/draft/0");
  assert.equal(await page.locator("h1").textContent(), `${marker} 0 ${locale}`);
  assert.equal(await page.getByRole("img", { name: `${locale} TEST ONLY image alt`, exact: true }).evaluate(async image => { await image.decode(); return image.naturalWidth; }), 1);
  await navigate(() => page.getByRole("link", { name: "KO", exact: true }).click());
  assert.equal(new URL(page.url()).pathname, "/draft/0");
  assert.equal(await page.locator("h1").textContent(), `${marker} 0 ko`);
  await navigate(() => page.getByRole("link", { name: "Next draft", exact: true }).click());
  assert.equal(await page.locator("h1").textContent(), `${marker} 1 ko`);
  await navigate(() => page.getByRole("link", { name: "HU", exact: true }).click());
  assert.ok(await page.getByText(storefrontLabels.hu.missing, { exact: true }).isVisible());
  assert.ok(!(await page.locator("body").textContent()).includes(`${marker} 1 en`));
  assert.equal(await page.locator("img").count(), 0);
  await navigate(() => page.getByRole("link", { name: "Previous draft", exact: true }).click());
  assert.equal(await page.locator("h1").textContent(), `${marker} 0 hu`);
  await navigate(() => page.getByRole("link", { name: "Back to drafts", exact: true }).click());
  assert.equal(new URL(page.url()).pathname, "/"); assert.equal(new URL(page.url()).searchParams.get("locale"), "hu");
  assert.equal(await page.locator("tbody tr").count(), 2);
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= 320));
  assert.equal(await page.locator("script,form,button,a[href*='/products'],a[href*='/cart']").count(), 0);
  assert.deepEqual(external, []);
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

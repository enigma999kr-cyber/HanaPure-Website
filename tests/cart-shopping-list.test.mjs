import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { formatCartShoppingList, MAX_SHOPPING_LIST_LENGTH } from "../lib/cart/cart-shopping-list.ts";
import { cartLabels } from "../lib/cart/labels.ts";
import { storefrontLabels } from "../lib/storefront/localization.ts";
import { createLocalCatalogueReader } from "../lib/catalog/editorial-catalogue.ts";

const id = "12345678-abcd-1234-abcd-123456789abc";
const other = "22345678-abcd-1234-abcd-123456789abc";
const draftId = "32345678-abcd-1234-abcd-123456789abc";
const unknown = "42345678-abcd-1234-abcd-123456789abc";
const product = (patch = {}) => ({ publicId: id, brand: "beplain", slug: "test-only-one",
  names: { en: "Test product", hu: "Teszttermék", ko: "테스트 상품" }, ...patch });
const lines = [{ publicId: id, quantity: 2 }, { publicId: other, quantity: 7 }];

test("localized single/multiple public selections retain cart ordering, quantities and required personal-only disclaimer", () => {
  const products = [product(), product({ publicId: other, slug: "test-only-two", names: { en: "Second", hu: "Második", ko: "두 번째" } })];
  for (const locale of ["en", "hu", "ko"]) {
    const result = formatCartShoppingList(lines, [...products].reverse(), locale);
    assert.equal(result.status, "ready");
    assert.equal(result.omitted, 0);
    assert.equal(result.text, `HanaPure\n\n- ${products[0].names[locale]} — ${cartLabels[locale].quantity}: 2\n- ${products[1].names[locale]} — ${cartLabels[locale].quantity}: 7\n\n${cartLabels[locale].shoppingListNotice}`);
    assert.equal(formatCartShoppingList([lines[0]], products, locale).text.split("\n").filter(row => row.startsWith("- ")).length, 1);
    assert.ok(!result.text.includes(id));
    assert.ok(!result.text.includes(other));
  }
});

test("real public reader projection omits draft and unknown cart entries without exposing their identity/content", () => {
  const content = { name: "Synthetic public item", description: "Test-only content", images: [], usage: null, caution: null };
  const records = [{ publicId: id, brand: "beplain", slug: "public-test", state: "published", translations: { en: content, hu: null, ko: null } },
    { publicId: draftId, brand: "Anua", slug: "private-test", state: "draft", translations: { en: { ...content, name: "Private fixture must not leak" }, hu: null, ko: null } }];
  const products = createLocalCatalogueReader(records).listPublished().map(item => ({ publicId: item.publicId, brand: item.brand, slug: item.slug,
    names: { en: item.translations.en?.name ?? null, hu: item.translations.hu?.name ?? null, ko: item.translations.ko?.name ?? null } }));
  const result = formatCartShoppingList([{ publicId: draftId, quantity: 4 }, { publicId: id.toUpperCase(), quantity: 2 }, { publicId: unknown, quantity: 99 }], products, "en");
  assert.equal(result.status, "ready");
  assert.equal(result.omitted, 2);
  assert.equal(result.text.split("\n").filter(row => row.startsWith("- ")).length, 1);
  for (const secret of [id, draftId, unknown, "Private fixture", "private-test", "99"]) assert.ok(!result.text.includes(secret));
});

test("missing locale uses neutral localized details plus brand/slug, never another language", () => {
  const products = [product({ names: { en: "English-only secret fallback", hu: null, ko: null } })];
  for (const locale of ["hu", "ko"]) {
    const result = formatCartShoppingList([lines[0]], products, locale);
    assert.equal(result.status, "ready");
    assert.ok(result.text.includes(`${storefrontLabels[locale].details}: beplain (test-only-one)`));
    assert.ok(!result.text.includes("English-only"));
  }
});

test("HTML, newline, control and direction characters cannot fabricate extra rows or clipboard markup", () => {
  const unsafe = "<b>Alpha</b>\r\n- Fake row\t\u0000\u007f\u0085\u2028\u2029\u202e\u2066\u200b Omega <img src=x onerror=alert(1)>";
  const result = formatCartShoppingList([lines[0]], [product({ names: { en: unsafe, hu: null, ko: null } })], "en");
  assert.equal(result.status, "ready");
  assert.ok(result.text.includes("- Alpha - Fake row Omega — Quantity: 2"));
  assert.equal(result.text.split("\n").filter(row => row.startsWith("- ")).length, 1);
  assert.doesNotMatch(result.text, /<|>|[\u0000-\u0009\u000b-\u001f\u007f-\u009f\u2028-\u202e\u2066-\u2069\u200b]/);
  assert.deepEqual(formatCartShoppingList([lines[0]], [product({ names: { en: "<b>\n</b>", hu: null, ko: null } })], "en"), { status: "invalid" });
});

test("no public entries means empty, never a clipboard list of stale identities", () => {
  for (const locale of ["en", "hu", "ko"]) {
    assert.deepEqual(formatCartShoppingList([], [product()], locale), { status: "empty" });
    assert.deepEqual(formatCartShoppingList(lines, [], locale), { status: "empty" });
    assert.deepEqual(formatCartShoppingList([{ publicId: unknown, quantity: 1 }], [product()], locale), { status: "empty" });
  }
});

test("quantity validation rejects corrupt/unsafe input and accepts exact positive safe integers", () => {
  for (const quantity of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, NaN, Infinity, "2", null]) {
    assert.deepEqual(formatCartShoppingList([{ publicId: id, quantity }], [product()], "en"), { status: "invalid" });
  }
  assert.deepEqual(formatCartShoppingList([{ publicId: "bad-id", quantity: 1 }], [product()], "en"), { status: "invalid" });
  assert.deepEqual(formatCartShoppingList([lines[0], { ...lines[0], publicId: id.toUpperCase() }], [product()], "en"), { status: "invalid" });
  const maximum = formatCartShoppingList([{ publicId: id, quantity: Number.MAX_SAFE_INTEGER }], [product()], "en");
  assert.equal(maximum.status, "ready");
  assert.ok(maximum.text.includes(String(Number.MAX_SAFE_INTEGER)));
});

test("exact text bound includes header/disclaimer and rejects oversized fields or combined lists without truncation", () => {
  const build = name => formatCartShoppingList([lines[0]], [product({ names: { en: name, hu: null, ko: null } })], "en");
  const overhead = build("X").text.length - 1;
  const limitName = "X".repeat(MAX_SHOPPING_LIST_LENGTH - overhead);
  const exact = build(limitName);
  assert.equal(exact.status, "ready");
  assert.equal(exact.text.length, MAX_SHOPPING_LIST_LENGTH);
  assert.deepEqual(build(limitName + "X"), { status: "too-large" });
  assert.deepEqual(build("X".repeat(MAX_SHOPPING_LIST_LENGTH + 1)), { status: "too-large" });
  assert.deepEqual(formatCartShoppingList(lines, [product({ names: { en: "X".repeat(8_000), hu: null, ko: null } }),
    product({ publicId: other, names: { en: "Y".repeat(8_000), hu: null, ko: null } })], "en"), { status: "too-large" });
});

test("formatter is side-effect free with frozen selections; projection includes no operational or private fields", () => {
  const selection = Object.freeze(lines.map(line => Object.freeze({ ...line })));
  const products = Object.freeze([Object.freeze(product({ names: Object.freeze({ en: "Safe name", hu: null, ko: null }),
    basePriceHuf: "secret-price", sellableStock: "secret-stock", operationalReady: true }) )]);
  const before = JSON.stringify({ selection, products });
  const result = formatCartShoppingList(selection, products, "en");
  assert.equal(result.status, "ready");
  assert.equal(result.omitted, 1);
  assert.equal(JSON.stringify({ selection, products }), before);
  assert.doesNotMatch(result.text, /secret-price|secret-stock|operationalReady|https?:\/\//);
  const source = readFileSync(new URL("../lib/cart/cart-shopping-list.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /\bwindow\b|navigator|localStorage|sessionStorage|server-only|local-catalogue|fetch\(|writeText|changeBrowser/);
});

test("copy action source contract awaits native clipboard success, catches failure, guards pending and never mutates either store", () => {
  const source = readFileSync(new URL("../components/cart/ShoppingCart.tsx", import.meta.url), "utf8");
  const start = source.indexOf('disabled={copying ||');
  const end = source.indexOf('}>{labels.copyShoppingList}</button>', start);
  assert.ok(start > 0 && end > start);
  const action = source.slice(start, end);
  assert.match(action, /!cart.ready \|\| cart.invalid \|\| !cart.persistent \|\| !items.some/);
  assert.match(action, /onClick=\{async \(\) =>/);
  assert.match(action, /copyPending.current \|\| !cart.ready/);
  assert.match(action, /copyPending.current = true; setCopying\(true\)/);
  assert.match(action, /typeof navigator === "undefined" \|\| !navigator.clipboard\?\.writeText/);
  assert.match(action, /await navigator.clipboard.writeText\(list.text\);\s*setCopyMessage\(list.omitted/);
  assert.match(action, /catch \{\s*setCopyMessage\(labels.shoppingListFailed\)/);
  assert.match(action, /finally \{\s*copyPending.current = false; setCopying\(false\)/);
  assert.doesNotMatch(action, /changeBrowserCart|changeBrowserFavorite|resetBrowser|setUndo|execCommand|textarea|fetch\(/);
  assert.equal((action.match(/navigator.clipboard.writeText\(/g) ?? []).length, 1);
  assert.match(source, /<p role="status"[^>]*>\{copyMessage\}<\/p>/);
  assert.match(source, /max-w-full break-words disabled:opacity-50/);
  for (const locale of ["en", "hu", "ko"]) for (const key of ["copyShoppingList", "shoppingListCopied", "shoppingListCopiedOmitted",
    "shoppingListFailed", "shoppingListEmpty", "shoppingListTooLarge", "shoppingListNotice"]) assert.ok(cartLabels[locale][key].trim());
  // These are source assertions, not hydrated or real clipboard-permission evidence.
});

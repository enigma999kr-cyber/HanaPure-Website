import assert from "node:assert/strict";
import { registerHooks, createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";
import ts from "typescript";
import { createLocalCatalogueReader } from "../lib/catalog/editorial-catalogue.ts";
import { readCatalogueCriteria } from "../lib/catalog/catalogue-discovery.ts";
import { readCatalogueBrowse } from "../lib/catalog/catalogue-browse.ts";
import { readShoppingPlan, shoppingPlanHref, carryShoppingPlan, addPlanProducts, setPlanQuantity, shoppingPlanCartHref } from "../lib/catalog/catalogue-shopping-plan.ts";
import { portablePayload, readPortableLink, planPortableMerge } from "../lib/cart/cart-portable-handoff.ts";
import { storefrontLabels, storefrontHref, switchLocalePath } from "../lib/storefront/localization.ts";

const id = index => `${index.toString(16).padStart(8, "0")}-abcd-1234-abcd-123456789abc`;
const content = (locale, index) => ({ name: `${locale} synthetic ${index}`, description: "Test fixture only", images: [], usage: null, caution: null });
const records = Array.from({ length: 45 }, (_, index) => ({ publicId: id(index + 1), slug: `synthetic-${index + 1}`, brand: index % 2 ? "Anua" : "beplain", state: "published",
  translations: { en: content("en", index + 1), hu: index % 3 ? content("hu", index + 1) : null, ko: index % 4 ? content("ko", index + 1) : null } }));
const privateRecord = { ...records[0], publicId: id(99), slug: "private-test", state: "draft", translations: { en: content("PRIVATE SECRET", 99), hu: null, ko: null } };
const catalogue = createLocalCatalogueReader([...records, privateRecord]);
const empty = readShoppingPlan(undefined, records);
const twoLines = [{ publicId: id(1), quantity: 3 }, { publicId: id(3), quantity: 7 }];
const two = readShoppingPlan(portablePayload(twoLines), records);
const paramsOf = href => {
  const url = new URL(href, "https://synthetic.invalid");
  return { url, params: Object.fromEntries([...url.searchParams.keys()].map(key => [key, url.searchParams.getAll(key).length === 1 ? url.searchParams.get(key) : url.searchParams.getAll(key)])) };
};

test("F1/F2 deterministic visible-page capture retains plan order/quantities, deduplicates aliases and appends visible order only", () => {
  const before = JSON.stringify(two);
  const result = addPlanProducts(two, [id(6).toUpperCase(), id(4), id(1), id(4)], [id(1), id(4), id(6)], records);
  assert.equal(result.status, "changed");
  assert.deepEqual(result.lines, [...twoLines, { publicId: id(4), quantity: 1 }, { publicId: id(6), quantity: 1 }]);
  assert.equal(JSON.stringify(two), before);
  assert.equal(addPlanProducts(two, [id(1)], [id(1)], records).status, "unchanged");
  assert.equal(addPlanProducts(empty, [], [id(1)], records).status, "invalid");
  assert.equal(addPlanProducts(two, [id(20)], [id(1)], records).status, "invalid");
  assert.equal(addPlanProducts(two, [privateRecord.publicId], [privateRecord.publicId], records).status, "invalid");
});

test("F2/F3 canonical parser reuses Cart protocol and rejects entire invalid/stale/duplicate/encoded/oversized plans", () => {
  for (const raw of ["", [], [portablePayload(twoLines)], ["bad", "bad"], "v2." + id(1) + ":1", `v1.${id(1)}:0`, `v1.${id(1)}:1e2`,
    `v1.${id(1)}:01`, `v1.${id(1).toUpperCase()}:1`, `v1.${id(1)}:1,${id(1)}:2`, `v1.${id(1)}:9007199254740992`,
    `v1.${id(1)}:1%0a`, `v1.${id(1)}:1\n`, "x".repeat(8193), portablePayload([{ publicId: id(99), quantity: 1 }])]) {
    assert.deepEqual(readShoppingPlan(raw, records), { status: "invalid", lines: [] });
  }
  assert.deepEqual(readShoppingPlan(undefined, records), { status: "empty", lines: [] });
  assert.deepEqual(two.lines, twoLines);
  assert.equal(readShoppingPlan(portablePayload(twoLines), [...records, records[0]]).status, "invalid");
  const forty = records.slice(0, 40).map(record => ({ publicId: record.publicId, quantity: 1 }));
  const plan = readShoppingPlan(portablePayload(forty), records);
  assert.equal(plan.status, "ready");
  assert.equal(addPlanProducts(plan, [id(41)], [id(41)], records).status, "limit");
  assert.equal(addPlanProducts(plan, [id(1)], [id(1)], records).status, "unchanged");
  assert.equal(plan.lines.length, 40);
});

test("F3/F5 URL transport is bounded and same-site only; quantities are absolute, unchanged is distinct, bad edits preserve valid plan", () => {
  for (const raw of ["", "0", "-1", "1.1", "1e2", " 2", "9007199254740992"]) assert.equal(setPlanQuantity(two, id(1), raw, records).status, "invalid");
  assert.equal(setPlanQuantity(two, id(1), "3", records).status, "unchanged");
  const next = setPlanQuantity(two, id(1), "9007199254740991", records);
  assert.equal(next.lines[0].quantity, Number.MAX_SAFE_INTEGER); assert.equal(next.lines[1].quantity, 7);
  const href = shoppingPlanHref("/hu/products", "?q=Anua&sort=name-asc&page=3", next.lines);
  assert.ok(href.length <= 8192); assert.deepEqual(readShoppingPlan(paramsOf(href).params.cartPlan, records).lines, next.lines);
  for (const path of ["//external.invalid/products", "https://external.invalid/products", "/cart", "/products/../private", "/xx/products"]) assert.equal(shoppingPlanHref(path, "", twoLines), null);
  for (const query of ["?cartDraft=bad", "?cartPlan=bad", "?returnUrl=https://external.invalid", "?q=" + "x".repeat(8190)]) assert.equal(shoppingPlanHref("/products", query, twoLines), null);
  assert.equal(shoppingPlanHref("/products", "", twoLines, "#arbitrary"), null);
  assert.equal(setPlanQuantity(two, id(8), "1", records).status, "invalid");
});

test("F8 handoff is exactly existing Cart-only cartDraft; preview is read-only and existing merge planner remains authoritative", () => {
  for (const prefix of ["", "/en", "/hu", "/ko"]) {
    const href = shoppingPlanCartHref(`${prefix}/cart`, two, records);
    const { url, params } = paramsOf(href);
    assert.equal(url.pathname, `${prefix}/cart`); assert.deepEqual(Object.keys(params), ["cartDraft"]);
    assert.equal(url.hash, ""); assert.equal(params.cartDraft, portablePayload(twoLines));
    const parsed = readPortableLink("https://synthetic.invalid" + href);
    assert.deepEqual(parsed.lines, twoLines); assert.equal(parsed.units, "10");
    const existing = [{ publicId: id(1).toUpperCase(), quantity: 5 }, { publicId: id(99), quantity: 9 }];
    assert.deepEqual(planPortableMerge(existing, parsed.lines, records).after, [{ ...existing[0], quantity: 8 }, existing[1], twoLines[1]]);
  }
  assert.equal(shoppingPlanCartHref("//external.invalid/cart", two, records), null);
  assert.equal(shoppingPlanCartHref("/cart", empty, records), null);
  assert.equal(shoppingPlanCartHref("/cart", two, []), null);
});

// Existing Node / installed TypeScript hook convention. Only the new client island is executed synthetically.
const require = createRequire(import.meta.url), repo = dirname(dirname(fileURLToPath(import.meta.url)));
const reactEntry = pathToFileURL(join(dirname(require.resolve("react/package.json")), "index.js")).href;
const jsxEntry = pathToFileURL(join(dirname(require.resolve("react/package.json")), "jsx-runtime.js")).href;
const hooksUrl = "data:text/javascript," + encodeURIComponent(`
export const driver={instances:new Map(),active:[],index:0,serial:0,context:null,pathname:'/products'};
export function useEffect(){}
export function useState(initial){const state=driver.active,index=driver.index++;if(!(index in state))state[index]=typeof initial==='function'?initial():initial;return [state[index],value=>{state[index]=typeof value==='function'?value(state[index]):value;}];}
export function useRef(current){return useState(()=>({current}))[0];}
export function useId(){return useState(()=> 'synthetic-'+(++driver.serial))[0];}
export function createContext(){return {Provider:Symbol('plan-provider')};}
export function useContext(){return driver.context;}
export function useSyncExternalStore(subscribe,getSnapshot,getServerSnapshot){return typeof window==='undefined'?getServerSnapshot():getSnapshot();}
`);
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "react" && ["/components/catalogue/CatalogueShoppingPlan.tsx", "/components/catalogue/SearchSuggestions.tsx", "/components/layout/Header.tsx", "/lib/cart/browser-cart.ts"].some(path => context.parentURL?.endsWith(path))) return { url: hooksUrl, shortCircuit: true };
    if (specifier === "react") return { url: reactEntry, shortCircuit: true };
    if (specifier === "react/jsx-runtime") return { url: jsxEntry, shortCircuit: true };
    if (specifier === "react-dom") return { url: pathToFileURL(join(dirname(require.resolve("react-dom/package.json")), "index.js")).href, shortCircuit: true };
    if (specifier === "next/link") return nextResolve("next/link.js", context);
    if (specifier === "next/navigation" && context.parentURL?.endsWith("/components/layout/Header.tsx")) return { url: "data:text/javascript," + encodeURIComponent(`import {driver} from ${JSON.stringify(hooksUrl)};export const usePathname=()=>driver.pathname;`), shortCircuit: true };
    if (specifier === "next/navigation") return nextResolve("next/dist/client/components/navigation.react-server.js", context);
    if (specifier.startsWith("@/")) specifier = pathToFileURL(join(repo, specifier.slice(2))).href;
    try { return nextResolve(specifier, context); } catch (error) {
      if (error.code !== "ERR_MODULE_NOT_FOUND") throw error;
      for (const extension of [".ts", ".tsx"]) { try { return nextResolve(specifier + extension, context); } catch { /* Next extension. */ } }
      throw error;
    }
  },
  load(url, context, nextLoad) {
    if (url.endsWith(".tsx")) return { format: "module", shortCircuit: true, source: ts.transpileModule(readFileSync(fileURLToPath(url), "utf8"), {
      compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
    }).outputText };
    return nextLoad(url, context);
  },
});
const { driver } = await import(hooksUrl);
const { ProductListing, ProductDetail, catalogueHeaderQuery } = await import("../components/catalogue/ProductCatalogue.tsx");
const { default: Plan, ShoppingPlanCardActions, ShoppingPlanSearchGuard } = await import("../components/catalogue/CatalogueShoppingPlan.tsx");
const { default: QuickAdd } = await import("../components/cart/QuickAdd.tsx");
const { ProductVisitTracker } = await import("../components/catalogue/RecentlyViewedProducts.tsx");
const { default: Header } = await import("../components/layout/Header.tsx");
const { default: SearchSuggestions, suggestionDetailHref } = await import("../components/catalogue/SearchSuggestions.tsx");
function nodes(node) {
  if (node == null || typeof node === "boolean") return [];
  if (Array.isArray(node)) return node.flatMap(nodes);
  if (typeof node !== "object") return [node];
  if (typeof node.type === "function" && node.type.name === "BrowseLink") return nodes(node.type(node.props));
  return [node, ...nodes(node.props?.children)];
}
const text = node => nodes(node).filter(value => typeof value === "string" || typeof value === "number").join(" ");
const links = tree => nodes(tree).filter(node => typeof node.props?.href === "string");
const button = (tree, label) => nodes(tree).find(node => node.type === "button" && text(node) === label);
const cards = tree => nodes(tree).filter(node => node.type === "li" && nodes(node).some(child => child.type === QuickAdd));
function listing(params = {}, locale = "en", routeLocale = locale, reader = catalogue) {
  return ProductListing({ catalogue: reader, locale, routeLocale, criteria: readCatalogueCriteria(params), browse: readCatalogueBrowse(params), planHint: params.cartPlan });
}
const island = tree => nodes(tree).find(node => node.type === Plan);
function render(component, props, key = component.name) {
  if (!driver.instances.has(key)) driver.instances.set(key, []);
  driver.active = driver.instances.get(key); driver.index = 0;
  const tree = component(props);
  if (component === Plan) driver.context = tree.props.value;
  return tree;
}
function ui(root) { const element = island(root); return render(Plan, element.props, `plan:${element.key}`); }
async function browser(run) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "window"), navigation = [];
  Object.defineProperty(globalThis, "window", { configurable: true, value: {
    location: { assign(href) { navigation.push(href); } },
    get localStorage() { assert.fail("Planning must never access browser storage"); },
    get sessionStorage() { assert.fail("Planning must never access browser storage"); },
  } });
  driver.instances.clear();
  try { await run(navigation); } finally { driver.instances.clear(); driver.context = null; if (previous) Object.defineProperty(globalThis, "window", previous); else delete globalThis.window; }
}

test("F1/F2 published card actions are distinct, selected capture counts visible page only and never reads/writes any store", async () => browser(async navigation => {
  const root = listing({ page: "1" }); let tree = ui(root);
  assert.equal(driver.context.visible.length, 12);
  const first = render(ShoppingPlanCardActions, { publicId: id(1) });
  button(first, storefrontLabels.en.planAdd).props.onClick();
  assert.equal(navigation.length, 1); assert.deepEqual(readShoppingPlan(paramsOf(navigation[0]).params.cartPlan, records).lines, [{ publicId: id(1), quantity: 1 }]);
  // Retained click handler cannot navigate twice while the first navigation is pending.
  button(first, storefrontLabels.en.planAdd).props.onClick(); assert.equal(navigation.length, 1);
  driver.instances.clear(); navigation.length = 0;
  tree = ui(root); driver.context.toggle(id(4), true); tree = ui(root); driver.context.toggle(id(2), true); tree = ui(root);
  assert.equal(driver.context.ids.length, 2); assert.ok(text(tree).replace(/\s*\/\s*/g, " / ").includes("2 / 12")); button(tree, storefrontLabels.en.planAddSelected).props.onClick();
  assert.deepEqual(readShoppingPlan(paramsOf(navigation[0]).params.cartPlan, records).lines, [{ publicId: id(2), quantity: 1 }, { publicId: id(4), quantity: 1 }]);
  assert.equal(render(ShoppingPlanCardActions, { publicId: privateRecord.publicId }), null);
}));

test("F3 collect across pages then filter/sort and switch EN/HU/KO without losing exact plan or comparison reset semantics", async () => browser(async navigation => {
  let root = listing({ page: "1", cartPlan: portablePayload(twoLines) });
  let nextPage = links(root).find(link => link.props.rel === "next");
  assert.deepEqual(readShoppingPlan(paramsOf(nextPage.props.href).params.cartPlan, records).lines, twoLines);
  root = listing({ ...paramsOf(nextPage.props.href).params, page: "3" }); let tree = ui(root);
  driver.context.toggle(id(25), true); tree = ui(root); driver.context.toggle(id(27), true); tree = ui(root);
  button(tree, storefrontLabels.en.planAddSelected).props.onClick();
  const combined = paramsOf(navigation[0]).params.cartPlan;
  assert.deepEqual(readShoppingPlan(combined, records).lines, [...twoLines, { publicId: id(25), quantity: 1 }, { publicId: id(27), quantity: 1 }]);
  root = listing({ page: "3", cartPlan: combined, pickFirst: id(1) });
  const brand = links(root).find(link => link.props.href.includes("brand=Anua") && link.props["aria-current"] === undefined);
  assert.ok(brand); assert.equal(paramsOf(brand.props.href).params.page, undefined); assert.equal(paramsOf(brand.props.href).params.pickFirst, undefined);
  assert.equal(paramsOf(brand.props.href).params.cartPlan, combined);
  for (const locale of ["hu", "ko"]) {
    const query = catalogueHeaderQuery({ query: "", brand: "Anua", sort: "name-desc" }, readCatalogueBrowse({ page: "2", withLocaleInfo: "1", pickFirst: id(1) }), combined, catalogue);
    const switched = switchLocalePath("/en/products" + query, locale), parsed = paramsOf(switched);
    assert.equal(parsed.params.cartPlan, combined); assert.equal(parsed.params.pickFirst, undefined);
    assert.equal(parsed.params.sort, "name-desc"); assert.equal(parsed.params.withLocaleInfo, "1");
    assert.deepEqual(island(listing(parsed.params, locale)).props.plan.lines, readShoppingPlan(combined, records).lines);
  }
}));

test("F4 full plan is independent of current results; selected-locale missing text stays neutral; BigInt totals exact", async () => browser(async () => {
  const maximum = portablePayload(twoLines.map(line => ({ ...line, quantity: Number.MAX_SAFE_INTEGER })));
  for (const locale of ["en", "hu", "ko"]) {
    const root = listing({ q: "no matching content", cartPlan: maximum }, locale), tree = ui(root);
    assert.equal(cards(root).length, 0); assert.equal(driver.context.visible.length, 0);
    assert.ok(text(tree).includes((BigInt(Number.MAX_SAFE_INTEGER) * BigInt(2)).toString()));
    assert.ok(text(tree).includes(storefrontLabels[locale].planNotice));
    if (locale !== "en") { assert.ok(text(tree).includes(storefrontLabels[locale].details)); assert.ok(!text(tree).includes("en synthetic")); }
    assert.ok(!text(tree).includes("PRIVATE SECRET"));
    assert.equal(render(ShoppingPlanCardActions, { publicId: id(1) }), null);
  }
}));

test("F5 editing is explicit/absolute, invalid and unchanged drafts do not navigate or affect any stored selection", async () => browser(async navigation => {
  const root = listing({ cartPlan: portablePayload(twoLines) }); let tree = ui(root);
  const quantity = () => nodes(tree).find(node => typeof node.type === "function" && node.type.name === "PlannedQuantity");
  for (const raw of ["0", "1e2", "9007199254740992", "3"]) {
    let element = quantity(), form = render(element.type, element.props, "quantity");
    nodes(form).find(node => node.type === "input").props.onChange({ target: { value: raw } });
    form = render(element.type, element.props, "quantity"); form.props.onSubmit({ preventDefault() {} }); tree = ui(root);
    assert.equal(navigation.length, 0);
    assert.ok(text(tree).includes(raw === "3" ? storefrontLabels.en.planUnchanged : storefrontLabels.en.planInvalidQuantity));
  }
  const element = quantity(); element.props.apply("11");
  assert.equal(readShoppingPlan(paramsOf(navigation[0]).params.cartPlan, records).lines[0].quantity, 11);
  assert.equal(readShoppingPlan(paramsOf(navigation[0]).params.cartPlan, records).lines[1].quantity, 7);
}));

test("F1/F6 already-present quantity retained; individual removal and explicit Clear preserve context, distinct from browser Cart", async () => browser(async navigation => {
  const root = listing({ q: "Anua", sort: "name-asc", cartPlan: portablePayload(twoLines) }); let tree = ui(root);
  // id(3) is beplain and outside this view; use a full view for duplicate Add.
  const full = listing({ cartPlan: portablePayload(twoLines) }); tree = ui(full);
  button(render(ShoppingPlanCardActions, { publicId: id(1) }), storefrontLabels.en.planAdd).props.onClick();
  assert.equal(navigation.length, 0); assert.ok(text(ui(full)).includes(storefrontLabels.en.planUnchanged));
  tree = ui(root);
  nodes(tree).find(node => node.type === "button" && node.props["aria-label"]?.startsWith(storefrontLabels.en.planRemove)).props.onClick();
  assert.deepEqual(readShoppingPlan(paramsOf(navigation[0]).params.cartPlan, records).lines, [twoLines[1]]);
  const clear = links(tree).find(link => text(link) === storefrontLabels.en.planClear);
  assert.equal(paramsOf(clear.props.href).params.cartPlan, undefined); assert.equal(paramsOf(clear.props.href).params.q, "Anua"); assert.equal(paramsOf(clear.props.href).params.sort, "name-asc");
  const one = readShoppingPlan(portablePayload([twoLines[0]]), records);
  assert.equal(shoppingPlanHref("/products", "?q=Anua", one.lines.filter(line => line.publicId !== id(1))), "/products?q=Anua");
}));

test("F6 malformed/private/stale plan has neutral whole-plan rejection, no leaked data, no actionable Cart handoff", async () => browser(async navigation => {
  for (const raw of ["bad", [portablePayload(twoLines)], portablePayload([{ publicId: id(99), quantity: 1 }])]) {
    const root = listing({ cartPlan: raw }), element = island(root), tree = ui(root);
    const projection = JSON.stringify({ plan: element.props.plan, products: element.props.products, publishedIds: element.props.publishedIds });
    assert.deepEqual(element.props.plan.lines, []); assert.ok(!projection.includes("PRIVATE SECRET")); assert.ok(!projection.includes(id(99)));
    assert.ok(text(tree).includes(storefrontLabels.en.planInvalid));
    assert.ok(!links(tree).some(link => link.props.href.includes("cartDraft")));
    assert.ok(links(tree).some(link => text(link) === storefrontLabels.en.planDiscard && !link.props.href.includes("cartPlan")));
    assert.equal(render(ShoppingPlanCardActions, { publicId: id(1) }), null);
  }
  assert.deepEqual(navigation, []);
}));

test("F7 Plan -> detail -> Back preserves plan and page target; clean Detail and Cart/comparison/adjacent returns remain separate", async () => browser(async () => {
  const raw = portablePayload(twoLines), root = listing({ page: "3", cartPlan: raw }), tree = ui(root);
  const planDetail = links(tree).find(link => link.props.href.includes(`/products/${records[0].slug}`));
  const query = paramsOf(planDetail.props.href).params;
  const detail = ProductDetail({ slug: records[0].slug, catalogue, criteria: readCatalogueCriteria(query), browse: readCatalogueBrowse(query), planHint: query.cartPlan, cartReturn: true,
    comparisonContext: { first: id(1), second: id(2) } });
  const back = links(detail).find(link => text(link) === storefrontLabels.en.back);
  assert.equal(paramsOf(back.props.href).params.cartPlan, raw); assert.equal(paramsOf(back.props.href).params.page, "1");
  assert.ok(paramsOf(back.props.href).url.hash.startsWith("#catalogue-result-"));
  assert.ok(island(detail));
  assert.ok(!nodes(detail).some(node => node.type === ProductVisitTracker), "plan detail review must not automatically write Recently Viewed");
  for (const href of links(detail).filter(link => link.props.href.includes("compareFirst=") || link.props.href === "/cart" || link.props["aria-label"]?.includes("matching product:")).map(link => link.props.href)) assert.equal(paramsOf(href).params.cartPlan, undefined);
  const direct = ProductDetail({ slug: records[0].slug, catalogue });
  assert.equal(island(direct), undefined); assert.equal(links(direct).find(link => text(link) === storefrontLabels.en.back).props.href, "/products");
  assert.ok(nodes(direct).some(node => node.type === ProductVisitTracker), "ordinary detail visits retain the CLOSED tracker");
  assert.throws(() => ProductDetail({ slug: privateRecord.slug, catalogue, planHint: raw }), /NEXT_HTTP_ERROR_FALLBACK;404/);
}));

test("F3/F8 generated oversized links refuse rather than drop plan; Cart handoff stays bounded and separate", async () => browser(async navigation => {
  const raw = portablePayload(twoLines), root = listing({ q: "x".repeat(8100), cartPlan: raw }), tree = ui(root);
  assert.ok(text(tree).includes(storefrontLabels.en.planLimit));
  assert.equal(catalogueHeaderQuery({ query: "x".repeat(8100), brand: "" }, readCatalogueBrowse(), raw, catalogue), null);
  assert.equal(carryShoppingPlan("/products?q=" + "x".repeat(8100), two), null);
  assert.equal(driver.context.disabled, true);
  const handoff = links(tree).find(link => text(link) === storefrontLabels.en.planReviewCart);
  assert.ok(handoff); assert.deepEqual(Object.keys(paramsOf(handoff.props.href).params), ["cartDraft"]);
  assert.deepEqual(navigation, []);
  for (const prefix of ["", "/en", "/hu", "/ko"]) {
    const locale = prefix ? prefix.slice(1) : "en", routeLocale = prefix ? locale : null;
    const element = ui(listing({ cartPlan: raw }, locale, routeLocale));
    assert.equal(paramsOf(links(element).find(link => text(link) === storefrontLabels[locale].planReviewCart).props.href).url.pathname, `${prefix}/cart`);
  }
}));

test("F2 no plan action on zero results, duplicate identity, invalid identity; responsive native controls have explicit names", async () => browser(async () => {
  const zero = ui(listing({}, "en", null, createLocalCatalogueReader([])));
  assert.equal(driver.context.visible.length, 0); assert.equal(render(ShoppingPlanCardActions, { publicId: id(1) }), null);
  assert.ok(text(zero).includes(storefrontLabels.en.planEmpty));
  const props = { ...island(listing()).props, publishedIds: [id(1), id(1)] };
  render(Plan, props, "duplicates"); assert.equal(render(ShoppingPlanCardActions, { publicId: id(1) }), null);
  for (const locale of ["en", "hu", "ko"]) {
    const tree = ui(listing({ cartPlan: portablePayload(twoLines) }, locale));
    assert.match(nodes(tree).find(node => node.type === "section").props.className, /min-w-0/);
    assert.ok(nodes(tree).filter(node => node.type === "button").every(node => node.props.type === "button" && /min-h-11.*break-words/.test(node.props.className)));
    assert.ok(nodes(tree).some(node => node.props?.role === "status"));
  }
}));

test("Source boundaries: Cart stores/protocol not forked; forms carry only validated plan; metadata and publication untouched", () => {
  const helper = readFileSync(join(repo, "lib/catalog/catalogue-shopping-plan.ts"), "utf8"), client = readFileSync(join(repo, "components/catalogue/CatalogueShoppingPlan.tsx"), "utf8");
  assert.match(helper, /readPortableLink/); assert.match(helper, /resolvePortableLines/); assert.match(helper, /portablePayload/);
  assert.doesNotMatch(helper + client, /localStorage|sessionStorage|changeBrowserCart|setItem|fetch\(/);
  assert.doesNotMatch(client, /server-only|local-catalogue|catalogue-discovery/);
  assert.match(readFileSync(join(repo, "data/catalogue.ts"), "utf8"), /Object.freeze\(\[\]\)/);
  for (const path of ["app/products/page.tsx", "app/products/[slug]/page.tsx", "app/[locale]/products/page.tsx", "app/[locale]/products/[slug]/page.tsx"]) {
    const source = readFileSync(join(repo, path), "utf8"), metadata = source.slice(source.indexOf("export async function generateMetadata"), source.indexOf("export default"));
    assert.match(source, /planHint[=:]/); assert.doesNotMatch(metadata, /cartPlan|planHint|catalogueHeaderQuery/);
  }
  const root = listing({ cartPlan: portablePayload(twoLines) });
  assert.equal(nodes(root).find(node => node.type === "input" && node.props.name === "cartPlan").props.value, portablePayload(twoLines));
  assert.ok(nodes(root).some(node => node.type === ShoppingPlanSearchGuard));
  assert.deepEqual(Object.keys(storefrontLabels.en).sort(), Object.keys(storefrontLabels.hu).sort());
  assert.deepEqual(Object.keys(storefrontLabels.en).sort(), Object.keys(storefrontLabels.ko).sort());
});

test("F3 GET search guard allows bounded native submission and explicitly refuses oversize without navigation", async () => {
  const previousForm = Object.getOwnPropertyDescriptor(globalThis, "HTMLFormElement"), previousData = Object.getOwnPropertyDescriptor(globalThis, "FormData");
  class SyntheticForm { constructor(entries) { this.entries = entries; } }
  class SyntheticData { constructor(form) { this.entries = form.entries; } [Symbol.iterator]() { return this.entries[Symbol.iterator](); } }
  Object.defineProperty(globalThis, "HTMLFormElement", { configurable: true, value: SyntheticForm });
  Object.defineProperty(globalThis, "FormData", { configurable: true, value: SyntheticData });
  try {
    driver.instances.clear(); let prevented = 0;
    const props = { path: "/en/products", locale: "en", children: null };
    let tree = render(ShoppingPlanSearchGuard, props);
    tree.props.onSubmit({ target: new SyntheticForm([["q", "Anua"], ["cartPlan", portablePayload(twoLines)]]), preventDefault() { prevented++; } });
    assert.equal(prevented, 0);
    tree.props.onSubmit({ target: new SyntheticForm([["q", "x".repeat(8192)], ["cartPlan", portablePayload(twoLines)]]), preventDefault() { prevented++; } });
    tree = render(ShoppingPlanSearchGuard, props); assert.equal(prevented, 1); assert.ok(text(tree).includes(storefrontLabels.en.planLimit));
  } finally {
    driver.instances.clear();
    if (previousForm) Object.defineProperty(globalThis, "HTMLFormElement", previousForm); else delete globalThis.HTMLFormElement;
    if (previousData) Object.defineProperty(globalThis, "FormData", previousData); else delete globalThis.FormData;
  }
});

test("F5 SSR/no-JS quantity form remains disabled and cannot accidentally submit away the URL-owned plan", () => {
  driver.instances.clear();
  const tree = ui(listing({ cartPlan: portablePayload(twoLines) }));
  const element = nodes(tree).find(node => typeof node.type === "function" && node.type.name === "PlannedQuantity");
  let calls = 0;
  const form = render(element.type, { ...element.props, apply() { calls++; } }, "ssr-quantity");
  assert.ok(nodes(form).filter(node => node.type === "input" || node.type === "button").every(node => node.props.disabled));
  form.props.onSubmit({ preventDefault() {} }); assert.equal(calls, 0);
  driver.instances.clear(); driver.context = null;
});

test("F2/F5 UI refuses line 41 and an edited over-limit URL without navigation or partial plan changes", async () => browser(async navigation => {
  const forty = records.slice(0, 40).map(record => ({ publicId: record.publicId, quantity: 1 }));
  const root = listing({ page: "4", cartPlan: portablePayload(forty) }); let tree = ui(root);
  driver.context.toggle(id(41), true); tree = ui(root);
  button(tree, storefrontLabels.en.planAddSelected).props.onClick(); tree = ui(root);
  assert.ok(text(tree).includes(storefrontLabels.en.planLimit)); assert.deepEqual(navigation, []);
  assert.equal(island(root).props.plan.lines.length, 40);
  driver.instances.clear();
  const overhead = shoppingPlanHref("/en/products", "?q=", twoLines).length;
  const nearLimit = listing({ q: "x".repeat(8192 - overhead - 1), cartPlan: portablePayload(twoLines) });
  tree = ui(nearLimit);
  const quantity = nodes(tree).find(node => typeof node.type === "function" && node.type.name === "PlannedQuantity");
  quantity.props.apply(String(Number.MAX_SAFE_INTEGER)); tree = ui(nearLimit);
  assert.ok(text(tree).includes(storefrontLabels.en.planLimit)); assert.deepEqual(navigation, []);
  assert.deepEqual(island(nearLimit).props.plan.lines, twoLines);
}));

test("Correction: desktop/mobile Shop retain validated plan in legacy/EN/HU/KO; clean Shop and menu semantics remain", () => {
  for (const prefix of ["", "/en", "/hu", "/ko"]) {
    driver.instances.clear(); driver.pathname = `${prefix}/products/synthetic-1`;
    const locale = prefix ? prefix.slice(1) : "en", raw = portablePayload(twoLines);
    const query = catalogueHeaderQuery({ query: "Anua & skin", brand: "Anua", sort: "name-desc" }, readCatalogueBrowse({ page: "2" }), raw, catalogue);
    const tree = render(Header, { catalogueQuery: query });
    const shop = links(tree).filter(node => text(node) === storefrontLabels[locale].shop);
    assert.equal(shop.length, 2);
    for (const link of shop) {
      const { url, params } = paramsOf(link.props.href);
      assert.equal(url.pathname, `${prefix}/products`); assert.equal(params.cartPlan, raw);
      assert.equal(params.q, "Anua & skin"); assert.equal(params.brand, "Anua"); assert.equal(params.page, "2");
    }
    const menu = nodes(tree).find(node => node.type === "button" && node.props["aria-controls"] === "mobile-navigation");
    assert.equal(menu.props["aria-expanded"], false); menu.props.onClick();
    assert.equal(nodes(render(Header, { catalogueQuery: query })).find(node => node.props?.id === "mobile-navigation").props.hidden, false);
    shop[1].props.onClick();
    assert.equal(nodes(render(Header, { catalogueQuery: query })).find(node => node.props?.id === "mobile-navigation").props.hidden, true);
    for (const query of ["", "?q=Anua&sort=name-asc"]) {
      const clean = links(render(Header, { catalogueQuery: query })).filter(node => text(node) === storefrontLabels[locale].shop);
      assert.equal(clean.length, 2); assert.ok(clean.every(link => link.props.href === `${prefix}/products`));
    }
  }
  driver.instances.clear();
});

test("Correction: null header context retains skip/menu/Home/Brands/Cart and explicitly refuses unsafe Shop/Search without null URLs", () => {
  for (const prefix of ["", "/en", "/hu", "/ko"]) {
    driver.instances.clear(); driver.pathname = `${prefix}/products`;
    const locale = prefix ? prefix.slice(1) : "en", labels = storefrontLabels[locale];
    const tree = render(Header, { catalogueQuery: null }), all = nodes(tree);
    assert.equal(all.filter(node => node.type === "header").length, 1);
    assert.ok(links(tree).some(link => link.props.href === "#main-content"));
    for (const path of ["/", "/brands", "/cart"]) assert.ok(links(tree).some(link => link.props.href === storefrontHref(path, prefix ? locale : null)));
    for (const label of [labels.shop, labels.search]) {
      const refused = all.filter(node => node.type === "a" && text(node) === label);
      assert.equal(refused.length, 2); assert.ok(refused.every(node => node.props.href === undefined && node.props["aria-disabled"] === true && node.props.role === "link"));
    }
    assert.ok(all.some(node => node.props?.role === "status" && text(node) === labels.planLimit));
    assert.ok(!links(tree).some(link => link.props.href.includes("null")));
    const menu = all.find(node => node.type === "button" && node.props["aria-controls"] === "mobile-navigation");
    menu.props.onClick(); assert.equal(nodes(render(Header, { catalogueQuery: null })).find(node => node.props?.id === "mobile-navigation").props.hidden, false);
  }
  for (const path of ["app/products/page.tsx", "app/products/[slug]/page.tsx", "app/[locale]/products/page.tsx", "app/[locale]/products/[slug]/page.tsx"]) {
    const source = readFileSync(join(repo, path), "utf8");
    assert.match(source, /^\s*<Header catalogueQuery=\{headerQuery\} \/>/m);
    assert.doesNotMatch(source, /headerQuery !== null && <Header/);
  }
  driver.instances.clear();
});

test("Correction: suggestions compose CLOSED q/brand/sort links with validated plan; no-plan protocol remains identical", () => {
  for (const prefix of ["", "/en", "/hu", "/ko"]) {
    const locale = prefix ? prefix.slice(1) : "en", routeLocale = prefix ? locale : null;
    const root = listing({ q: "synthetic", brand: "Anua", sort: "name-desc", cartPlan: portablePayload(twoLines) }, locale, routeLocale);
    const element = nodes(root).find(node => node.type === SearchSuggestions);
    assert.deepEqual(element.props.plan.lines, twoLines);
    driver.instances.clear();
    const tree = render(SearchSuggestions, element.props), suggestions = links(tree);
    assert.ok(suggestions.length > 0);
    for (const link of suggestions) {
      const { url, params } = paramsOf(link.props.href);
      assert.ok(url.pathname.startsWith(`${prefix}/products/synthetic-`));
      assert.equal(params.cartPlan, portablePayload(twoLines)); assert.equal(params.q, "synthetic");
      assert.equal(params.brand, "Anua"); assert.equal(params.sort, "name-desc");
      assert.equal(Object.keys(params).length, 4);
    }
    const first = paramsOf(suggestions[0].props.href);
    const detail = ProductDetail({ slug: first.url.pathname.split("/").at(-1), catalogue, locale, routeLocale,
      criteria: readCatalogueCriteria(first.params), browse: readCatalogueBrowse(first.params), planHint: first.params.cartPlan });
    const restored = paramsOf(links(detail).find(link => text(link) === storefrontLabels[locale].back).props.href);
    assert.equal(restored.params.cartPlan, portablePayload(twoLines));
    assert.equal(restored.params.q, "synthetic"); assert.equal(restored.params.brand, "Anua"); assert.equal(restored.params.sort, "name-desc");
    driver.instances.clear();
    const noPlan = { ...element.props, plan: undefined };
    for (const link of links(render(SearchSuggestions, noPlan))) {
      const slug = paramsOf(link.props.href).url.pathname.split("/").at(-1);
      assert.equal(link.props.href, suggestionDetailHref(slug, routeLocale, "synthetic", "Anua", "name-desc"));
    }
    const invalid = nodes(listing({ q: "synthetic", cartPlan: "bad" }, locale, routeLocale)).find(node => node.type === SearchSuggestions);
    assert.equal(invalid.props.plan, undefined);
  }
  driver.instances.clear();
});

test("Correction: oversized suggestion URL refuses explicitly instead of emitting a link without its plan", () => {
  const products = [{ publicId: id(1), slug: "synthetic-1", brand: "Anua", name: "x".repeat(4096), description: null }];
  const forty = readShoppingPlan(portablePayload(records.slice(0, 40).map(record => ({ publicId: record.publicId, quantity: 1 }))), records);
  const props = { products, initialQuery: "x".repeat(4096), locale: "en", routeLocale: "en", appliedCriteria: { brand: "y".repeat(3000) }, plan: forty, children: null };
  driver.instances.clear();
  const tree = render(SearchSuggestions, props);
  assert.equal(links(tree).length, 0); assert.ok(text(tree).includes(storefrontLabels.en.planLimit));
  driver.instances.clear();
  const cleanFallback = render(SearchSuggestions, { ...props, initialQuery: "x", appliedCriteria: { brand: "y".repeat(4097) } });
  const href = links(cleanFallback)[0].props.href;
  assert.equal(paramsOf(href).params.cartPlan, portablePayload(forty.lines));
  driver.instances.clear();
});

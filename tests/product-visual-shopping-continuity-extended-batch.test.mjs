import assert from "node:assert/strict";
import test from "node:test";
import { createRequire, registerHooks } from "node:module";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";
import { createLocalCatalogueReader } from "../lib/catalog/editorial-catalogue.ts";
import { CART_STORAGE_KEY, serializeCart } from "../lib/cart/cart-state.ts";
import { FAVORITES_STORAGE_KEY, serializeFavorites } from "../lib/favorites/favorite-state.ts";
import { RECENT_STORAGE_KEY, serializeRecent } from "../lib/recently-viewed/recent-state.ts";
import { storefrontLabels } from "../lib/storefront/localization.ts";
import { comparisonLabels } from "../lib/comparison/labels.ts";
import { cartLabels } from "../lib/cart/labels.ts";
import { favoriteLabels } from "../lib/favorites/labels.ts";

// Existing installed-TypeScript + Node JSX/store fixture convention. No browser/hydration proof.
const require = createRequire(import.meta.url), repo = dirname(dirname(fileURLToPath(import.meta.url)));
const reactRoot = dirname(require.resolve("react/package.json"));
const hooksUrl = "data:text/javascript," + encodeURIComponent(`
export const driver={instances:new Map(),active:[],index:0,effects:[],subscriptions:new Map(),serial:0};
export function useState(initial){const state=driver.active,index=driver.index++;if(!(index in state))state[index]=typeof initial==='function'?initial():initial;return [state[index],value=>{state[index]=typeof value==='function'?value(state[index]):value;}];}
export function useRef(current){return useState(()=>({current}))[0];}
export function useId(){return useState(()=> 'synthetic-'+(++driver.serial))[0];}
export function useCallback(callback,deps){const state=driver.active,index=driver.index++,previous=state[index];if(!previous||deps.some((value,i)=>value!==previous.deps[i]))state[index]={callback,deps};return state[index].callback;}
export function useEffect(effect,deps){const state=driver.active,index=driver.index++,previous=state[index];if(!previous||!deps||deps.some((value,i)=>value!==previous.deps?.[i])){previous?.cleanup?.();const entry={deps,cleanup:null};state[index]=entry;driver.effects.push(()=>{entry.cleanup=effect();});}}
export function useSyncExternalStore(subscribe,getSnapshot,getServerSnapshot){driver.subscriptions.set(subscribe,getSnapshot);return typeof window==='undefined'?getServerSnapshot():getSnapshot();}
`);
const catalogueSymbol = "hanapure.batch8.synthetic.catalogue";
const cartReaderUrl = "data:text/javascript," + encodeURIComponent(`export const localCatalogue={listPublished:()=>globalThis[Symbol.for('${catalogueSymbol}')]?.listPublished()??[]};`);
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "@/lib/catalog/local-catalogue" && context.parentURL?.endsWith("/components/cart/CartContent.tsx")) return { url: cartReaderUrl, shortCircuit: true };
    if (specifier === "react" && /\/(components\/(catalogue\/(ProductMediaGallery|ProductImage|ProductComparison|SavedProductsBar|RecentlyViewedProducts)|cart\/ShoppingCart)\.tsx|lib\/(cart\/browser-cart|favorites\/browser-favorites|recently-viewed\/browser-recent)\.ts)$/.test(context.parentURL ?? "")) return { url: hooksUrl, shortCircuit: true };
    if (specifier === "react") return { url: pathToFileURL(join(reactRoot, "index.js")).href, shortCircuit: true };
    if (specifier === "react/jsx-runtime") return { url: pathToFileURL(join(reactRoot, "jsx-runtime.js")).href, shortCircuit: true };
    if (specifier === "react-dom") return { url: pathToFileURL(join(dirname(require.resolve("react-dom/package.json")), "index.js")).href, shortCircuit: true };
    if (specifier === "next/link") return nextResolve("next/link.js", context);
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
const { default: ProductMediaGallery } = await import("../components/catalogue/ProductMediaGallery.tsx");
const { default: ProductImage } = await import("../components/catalogue/ProductImage.tsx");
const { default: ProductComparison } = await import("../components/catalogue/ProductComparison.tsx");
const { ProductListing, ProductDetail } = await import("../components/catalogue/ProductCatalogue.tsx");
const { default: SavedProductsBar } = await import("../components/catalogue/SavedProductsBar.tsx");
const { default: RecentlyViewedProducts, recentlyViewedLabels } = await import("../components/catalogue/RecentlyViewedProducts.tsx");
const { default: CartContent } = await import("../components/cart/CartContent.tsx");
const { default: ShoppingCart } = await import("../components/cart/ShoppingCart.tsx");
const browserCart = await import("../lib/cart/browser-cart.ts"), favorites = await import("../lib/favorites/browser-favorites.ts"), recent = await import("../lib/recently-viewed/browser-recent.ts");
const id = "12345678-abcd-1234-abcd-123456789abc", other = "22345678-abcd-1234-abcd-123456789abc", hidden = "32345678-abcd-1234-abcd-123456789abc";
const cover = (locale, name, index = 0) => ({ src: `/synthetic/${locale}-${name}-${index}.webp`, alt: `${locale} synthetic ${name} ${index}` });
const content = (locale, name) => ({ name: `${locale} ${name}`, description: "Synthetic editorial fixture only.", images: [cover(locale, name), cover(locale, name, 1)], usage: "Synthetic usage.", caution: "Synthetic warning remains visible." });
const record = (publicId, slug, state = "published") => ({ publicId, slug, brand: "Anua", state,
  translations: { en: content("en", slug), hu: content("hu", slug), ko: content("ko", slug) } });
const records = [record(id, "one"), { ...record(other, "two"), translations: { en: content("en", "two"), hu: null, ko: { ...content("ko", "two"), images: [] } } }, record(hidden, "private", "draft")];
const catalogue = createLocalCatalogueReader(records);
function nodes(node) {
  if (node == null || typeof node === "boolean") return [];
  if (Array.isArray(node)) return node.flatMap(nodes);
  if (typeof node !== "object") return [node];
  return [node, ...nodes(node.props?.children)];
}
const text = node => nodes(node).filter(value => typeof value === "string" || typeof value === "number").join(" ");
const button = (tree, label) => nodes(tree).find(node => node.type === "button" && text(node) === label);
const images = tree => nodes(tree).filter(node => node.type === ProductImage).map(node => ({ src: node.props.src, alt: node.props.alt }));
const boxes = tree => nodes(tree).filter(node => node.type === "input" && node.props.type === "checkbox");
function render(component, props, key = component.name, commit) {
  if (!driver.instances.has(key)) driver.instances.set(key, []);
  driver.active = driver.instances.get(key); driver.index = 0; driver.effects = [];
  const tree = component(props); commit?.(tree);
  for (const effect of driver.effects) effect();
  return tree;
}
function dispose(key) { for (const value of driver.instances.get(key) ?? []) value?.cleanup?.(); driver.instances.delete(key); }
const nativeImage = (src, complete = false, naturalWidth = 0) => ({ tagName: "IMG", complete, naturalWidth, getAttribute: key => key === "src" ? src : null });
function galleryDOM() {
  return { current: null, focus: [], dialogsOpened: 0, dialogsClosed: 0,
    modal: { open: false }, bind(tree) {
      const frame = nodes(tree).find(node => node.props?.onLoadCapture);
      frame.props.ref({ querySelector: selector => { assert.equal(selector, "img:not(noscript img)"); return this.current; }, focus: () => this.focus.push("frame") });
      const modal = nodes(tree).find(node => node.type === "dialog");
      if (!modal) return;
      this.modal.showModal = () => { this.modal.open = true; this.dialogsOpened++; };
      this.modal.close = () => { this.modal.open = false; this.dialogsClosed++; };
      modal.props.ref.current = this.modal;
      const launch = nodes(tree).find(node => node.props?.["aria-haspopup"] === "dialog");
      launch.props.ref.current = { disabled: launch.props.disabled, focus: () => this.focus.push("launcher") };
      nodes(modal).find(node => node.type === "button").props.ref.current = { focus: () => this.focus.push("close") };
    } };
}
async function stores(run) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "window");
  const values = new Map([[CART_STORAGE_KEY, serializeCart([{ publicId: id.toUpperCase(), quantity: 2 }, { publicId: hidden, quantity: 3 }, { publicId: other, quantity: 4 }])],
    [FAVORITES_STORAGE_KEY, serializeFavorites([other, hidden, id])], [RECENT_STORAGE_KEY, serializeRecent([id, hidden, other])]]);
  const writes = [], events = new Set();
  Object.defineProperty(globalThis, "window", { configurable: true, value: { localStorage: {
    getItem: key => values.get(key) ?? null, setItem: (key, value) => { writes.push(key); values.set(key, value); },
  }, addEventListener: (type, callback) => { if (type === "storage") events.add(callback); }, removeEventListener: (type, callback) => { if (type === "storage") events.delete(callback); } } });
  driver.instances.clear(); browserCart.useBrowserCart(); favorites.useBrowserFavorites(); recent.useBrowserRecent();
  const unsubscribers = [...driver.subscriptions.keys()].map(subscribe => subscribe(() => {}));
  const notify = key => events.forEach(callback => callback({ key })); notify(null);
  try { await run({ values, writes, notify }); } finally {
    unsubscribers.forEach(unsubscribe => unsubscribe());
    for (const key of driver.instances.keys()) dispose(key);
    if (previous) Object.defineProperty(globalThis, "window", previous); else delete globalThis.window;
  }
}

test("F1 SSR/no-JS retains exact first native image for one/many; zero/missing-locale has no gallery", () => {
  assert.equal(ProductMediaGallery({ images: [] }), null);
  for (const locale of ["en", "hu", "ko"]) for (const count of [1, 2]) {
    const media = records[0].translations[locale].images.slice(0, count);
    const element = ProductMediaGallery({ images: media, locale });
    const tree = render(element.type, element.props, "ssr-" + element.key);
    const native = nodes(tree).find(node => node.type === "img");
    assert.equal(native.props.src, media[0].src); assert.equal(native.props.alt, media[0].alt);
    assert.match(native.props.className, /object-contain/); assert.ok(!nodes(tree).some(node => node.type === "button" || node.type === "dialog"));
  }
  assert.ok(!nodes(ProductDetail({ slug: "two", catalogue, locale: "hu", routeLocale: "hu" })).some(node => node.type === ProductMediaGallery));
  for (const slug of ["private", "unknown"]) assert.throws(() => ProductDetail({ slug, catalogue }));
});

test("F1 loaded current image opens native modal with focus entry, Close/Escape restore launcher, and bounded Previous/Next", async () => stores(async ({ writes }) => {
  for (const locale of ["en", "hu", "ko"]) {
    const media = records[0].translations[locale].images, labels = storefrontLabels[locale];
    const element = ProductMediaGallery({ images: media, locale }), dom = galleryDOM();
    dom.current = nativeImage(media[0].src);
    const draw = () => render(element.type, element.props, element.key, tree => dom.bind(tree));
    let tree = draw(); assert.equal(button(tree, labels.inspectImage).props.disabled, true);
    button(tree, labels.inspectImage).props.onClick(); assert.equal(dom.dialogsOpened, 0);
    dom.current = nativeImage(media[0].src, true, 80); nodes(tree).find(node => node.props?.onLoadCapture).props.onLoadCapture({ target: dom.current });
    tree = draw(); button(tree, labels.inspectImage).props.onClick(); tree = draw();
    assert.equal(dom.modal.open, true); assert.equal(dom.focus.at(-1), "close");
    let modal = nodes(tree).find(node => node.type === "dialog");
    assert.equal(modal.props["aria-label"], `${labels.inspectImage}: ${media[0].alt}`);
    assert.deepEqual(images(modal), [media[0]]); assert.match(nodes(modal).find(node => node.props?.onErrorCapture).props.className, /65dvh/);
    button(modal, labels.closeImage).props.onClick(); tree = draw(); assert.equal(dom.modal.open, false); assert.equal(dom.focus.at(-1), "launcher");
    button(tree, labels.nextImage).props.onClick(); dom.current = nativeImage(media[1].src, true, 80); tree = draw(); tree = draw();
    assert.equal(button(tree, labels.nextImage).props.disabled, true); assert.equal(button(tree, labels.previousImage).props.disabled, false);
    assert.deepEqual(images(tree).slice(0, 1), [media[1]]);
    button(tree, labels.inspectImage).props.onClick(); tree = draw(); modal = nodes(tree).find(node => node.type === "dialog");
    assert.deepEqual(images(modal), [media[1]]);
    let prevented = false; modal.props.onCancel({ preventDefault() { prevented = true; } });
    assert.equal(prevented, true); assert.equal(dom.modal.open, false); assert.equal(dom.focus.at(-1), "launcher");
    dispose(element.key);
  }
  assert.deepEqual(writes, []);
}));

test("F1 arrow handling stays gallery-local and ignores modifiers/editable inputs; single image stays inspectable", async () => stores(async () => {
  const media = records[0].translations.en.images, element = ProductMediaGallery({ images: media }), dom = galleryDOM();
  dom.current = nativeImage(media[0].src, true, 30);
  const draw = () => render(element.type, element.props, element.key, tree => dom.bind(tree));
  let tree = draw(); tree = draw();
  for (const patch of [{ target: { tagName: "INPUT" } }, { target: { tagName: "SELECT" } }, { target: { tagName: "DIV", isContentEditable: true } }, { ctrlKey: true }, { altKey: true }, { metaKey: true }, { shiftKey: true }]) {
    let prevented = false;
    tree.props.onKeyDown({ key: "ArrowRight", target: { tagName: "BUTTON" }, preventDefault() { prevented = true; }, ...patch });
    tree = draw(); assert.equal(images(tree)[0].src, media[0].src); assert.equal(prevented, false);
  }
  tree.props.onKeyDown({ key: "ArrowRight", target: { tagName: "BUTTON" }, preventDefault() {} });
  dom.current = nativeImage(media[1].src, true, 30); tree = draw();
  assert.equal(images(tree)[0].src, media[1].src);
  const thumbnails = nodes(tree).filter(node => node.type === "button" && node.props["aria-pressed"] !== undefined);
  assert.equal(thumbnails[1].props["aria-pressed"], true); thumbnails[0].props.onClick();
  dom.current = nativeImage(media[0].src, true, 30); tree = draw(); assert.equal(images(tree)[0].src, media[0].src);
  dispose(element.key);
  const single = ProductMediaGallery({ images: media.slice(0, 1) }), singleDom = galleryDOM(); singleDom.current = nativeImage(media[0].src, true, 30);
  const singleDraw = () => render(single.type, single.props, single.key, tree => singleDom.bind(tree));
  singleDraw(); const one = singleDraw(); assert.equal(button(one, storefrontLabels.en.inspectImage).props.disabled, false);
  assert.ok(!button(one, storefrontLabels.en.previousImage)); assert.ok(!button(one, storefrontLabels.en.nextImage));
}));

test("F1 failure blocks inspection, cached success recovers on new source/locale, and old modal closes on identity reset", async () => stores(async () => {
  const media = records[0].translations.en.images, element = ProductMediaGallery({ images: media }), dom = galleryDOM();
  dom.current = nativeImage(media[0].src, true, 0);
  const draw = () => render(element.type, element.props, element.key, tree => dom.bind(tree));
  let tree = draw(); tree = draw(); button(tree, storefrontLabels.en.inspectImage).props.onClick(); assert.equal(dom.modal.open, false);
  button(tree, storefrontLabels.en.nextImage).props.onClick(); dom.current = nativeImage(media[1].src, true, 100); tree = draw(); tree = draw();
  button(tree, storefrontLabels.en.inspectImage).props.onClick(); tree = draw(); assert.equal(dom.modal.open, true);
  const modal = nodes(tree).find(node => node.type === "dialog");
  nodes(modal).find(node => node.props?.onErrorCapture).props.onErrorCapture(); tree = draw();
  assert.equal(dom.modal.open, false); assert.equal(button(tree, storefrontLabels.en.inspectImage).props.disabled, true);
  nodes(tree).find(node => node.type === "dialog").props.onClose();
  assert.equal(dom.focus.at(-1), "frame"); // A now-disabled launcher cannot accept restored focus.
  const replacement = ProductMediaGallery({ images: records[0].translations.ko.images, locale: "ko" });
  assert.notEqual(replacement.key, element.key);
  // Reopen the good source, then simulate React unmount cleanup before a new keyed instance.
  nodes(tree).find(node => node.props?.onLoadCapture).props.onLoadCapture({ target: dom.current }); tree = draw();
  button(tree, storefrontLabels.en.inspectImage).props.onClick(); assert.equal(dom.modal.open, true);
  dispose(element.key); assert.equal(dom.modal.open, false);
  const nextDom = galleryDOM(); nextDom.current = nativeImage(records[0].translations.ko.images[0].src);
  const next = render(replacement.type, replacement.props, replacement.key, tree => nextDom.bind(tree));
  assert.equal(images(next)[0].src, records[0].translations.ko.images[0].src); assert.equal(nextDom.modal.open, false);
  assert.equal(button(next, storefrontLabels.ko.inspectImage).props.disabled, true);
  for (const slug of ["one", "two"]) {
    const detail = ProductDetail({ slug, catalogue });
    assert.ok(nodes(detail).find(node => node.type === ProductMediaGallery).key.startsWith(slug === "one" ? id : other));
  }
}));

test("F2/F3 server projections expose only first published selected-locale src/alt, never draft or alternate-locale media", () => {
  for (const locale of ["en", "hu", "ko"]) {
    const listing = ProductListing({ catalogue, locale, routeLocale: locale });
    const board = nodes(listing).find(node => node.type === ProductComparison), saved = nodes(listing).find(node => node.type === SavedProductsBar), history = nodes(listing).find(node => node.type === RecentlyViewedProducts);
    for (const projection of [board.props.products, saved.props.products, history.props.products]) {
      assert.deepEqual(projection.map(item => item.publicId), [id, other]);
      for (const item of projection) {
        const expected = catalogue.listPublished().find(record => record.publicId === item.publicId).translations[locale]?.images[0] ?? null;
        assert.deepEqual(item.image, expected);
        if (item.image) assert.deepEqual(Object.keys(item.image).sort(), ["alt", "src"]);
      }
      assert.ok(!JSON.stringify(projection).includes("private"));
    }
  }
});

test("F2 comparison visuals follow current selection/swap and retain warnings, difference and share controls", async () => stores(async ({ writes }) => {
  for (const locale of ["en", "hu", "ko"]) {
    const element = nodes(ProductListing({ catalogue, locale, routeLocale: locale })).find(node => node.type === ProductComparison);
    let tree = render(ProductComparison, element.props, locale);
    const expected = element.props.products.filter(product => product.image).map(product => product.image);
    assert.deepEqual(images(tree), expected);
    button(tree, comparisonLabels[locale].swap).props.onClick(); tree = render(ProductComparison, element.props, locale);
    assert.deepEqual(images(tree), [...expected].reverse());
    button(tree, comparisonLabels[locale].focusDifferences).props.onClick(); tree = render(ProductComparison, element.props, locale);
    assert.ok(text(tree).includes("Synthetic warning remains visible."));
    assert.ok(nodes(tree).some(node => typeof node.type === "function" && node.type.name === "CopyComparisonLink"));
    assert.ok(!JSON.stringify(images(tree)).includes("private"));
  }
  assert.deepEqual(writes, []);
}));

function assertSeparatePreviewLinks(tree) {
  for (const link of nodes(tree).filter(node => node.props?.href && images(node).length)) {
    assert.match(link.props.className, /max-w-full/);
    assert.ok(!nodes(link.props.children).some(node => node.props?.href || ["button", "input", "select"].includes(node.type)));
    assert.ok(images(link).every(image => image.alt));
  }
}
test("F3 Saved/Recent thumbnails preserve separate controls, exact-pair comparison, selection and cross-tab public-only gates", async () => stores(async ({ values, notify, writes }) => {
  for (const locale of ["en", "hu", "ko"]) {
    const listing = ProductListing({ catalogue, locale, routeLocale: locale });
    for (const component of [SavedProductsBar, RecentlyViewedProducts]) {
      const element = nodes(listing).find(node => node.type === component), key = locale + component.name;
      let tree = render(component, element.props, key);
      assertSeparatePreviewLinks(tree); assert.equal(boxes(tree).length, 2);
      assert.ok(!JSON.stringify(images(tree)).includes("private"));
      boxes(tree).forEach(box => box.props.onChange({ target: { checked: true } })); tree = render(component, element.props, key);
      const labels = component === SavedProductsBar ? favoriteLabels[locale] : recentlyViewedLabels[locale];
      button(tree, labels.compareSelected).props.onClick(); tree = render(component, element.props, key);
      const comparison = nodes(tree).find(node => node.type === ProductComparison); assert.ok(comparison);
      const compared = render(ProductComparison, comparison.props, "nested-" + key);
      assert.ok(images(compared).every(image => image.src.startsWith(`/synthetic/${locale}-`)));
      const storageKey = component === SavedProductsBar ? FAVORITES_STORAGE_KEY : RECENT_STORAGE_KEY;
      const raw = values.get(storageKey); values.set(storageKey, component === SavedProductsBar ? serializeFavorites([hidden]) : serializeRecent([hidden])); notify(storageKey);
      tree = render(component, element.props, key); assert.deepEqual(images(tree), []); assert.equal(boxes(tree).length, 0);
      values.set(storageKey, raw); notify(storageKey);
    }
  }
  assert.deepEqual(writes, []);
}));

test("F4 actual CartContent publishes a minimal locale image; Cart media stays public-only and view changes never write", async () => stores(async ({ writes, values }) => {
  const symbol = Symbol.for(catalogueSymbol), previous = globalThis[symbol]; globalThis[symbol] = catalogue;
  try {
    for (const locale of ["en", "hu", "ko"]) {
      const server = CartContent({ locale, routeLocale: locale }), element = nodes(server).find(node => node.type === ShoppingCart);
      assert.deepEqual(element.props.products.map(product => product.publicId), [id, other]);
      for (const product of element.props.products) assert.deepEqual(product.image, catalogue.listPublished().find(item => item.publicId === product.publicId).translations[locale]?.images[0] ?? null);
      const key = "cart-" + locale; let tree = render(ShoppingCart, element.props, key);
      assertSeparatePreviewLinks(tree);
      assert.ok(images(tree).every(image => image.src.startsWith(`/synthetic/${locale}-`) && !image.src.includes("private")));
      assert.ok(text(tree).includes(cartLabels[locale].unavailable));
      const search = nodes(tree).find(node => node.type === "input" && node.props.type === "search");
      search.props.onChange({ target: { value: "one" } }); tree = render(ShoppingCart, element.props, key); assert.equal(boxes(tree).length, 1);
      button(tree, cartLabels[locale].resetReview).props.onClick(); tree = render(ShoppingCart, element.props, key);
      const sort = nodes(tree).find(node => node.type === "select" && node.props.id.endsWith("-sort"));
      sort.props.onChange({ target: { value: "quantity" } }); tree = render(ShoppingCart, element.props, key);
      button(tree, cartLabels[locale].reviewUnpublished).props.onClick(); tree = render(ShoppingCart, element.props, key);
      assert.equal(boxes(tree).length, 1); assert.deepEqual(images(tree), []); assert.ok(!text(tree).includes(hidden));
    }
    assert.deepEqual(writes, []); assert.equal(values.get(CART_STORAGE_KEY), serializeCart([{ publicId: id.toUpperCase(), quantity: 2 }, { publicId: hidden, quantity: 3 }, { publicId: other, quantity: 4 }]));
  } finally { if (previous === undefined) delete globalThis[symbol]; else globalThis[symbol] = previous; }
}));

test("shared ProductImage failure/no-JS semantics stay intact and a new source resets its failed frame", () => {
  driver.instances.clear();
  const element = ProductImage({ src: "/synthetic/missing.webp", alt: "Editorial original meaning" });
  let tree = render(element.type, element.props, element.key);
  assert.ok(nodes(tree).some(node => node.type === "noscript"));
  const image = nodes(tree).find(node => node.type === "img" && node.props.onError); image.props.onError(); tree = render(element.type, element.props, element.key);
  assert.ok(nodes(tree).some(node => node.props?.role === "img" && node.props["aria-label"] === "Editorial original meaning"));
  assert.ok(!nodes(tree).some(node => node.type === "img" && node.props.onError));
  const next = ProductImage({ src: "/synthetic/replacement.webp", alt: "Editorial new meaning" });
  assert.notEqual(next.key, element.key); const fresh = render(next.type, next.props, next.key);
  const load = nodes(fresh).find(node => node.type === "img" && node.props.onLoad);
  load.props.onLoad({ currentTarget: { naturalWidth: 40 } });
  assert.ok(nodes(render(next.type, next.props, next.key)).some(node => node.type === "img" && node.props.alt === "Editorial new meaning" && !node.props["aria-hidden"]));
  driver.instances.clear();
});

test("new gallery labels are locale-complete, native modal contracts remain explicit and no stores/provider/SEO were added", () => {
  for (const locale of ["en", "hu", "ko"]) {
    assert.deepEqual(Object.keys(storefrontLabels[locale]), Object.keys(storefrontLabels.en));
    for (const key of ["gallery", "inspectImage", "closeImage", "previousImage", "nextImage"]) assert.ok(storefrontLabels[locale][key].trim());
  }
  const source = readFileSync(join(repo, "components/catalogue/ProductMediaGallery.tsx"), "utf8");
  assert.match(source, /\.showModal\(\)/); assert.match(source, /onCancel=/); assert.match(source, /onClose=/);
  assert.doesNotMatch(source, /window.addEventListener|document.addEventListener|localStorage|sessionStorage|fetch\(/);
  assert.match(source, /max-h-\[90dvh\]/); assert.match(source, /flex-wrap/);
  assert.equal(createLocalCatalogueReader([]).listPublished().length, 0);
});

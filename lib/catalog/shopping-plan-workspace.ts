import type { EditorialLocale } from "./editorial-catalogue";
import { type ShoppingPlan, type PlanChange, shoppingPlanHref } from "./catalogue-shopping-plan";
import { resolvePortableLines, portablePayload } from "../cart/cart-portable-handoff";
import { parseQuickAddQuantity } from "../cart/quick-add-quantity";
import { CART_STORAGE_KEY, inspectStoredCart, type CartLine } from "../cart/cart-state";
import { sameCartSelection } from "../cart/cart-undo";

type Product = Readonly<{ publicId: string; name: string | null; brand: string; slug: string }>;
export type PlanReviewView = Readonly<{ query: string; brand: string; sort: "order" | "name" | "brand" }>;
export const EMPTY_PLAN_VIEW: PlanReviewView = Object.freeze({ query: "", brand: "", sort: "order" });
export function plannedReview(plan: ShoppingPlan, products: readonly Product[], locale: EditorialLocale, view: PlanReviewView) {
  const resolved = plan.status === "ready" ? resolvePortableLines(plan.lines, products) : null;
  const all = resolved?.map((product, index) => ({ product, line: plan.lines[index], index })) ?? [];
  const normalize = (value: string) => value.normalize("NFKC").toLocaleLowerCase(locale);
  const terms = normalize(view.query.slice(0, 200).trim()).split(/\s+/).filter(Boolean);
  const rows = all.filter(({ product }) => (!view.brand || product.brand === view.brand) &&
    terms.every(term => [product.name ?? "", product.brand, product.slug].some(field => normalize(field).includes(term))));
  const collator = new Intl.Collator(locale, { sensitivity: "base" });
  if (view.sort !== "order") rows.sort((a, b) => collator.compare(view.sort === "brand" ? a.product.brand : a.product.name ?? "",
    view.sort === "brand" ? b.product.brand : b.product.name ?? "") || a.index - b.index);
  return { rows, total: all.length, brands: [...new Set(all.map(row => row.product.brand))].sort(collator.compare) };
}

export function changePlannedLines(plan: ShoppingPlan, selected: readonly string[], visible: readonly string[], products: readonly Readonly<{ publicId: string }>[],
  action: Readonly<{ kind: "remove" }> | Readonly<{ kind: "set"; raw: string }> | Readonly<{ kind: "move"; direction: -1 | 1 }>): PlanChange {
  if (plan.status !== "ready" || !resolvePortableLines(plan.lines, products) || !selected.length || new Set(selected).size !== selected.length ||
    selected.some(id => !visible.includes(id) || !plan.lines.some(line => line.publicId === id))) return { status: "invalid" };
  let next = [...plan.lines];
  if (action.kind === "remove") next = next.filter(line => !selected.includes(line.publicId));
  else if (action.kind === "set") {
    const quantity = parseQuickAddQuantity(action.raw);
    if (quantity === null) return { status: "invalid" };
    next = next.map(line => selected.includes(line.publicId) ? { ...line, quantity } : line);
  } else {
    if (selected.length !== 1 || visible.length !== plan.lines.length || !visible.every((id, index) => id === plan.lines[index].publicId)) return { status: "invalid" };
    const index = next.findIndex(line => line.publicId === selected[0]), target = index + action.direction;
    if (target < 0 || target >= next.length) return { status: "unchanged", lines: plan.lines };
    [next[index], next[target]] = [next[target], next[index]];
  }
  if (next.length && (!portablePayload(next) || !resolvePortableLines(next, products))) return { status: "invalid" };
  return { status: sameCartSelection(next, plan.lines) ? "unchanged" : "changed", lines: next };
}

type CartSnapshot = Readonly<{ lines: readonly CartLine[]; ready: boolean; persistent: boolean; invalid: boolean }>;
/** Read-only full persistence witness; no store/merge writer or new storage protocol. */
export function readFreshPlanCart(snapshot: CartSnapshot): readonly CartLine[] | null {
  if (typeof window === "undefined" || !snapshot.ready || !snapshot.persistent || snapshot.invalid) return null;
  try {
    const stored = inspectStoredCart(window.localStorage.getItem(CART_STORAGE_KEY));
    const expected = inspectStoredCart(JSON.stringify({ version: 1, lines: snapshot.lines }));
    return !stored.invalid && !expected.invalid && sameCartSelection(stored.lines, expected.lines) ? snapshot.lines : null;
  } catch { return null; }
}

export function currentCartPlanHref(path: string, lines: readonly CartLine[], products: readonly Readonly<{ publicId: string }>[]): string | null {
  if (!/^\/(?:(?:en|hu|ko)\/)?products$/.test(path) || !lines.length || inspectStoredCart(JSON.stringify({ version: 1, lines })).invalid) return null;
  // Canonical case-folding preserves complete order and quantities; no partial public filtering.
  const canonical = lines.map(line => ({ publicId: line.publicId.toLowerCase(), quantity: line.quantity }));
  return resolvePortableLines(canonical, products) ? shoppingPlanHref(path, "", canonical) : null;
}

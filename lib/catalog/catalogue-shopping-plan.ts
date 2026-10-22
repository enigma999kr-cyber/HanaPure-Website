import { portablePayload, readPortableLink, resolvePortableLines, MAX_PORTABLE_LINK } from "../cart/cart-portable-handoff";
import { validCartId, type CartLine } from "../cart/cart-state";
import { parseQuickAddQuantity } from "../cart/quick-add-quantity";

export const SHOPPING_PLAN_PARAM = "cartPlan";
type PublicIdentity = Readonly<{ publicId: string }>;
export type ShoppingPlan = Readonly<{ status: "empty" | "invalid"; lines: readonly CartLine[] }> |
  Readonly<{ status: "ready"; lines: readonly CartLine[] }>;

/** Adapter to the CLOSED Cart protocol, not another parser or merge engine.
 * Loopback base is used only for pure URL parsing, never navigation or networking. */
export function readShoppingPlan(raw: unknown, products: readonly PublicIdentity[]): ShoppingPlan {
  if (raw === undefined) return { status: "empty", lines: [] };
  if (typeof raw !== "string" || !raw || raw.length > MAX_PORTABLE_LINK) return { status: "invalid", lines: [] };
  const query = new URLSearchParams({ cartDraft: raw });
  const parsed = readPortableLink(`http://localhost/cart?${query}`);
  return parsed.status === "ready" && parsed.signature === raw && resolvePortableLines(parsed.lines, products) ?
    { status: "ready", lines: parsed.lines } : { status: "invalid", lines: [] };
}

export function shoppingPlanHref(path: string, query: string, lines: readonly CartLine[], fragment = ""): string | null {
  if (!/^\/(?:(?:en|hu|ko)\/)?products(?:\/[a-z0-9]+(?:-[a-z0-9]+)*)?$/.test(path) || query.length > MAX_PORTABLE_LINK ||
    (fragment && !/^#catalogue-result-[0-9a-f-]{36}$/.test(fragment))) return null;
  const params = new URLSearchParams(query);
  if ([...params.keys()].some(key => !["q", "brand", "sort", "withLocaleInfo", "withLocaleImage", "page", "pickFirst"].includes(key))) return null;
  if (lines.length) {
    const payload = portablePayload(lines);
    if (!payload) return null;
    params.set(SHOPPING_PLAN_PARAM, payload);
  }
  const href = path + (params.size ? `?${params}` : "") + fragment;
  return href.length <= MAX_PORTABLE_LINK ? href : null;
}

/** Preserve only known browse context; comparison and Cart contracts stay separate. */
export function carryShoppingPlan(href: string | null, plan: ShoppingPlan): string | null {
  if (href === null) return null;
  if (plan.status !== "ready") return href;
  const [base, fragment] = href.split("#");
  const index = base.indexOf("?");
  return shoppingPlanHref(index < 0 ? base : base.slice(0, index), index < 0 ? "" : base.slice(index), plan.lines, fragment ? `#${fragment}` : "");
}

export type PlanChange = Readonly<{ status: "changed" | "unchanged"; lines: readonly CartLine[] }> | Readonly<{ status: "invalid" | "limit" }>;
export function addPlanProducts(plan: ShoppingPlan, ids: readonly string[], visibleIds: readonly string[], products: readonly PublicIdentity[]): PlanChange {
  if (plan.status === "invalid" || !ids.length || ids.some(id => !validCartId(id) || !visibleIds.some(visible => visible.toLowerCase() === id.toLowerCase()))) return { status: "invalid" };
  const next = [...plan.lines], seen = new Set(next.map(line => line.publicId));
  const selected = new Set(ids.map(id => id.toLowerCase()));
  for (const id of visibleIds.filter(id => selected.has(id.toLowerCase()))) {
    const canonical = id.toLowerCase();
    if (!seen.has(canonical)) { seen.add(canonical); next.push({ publicId: canonical, quantity: 1 }); }
  }
  if (!portablePayload(next)) return { status: "limit" };
  if (!resolvePortableLines(next, products)) return { status: "invalid" };
  return { status: next.length === plan.lines.length ? "unchanged" : "changed", lines: next };
}

export function setPlanQuantity(plan: ShoppingPlan, id: string, raw: string, products: readonly PublicIdentity[]): PlanChange {
  const quantity = parseQuickAddQuantity(raw);
  if (plan.status !== "ready" || quantity === null || !resolvePortableLines(plan.lines, products)) return { status: "invalid" };
  const existing = plan.lines.find(line => line.publicId === id);
  if (!existing) return { status: "invalid" };
  return { status: existing.quantity === quantity ? "unchanged" : "changed",
    lines: plan.lines.map(line => line.publicId === id ? { ...line, quantity } : line) };
}

export function shoppingPlanCartHref(path: string, plan: ShoppingPlan, products: readonly PublicIdentity[]): string | null {
  if (!/^\/(?:(?:en|hu|ko)\/)?cart$/.test(path) || plan.status !== "ready" || !resolvePortableLines(plan.lines, products)) return null;
  const payload = portablePayload(plan.lines);
  if (!payload) return null;
  const href = `${path}?${new URLSearchParams({ cartDraft: payload })}`;
  return readPortableLink(`http://localhost${href}`).status === "ready" && href.length <= MAX_PORTABLE_LINK ? href : null;
}

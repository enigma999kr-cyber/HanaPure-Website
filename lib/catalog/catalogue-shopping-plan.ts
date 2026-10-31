import { portablePayload, readPortableLink, resolvePortableLines, MAX_PORTABLE_LINK } from "../cart/cart-portable-handoff";
import { validCartId, type CartLine } from "../cart/cart-state";
import { parseQuickAddQuantity } from "../cart/quick-add-quantity";


/** Explicit last-saved recovery copy; never a Cart, autosave or source of authority. */
export const PLAN_RECOVERY_KEY = "hanapure.shopping-plan-recovery.v1";
type Store = Pick<Storage, "getItem" | "setItem" | "removeItem">;
export type Recovery = Readonly<{ status: "absent" | "invalid" | "stale" | "unavailable"; raw: string | null }> |
  Readonly<{ status: "ready"; raw: string; href: string; lines: readonly CartLine[] }>;

export function inspectPlanRecovery(raw: string | null, products: readonly PublicIdentity[]): Recovery {
  if (raw === null) return { status: "absent", raw };
  const invalid = { status: "invalid", raw } as const;
  if (!raw || raw.length > 16_384) return invalid;
  try {
    const value = JSON.parse(raw);
    if (!value || Object.keys(value).sort().join(",") !== "href,version" || value.version !== 1 ||
      typeof value.href !== "string" || value.href.length > 8192 || !value.href.startsWith("/") || value.href.startsWith("//")) return invalid;
    const url = new URL(value.href, "http://localhost");
    if (url.origin !== "http://localhost" || url.hash || url.searchParams.getAll("cartPlan").length !== 1) return invalid;
    const payload = url.searchParams.get("cartPlan")!;
    const portable = readPortableLink(`http://localhost/cart?${new URLSearchParams({ cartDraft: payload })}`);
    if (portable.status !== "ready") return invalid;
    const query = new URLSearchParams(url.search); query.delete("cartPlan");
    // Canonical recomputation also rejects foreign routes/keys and malformed view.
    if (shoppingPlanHref(url.pathname, `?${query}`, portable.lines) !== value.href) return invalid;
    if (!resolvePortableLines(portable.lines, products)) return { status: "stale", raw };
    const plan = readShoppingPlan(payload, products);
    return plan.status === "ready" ? { status: "ready", raw, href: value.href, lines: plan.lines } : invalid;
  } catch { return invalid; }
}

export function readPlanRecovery(store: Store, products: readonly PublicIdentity[]): Recovery {
  try { return inspectPlanRecovery(store.getItem(PLAN_RECOVERY_KEY), products); }
  catch { return { status: "unavailable", raw: null }; }
}

export function savePlanRecovery(store: Store, expected: string | null, href: string, products: readonly PublicIdentity[]): "saved" | "invalid" | "conflict" | "unavailable" {
  const raw = JSON.stringify({ version: 1, href });
  if (inspectPlanRecovery(raw, products).status !== "ready") return "invalid";
  try {
    const before = store.getItem(PLAN_RECOVERY_KEY);
    if (before !== expected) return "conflict";
    const old = inspectPlanRecovery(before, products);
    if (!["ready", "absent"].includes(old.status)) return "invalid"; // damaged copies require explicit Forget first
    if (store.getItem(PLAN_RECOVERY_KEY) !== before) return "conflict";
    store.setItem(PLAN_RECOVERY_KEY, raw);
    return store.getItem(PLAN_RECOVERY_KEY) === raw ? "saved" : "conflict";
  } catch { return "unavailable"; }
}

export function forgetPlanRecovery(store: Store, expected: string | null): "forgotten" | "conflict" | "unavailable" {
  try {
    if (store.getItem(PLAN_RECOVERY_KEY) !== expected) return "conflict";
    store.removeItem(PLAN_RECOVERY_KEY);
    return store.getItem(PLAN_RECOVERY_KEY) === null ? "forgotten" : "conflict";
  } catch { return "unavailable"; }
}


export const SHOPPING_PLAN_PARAM = "cartPlan";
type PublicIdentity = Readonly<{ publicId: string }>;
export type ShoppingPlan = Readonly<{ status: "empty" | "invalid"; lines: readonly CartLine[] }> |
  Readonly<{ status: "ready"; lines: readonly CartLine[] }>;
export type PlanIntakeContext = Readonly<{ plan: ShoppingPlan; path: string; query: string; publishedIds: readonly string[] }>;

/** Cross-collection intake composes the existing plan validator and URL boundary. */
export function planIntakeHref(context: PlanIntakeContext, ids: readonly string[]) {
  const products = context.publishedIds.map(publicId => ({ publicId }));
  if (new Set(context.publishedIds.map(id => id.toLowerCase())).size !== products.length ||
    context.publishedIds.some(id => !validCartId(id))) return { status: "invalid" } as const;
  const changed = addPlanProducts(context.plan, ids, ids, products);
  if (changed.status !== "changed") return { status: changed.status } as const;
  const href = shoppingPlanHref(context.path, context.query, changed.lines);
  return href ? { status: "changed", href } as const : { status: "limit" } as const;
}

export function shoppingPlanShareLink(origin: string, context: PlanIntakeContext): string | null {
  try {
    const base = new URL(origin);
    if (base.origin !== origin || !/^https?:$/.test(base.protocol) || context.plan.status !== "ready" ||
      !resolvePortableLines(context.plan.lines, context.publishedIds.map(publicId => ({ publicId })))) return null;
    const relative = shoppingPlanHref(context.path, context.query, context.plan.lines);
    const href = relative && new URL(relative, origin).href;
    return href && href.length <= MAX_PORTABLE_LINK ? href : null;
  } catch { return null; }
}

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
  if ([...params.keys()].some(key => !["q", "brand", "sort", "withLocaleInfo", "withLocaleImage", "page", "pickFirst", "view"].includes(key))) return null;
  if (params.has("view") && (params.getAll("view").length !== 1 || params.get("view") !== "list")) return null;
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

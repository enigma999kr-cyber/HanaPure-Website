import type { EditorialLocale } from "../catalog/editorial-catalogue";
import { storefrontLabels } from "../storefront/localization";
import { cartLabels } from "./labels";
import { inspectStoredCart, reconcileCart, serializeCart, type CartLine } from "./cart-state";

export const MAX_SHOPPING_LIST_LENGTH = 16_000;
type Product = Readonly<{ publicId: string; slug: string; brand: string;
  names: Readonly<Record<EditorialLocale, string | null>> }>;
export type ShoppingListResult = Readonly<{ status: "ready"; text: string; omitted: number }>
  | Readonly<{ status: "empty" | "invalid" | "too-large" }>;

/** Plain text only: flatten markup, line breaks, controls and invisible direction overrides. */
function plainName(value: string): string {
  return value.replace(/<[^>]*>/g, " ")
    .replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2066-\u2069\ufeff]/g, " ")
    .replace(/\s+/g, " ").trim();
}

/** Caller supplies the existing public projection; never resolves private catalogue data. */
export function formatCartShoppingList(lines: readonly CartLine[], products: readonly Product[], locale: EditorialLocale): ShoppingListResult {
  const checked = inspectStoredCart(serializeCart(lines));
  if (checked.invalid) return { status: "invalid" };
  const rows: string[] = [];
  let omitted = 0;
  let length = 0;
  for (const { line, product } of reconcileCart(checked.lines, products)) {
    if (!product) { omitted++; continue; }
    const localized = product.names[locale];
    const raw = localized ?? `${storefrontLabels[locale].details}: ${product.brand} (${product.slug})`;
    if (raw.length > MAX_SHOPPING_LIST_LENGTH) return { status: "too-large" };
    const name = plainName(raw);
    if (!name) return { status: "invalid" };
    const row = `- ${name} — ${cartLabels[locale].quantity}: ${line.quantity}`;
    length += row.length + 1;
    if (length > MAX_SHOPPING_LIST_LENGTH) return { status: "too-large" };
    rows.push(row);
  }
  if (!rows.length) return { status: "empty" };
  const text = `HanaPure\n\n${rows.join("\n")}\n\n${cartLabels[locale].shoppingListNotice}`;
  return text.length <= MAX_SHOPPING_LIST_LENGTH ? { status: "ready", text, omitted } : { status: "too-large" };
}

import { cartQuantity, inspectStoredCart, serializeCart, validCartId, type CartLine } from "./cart-state";
import { serializeFavorites, type FavoriteIds } from "../favorites/favorite-state";

type Ready = Readonly<{ ready: boolean; persistent: boolean; invalid: boolean }>;
type Cart = Ready & Readonly<{ lines: readonly CartLine[] }>;
type Saved = Ready & Readonly<{ ids: FavoriteIds }>;
const trusted = (state: Ready) => state.ready && state.persistent && !state.invalid;
/** Read-only, exact units; an incoherent/unconfirmed snapshot has no confirmed summary. */
export function cartSelectionSummary(cart: Cart, expected: readonly CartLine[], ids: readonly string[], products: readonly Readonly<{ publicId: string }>[]) {
  if (!trusted(cart) || cart.lines !== expected) return null;
  try {
    if (inspectStoredCart(serializeCart(cart.lines)).invalid || !Array.isArray(ids) || ids.some(id => !validCartId(id))) return null;
    const identities = new Set(ids.map(id => id.toLowerCase()));
    const selected = cart.lines.filter(line => identities.has(line.publicId.toLowerCase()));
    if (selected.length !== identities.size) return null;
    return { lines: selected.length, units: cartQuantity(selected), unavailable: selected.filter(line =>
      !products.some(product => product.publicId.toLowerCase() === line.publicId.toLowerCase())).length };
  } catch { return null; }
}
/** null means unknown or no positive overlap, never an assertion of absence. */
export function browserCartOverlap(cart: Cart, publicId: string): number | null {
  if (!trusted(cart) || !validCartId(publicId)) return null;
  try {
    if (inspectStoredCart(serializeCart(cart.lines)).invalid) return null;
    return cart.lines.find(line => line.publicId.toLowerCase() === publicId.toLowerCase())?.quantity ?? null;
  } catch { return null; }
}
export function savedProductOverlap(saved: Saved, publicId: string): boolean {
  if (!trusted(saved) || !validCartId(publicId)) return false;
  try { serializeFavorites(saved.ids); return saved.ids.some(id => id.toLowerCase() === publicId.toLowerCase()); }
  catch { return false; }
}

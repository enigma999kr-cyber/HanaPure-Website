import { validCartId } from "./cart-state";

/** Public cart-row navigation hint only; never membership or publication proof. */
export function cartRowId(publicId: string): string | null {
  return validCartId(publicId) ? `cart-item-${publicId.toLowerCase()}` : null;
}

export function cartRowFromHash(hash: string): string | null {
  if (!hash.startsWith("#cart-item-")) return null;
  return cartRowId(hash.slice("#cart-item-".length));
}

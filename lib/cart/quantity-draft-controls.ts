import { parseQuickAddQuantity } from "./quick-add-quantity";

/** Draft only. null disables invalid input, underflow and safe-integer overflow. */
export function stepQuantityDraft(raw: string, direction: -1 | 1): string | null {
  const quantity = parseQuickAddQuantity(raw);
  if (quantity === null || (direction !== -1 && direction !== 1)) return null;
  const next = quantity + direction;
  return Number.isSafeInteger(next) && next > 0 ? String(next) : null;
}

import { validQuantity } from "./cart-state";

/** Parse bounded plain decimal input without rounding or inventing a stock limit. */
export function parseQuickAddQuantity(raw: string): number | null {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > 32 || !/^[0-9]+$/.test(raw)) return null;
  const digits = raw.replace(/^0+/, "");
  const maximum = "9007199254740991";
  if (!digits || digits.length > maximum.length || (digits.length === maximum.length && digits > maximum)) return null;
  const quantity = Number(digits);
  return validQuantity(quantity) ? quantity : null;
}

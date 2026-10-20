import { inspectStoredCart, serializeCart, type CartLine } from "./cart-state";

export type CartUndoPlan = Readonly<{ before: readonly CartLine[]; after: readonly CartLine[] }>;

/** Exact retained IDs, order and safe quantities matter, not just identity or totals. */
export function sameCartSelection(left: readonly CartLine[], right: readonly CartLine[]): boolean {
  return left.length === right.length && left.every((line, index) =>
    line.publicId === right[index].publicId && line.quantity === right[index].quantity);
}

function copySelection(lines: readonly CartLine[]): readonly CartLine[] | null {
  try {
    if (!Array.isArray(lines) || lines.some(line => !line ||
      Reflect.ownKeys(line).sort().join(",") !== "publicId,quantity")) return null;
    const parsed = inspectStoredCart(serializeCart(lines));
    return parsed.invalid ? null : parsed.lines;
  } catch { return null; }
}

/** Only deletion of unchanged ordered lines (including clear), never quantity edits or no-ops. */
export function createCartUndoPlan(before: readonly CartLine[], after: readonly CartLine[]): CartUndoPlan | null {
  const original = copySelection(before);
  const remaining = copySelection(after);
  if (!original || !remaining || remaining.length >= original.length) return null;
  let index = 0;
  for (const line of original) {
    const candidate = remaining[index];
    if (candidate && candidate.publicId === line.publicId && candidate.quantity === line.quantity) index++;
  }
  return index === remaining.length ? Object.freeze({ before: original, after: remaining }) : null;
}

/** The array reference is a transient witness: normal mutations/storage reads replace it. */
export function canUndoCart(plan: CartUndoPlan, current: readonly CartLine[]): boolean {
  return current === plan.after && sameCartSelection(current, plan.after);
}

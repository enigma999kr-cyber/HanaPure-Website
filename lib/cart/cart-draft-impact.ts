import { planPortableMerge } from "./cart-portable-handoff";
import type { CartLine } from "./cart-state";

/** Hypothetical quantities only. The CLOSED merger remains the sole calculation authority. */
export function cartDraftImpact(current: readonly CartLine[], incoming: readonly CartLine[], products: readonly Readonly<{ publicId: string }>[]) {
  const merged = planPortableMerge(current, incoming, products);
  if (merged.status !== "ready") return merged;
  const rows = incoming.map(line => {
    const before = current.find(item => item.publicId.toLowerCase() === line.publicId);
    const after = merged.after.find(item => item.publicId.toLowerCase() === line.publicId)!;
    return { publicId: line.publicId, current: before?.quantity ?? null, added: line.quantity, expected: after.quantity };
  });
  return { status: "ready", rows, newLines: rows.filter(row => row.current === null).length,
    existingLines: rows.filter(row => row.current !== null).length,
    units: rows.reduce((sum, row) => sum + BigInt(row.expected), BigInt(0)).toString() } as const;
}

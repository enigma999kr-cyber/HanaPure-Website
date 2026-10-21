import { serializeRecent, validRecentId, type RecentIds } from "./recent-state";
import { resolveComparison, type ComparisonProduct } from "../comparison/compare-selection";

/** Narrow the CLOSED comparison UI to exactly two visible identities in this valid history. */
export function recentComparisonPair(ids: RecentIds, history: RecentIds, visible: readonly Readonly<{ publicId: string }>[], products: readonly ComparisonProduct[]) {
  try {
    serializeRecent(history);
    if (!Array.isArray(ids) || ids.some(id => !validRecentId(id))) return null;
    const selected = [...new Set(ids.map(id => id.toLowerCase()))];
    if (selected.length !== 2 || selected.some(id => !history.some(value => value.toLowerCase() === id) ||
      !visible.some(product => product.publicId.toLowerCase() === id))) return null;
    const pair = selected.map(id => products.find(product => product.publicId.toLowerCase() === id));
    return pair[0] && pair[1] ? resolveComparison([pair[0], pair[1]], selected[0], selected[1]) : null;
  } catch { return null; }
}

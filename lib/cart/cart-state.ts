/** Browser selection only: no prices, inventory, readiness or order facts. */
export type CartLine = Readonly<{ publicId: string; quantity: number }>;
export const CART_STORAGE_KEY = "hanapure.cart.v1";
/** Exact display sum even when multiple individually safe quantities exceed MAX_SAFE_INTEGER. */
export function cartQuantity(lines: readonly CartLine[]): string {
  return lines.reduce((total, line) => total + BigInt(line.quantity), BigInt(0)).toString();
}
export function validQuantity(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}
export function validCartId(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}
/** Reject the whole untrusted payload, including extra operational fields. */
export function inspectStoredCart(raw: string | null): Readonly<{ lines: readonly CartLine[]; invalid: boolean }> {
  const rejected = { lines: [], invalid: true } as const;
  if (raw === null) return { lines: [], invalid: false };
  if (!raw || raw.length > 100_000) return rejected;
  try {
    const value = JSON.parse(raw);
    if (!value || Object.keys(value).sort().join(",") !== "lines,version" || value.version !== 1 || !Array.isArray(value.lines)) return rejected;
    const seen = new Set<string>();
    const lines: CartLine[] = [];
    for (const line of value.lines) {
      if (!line || Object.keys(line).sort().join(",") !== "publicId,quantity" ||
        !validCartId(line.publicId) || !validQuantity(line.quantity) || seen.has(line.publicId.toLowerCase())) return rejected;
      seen.add(line.publicId.toLowerCase());
      lines.push(Object.freeze({ publicId: line.publicId, quantity: line.quantity }));
    }
    return { lines: Object.freeze(lines), invalid: false };
  } catch { return rejected; }
}
export function parseCart(raw: string | null): readonly CartLine[] {
  return inspectStoredCart(raw).lines;
}
/** Compare identities only. Never delete selections or infer commercial availability. */
export function reconcileCart<T extends Readonly<{ publicId: string }>>(lines: readonly CartLine[], products: readonly T[]) {
  return lines.map(line => ({ line, product: products.find(product =>
    product.publicId.toLowerCase() === line.publicId.toLowerCase()) ?? null }));
}
export function serializeCart(lines: readonly CartLine[]): string {
  return JSON.stringify({ version: 1, lines: lines.map(({ publicId, quantity }) => ({ publicId, quantity })) });
}
export function addCartLine(lines: readonly CartLine[], publicId: string, quantity: number): readonly CartLine[] {
  if (!validCartId(publicId) || !validQuantity(quantity)) return lines;
  const sameIdentity = (line: CartLine) => line.publicId.toLowerCase() === publicId.toLowerCase();
  const existing = lines.find(sameIdentity);
  if (existing && !validQuantity(existing.quantity + quantity)) return lines;
  // The detail's server-supplied identity replaces an untrusted casing alias.
  return existing ? lines.map(line => sameIdentity(line) ? { publicId, quantity: line.quantity + quantity } : line)
    : [...lines, { publicId, quantity }];
}
export function updateCartLine(lines: readonly CartLine[], publicId: string, quantity: number): readonly CartLine[] {
  if (!validCartId(publicId) || !validQuantity(quantity)) return lines;
  return lines.map(line => line.publicId.toLowerCase() === publicId.toLowerCase()
    ? { publicId: line.publicId, quantity } : line);
}

import { inspectStoredCart, validCartId, validQuantity, type CartLine } from "./cart-state";

export const PORTABLE_CART_PARAM = "cartDraft";
export const MAX_PORTABLE_LINK = 8192;
export const MAX_PORTABLE_LINES = 40;
type PublicIdentity = Readonly<{ publicId: string }>;
export type PortableDraft = Readonly<{ status: "ready"; lines: readonly CartLine[]; signature: string; units: string }>;
export type PortableInput = PortableDraft | Readonly<{ status: "none" | "invalid" }>;

function validSelection(lines: readonly CartLine[]): boolean {
  try { return !inspectStoredCart(JSON.stringify({ version: 1, lines })).invalid; } catch { return false; }
}

/** A deliberately small, canonical ASCII protocol: v1.UUID:quantity,UUID:quantity. */
export function portablePayload(lines: readonly CartLine[]): string | null {
  if (!Array.isArray(lines) || !lines.length || lines.length > MAX_PORTABLE_LINES || !validSelection(lines) ||
    lines.some(line => line.publicId !== line.publicId.toLowerCase())) return null;
  return `v1.${lines.map(line => `${line.publicId}:${line.quantity}`).join(",")}`;
}

/** Parse only the current Cart URL in the client; no route/SEO/publication authority. */
export function readPortableLink(href: string): PortableInput {
  if (!href) return { status: "none" };
  if (href.length > MAX_PORTABLE_LINK || /[\u0000-\u0020\u007f-\u009f]/.test(href)) return { status: "invalid" };
  try {
    const url = new URL(href);
    const values = url.searchParams.getAll(PORTABLE_CART_PARAM);
    if (!values.length) return { status: "none" };
    if (!/^https?:$/.test(url.protocol) || url.username || url.password ||
      !/^\/(?:en\/|hu\/|ko\/)?cart$/.test(url.pathname) || values.length !== 1 || [...url.searchParams].length !== 1) return { status: "invalid" };
    const payload = values[0];
    if (!payload.startsWith("v1.") || payload.length > MAX_PORTABLE_LINK) return { status: "invalid" };
    const parts = payload.slice(3).split(",");
    if (!parts.length || parts.length > MAX_PORTABLE_LINES) return { status: "invalid" };
    const lines: CartLine[] = [];
    for (const part of parts) {
      const fields = part.split(":");
      if (fields.length !== 2 || !validCartId(fields[0]) || fields[0] !== fields[0].toLowerCase() ||
        !/^[1-9][0-9]*$/.test(fields[1]) || !validQuantity(Number(fields[1]))) return { status: "invalid" };
      lines.push({ publicId: fields[0], quantity: Number(fields[1]) });
    }
    if (portablePayload(lines) !== payload) return { status: "invalid" };
    return { status: "ready", lines, signature: payload,
      units: lines.reduce((sum, line) => sum + BigInt(line.quantity), BigInt(0)).toString() };
  } catch { return { status: "invalid" }; }
}

/** All-or-nothing resolution against the server's current public projection. */
export function resolvePortableLines<T extends PublicIdentity>(lines: readonly CartLine[], products: readonly T[]): readonly T[] | null {
  if (!portablePayload(lines)) return null;
  const resolved: T[] = [];
  for (const line of lines) {
    const matches = products.filter(product => validCartId(product.publicId) && product.publicId.toLowerCase() === line.publicId);
    if (matches.length !== 1) return null;
    resolved.push(matches[0]);
  }
  return resolved;
}

export function portableCartLink(origin: string, path: string, lines: readonly CartLine[], products: readonly PublicIdentity[]):
  Readonly<{ status: "ready"; url: string; omitted: number }> | Readonly<{ status: "invalid" | "empty" | "too-large" }> {
  if (origin.length > MAX_PORTABLE_LINK) return { status: "too-large" };
  try {
    const base = new URL(origin);
    if (base.origin !== origin || !/^https?:$/.test(base.protocol) || !/^\/(?:en\/|hu\/|ko\/)?cart$/.test(path) || !validSelection(lines)) return { status: "invalid" };
    const included = lines.filter(line => products.some(product => product.publicId.toLowerCase() === line.publicId.toLowerCase()))
      .map(line => ({ publicId: line.publicId.toLowerCase(), quantity: line.quantity }));
    if (!included.length) return { status: "empty" };
    if (included.length > MAX_PORTABLE_LINES) return { status: "too-large" };
    const payload = portablePayload(included);
    if (!payload || !resolvePortableLines(included, products)) return { status: "invalid" };
    const url = new URL(path, origin);
    url.searchParams.set(PORTABLE_CART_PARAM, payload);
    if (url.href.length > MAX_PORTABLE_LINK) return { status: "too-large" };
    return { status: "ready", url: url.href, omitted: lines.length - included.length };
  } catch { return { status: "invalid" }; }
}

/** Pure full-selection planning: never a store write, overwrite or deletion. */
export function planPortableMerge(current: readonly CartLine[], incoming: readonly CartLine[], products: readonly PublicIdentity[]):
  Readonly<{ status: "ready"; after: readonly CartLine[] }> | Readonly<{ status: "invalid" | "overflow" }> {
  if (!validSelection(current) || !resolvePortableLines(incoming, products)) return { status: "invalid" };
  const amounts = new Map(incoming.map(line => [line.publicId, line.quantity]));
  const present = new Set(current.map(line => line.publicId.toLowerCase()));
  const after: CartLine[] = [];
  for (const line of current) {
    const amount = amounts.get(line.publicId.toLowerCase());
    if (amount === undefined) after.push(line);
    else {
      const quantity = line.quantity + amount;
      if (!validQuantity(quantity)) return { status: "overflow" };
      after.push({ publicId: line.publicId, quantity });
    }
  }
  for (const line of incoming) if (!present.has(line.publicId)) after.push({ ...line });
  return validSelection(after) ? { status: "ready", after } : { status: "invalid" };
}

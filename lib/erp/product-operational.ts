import "server-only";

/** ERP-owned facts only. Website editorial content belongs in a separate layer. */
export type OperationalProduct = Readonly<{
  publicId: string;
  /** Canonical base/current HUF value, NOT a customer-facing VAT/checkout price. */
  basePriceHuf: number;
  /** ERP-derived display signal, NOT a reservation guarantee. */
  sellableStock: number;
  operationalReady: boolean;
}>;

type OperationalField =
  | "public_id"
  | "retail_price_huf"
  | "sellable_stock"
  | "operational_ready";

export type OperationalProductError =
  | Readonly<{ code: "invalid_payload" }>
  | Readonly<{ code: "invalid_fields"; fields: readonly OperationalField[] }>
  | Readonly<{
      code:
        | "invalid_public_id"
        | "identity_mismatch"
        | "source_not_configured"
        | "source_unavailable";
    }>;

export type OperationalProductResult =
  | Readonly<{ ok: true; product: OperationalProduct }>
  | Readonly<{ ok: false; error: OperationalProductError }>;

/**
 * Logical provider boundary, not an HTTP endpoint or wire-format specification.
 * A future transport must map its confirmed contract into the four ERP fields
 * accepted below. No production source or fabricated fallback is provided.
 */
export interface ErpOperationalSource {
  readProduct(publicId: string): Promise<unknown>;
}

function isPublicId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
  );
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/** Structural validation only; never reconstruct ERP readiness or inventory rules. */
export function normalizeOperationalProduct(payload: unknown): OperationalProductResult {
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
    return { ok: false, error: { code: "invalid_payload" } };
  }

  const data = payload as Record<string, unknown>;
  const publicId = data.public_id;
  const basePriceHuf = data.retail_price_huf;
  const sellableStock = data.sellable_stock;
  const operationalReady = data.operational_ready;
  const fields: OperationalField[] = [];

  if (!isPublicId(publicId)) fields.push("public_id");
  // Zero is structurally valid. Positive-price readiness is exclusively ERP-owned.
  if (!isFiniteNumber(basePriceHuf)) fields.push("retail_price_huf");
  if (!isFiniteNumber(sellableStock) || sellableStock < 0) fields.push("sellable_stock");
  if (typeof operationalReady !== "boolean") fields.push("operational_ready");

  if (
    !isPublicId(publicId) ||
    !isFiniteNumber(basePriceHuf) ||
    !isFiniteNumber(sellableStock) ||
    sellableStock < 0 ||
    typeof operationalReady !== "boolean"
  ) {
    return { ok: false, error: { code: "invalid_fields", fields } };
  }

  return {
    ok: true,
    product: { publicId, basePriceHuf, sellableStock, operationalReady },
  };
}

export async function readOperationalProduct(
  publicId: string,
  source?: ErpOperationalSource,
): Promise<OperationalProductResult> {
  if (!isPublicId(publicId)) {
    return { ok: false, error: { code: "invalid_public_id" } };
  }
  if (!source) {
    return { ok: false, error: { code: "source_not_configured" } };
  }

  let payload: unknown;
  try {
    payload = await source.readProduct(publicId);
  } catch {
    // Never expose credentials, endpoint details, raw exceptions, or fake business values.
    return { ok: false, error: { code: "source_unavailable" } };
  }

  const result = normalizeOperationalProduct(payload);
  if (result.ok && result.product.publicId.toLowerCase() !== publicId.toLowerCase()) {
    return { ok: false, error: { code: "identity_mismatch" } };
  }
  return result;
}

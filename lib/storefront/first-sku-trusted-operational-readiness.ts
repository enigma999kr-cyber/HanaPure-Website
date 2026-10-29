import "server-only";

import { isPublicId, normalizeOperationalProduct } from "../erp/product-operational";
import { OPERATIONAL_CONTRACT_VERSION } from "../erp/https-operational-source";

type WireEvidence = "VALID_PRODUCT" | "CONTRACT_ABSENCE_ONLY" | "SOURCE_UNAVAILABLE" |
  "INVALID_SELECTION" | "INVALID_ENVELOPE" | "UNSUPPORTED_VERSION" | "INVALID_PRODUCT" | "IDENTITY_MISMATCH";

export type FirstSkuTrustedOperationalReadiness = Readonly<{
  shape: "SHAPE_COMPATIBLE" | "STRUCTURAL_FAILURE";
  evidence: WireEvidence;
  erpFacts: Readonly<{ operationalReady: boolean; sellableStock: number }> | null;
  authenticity: "NOT_VERIFIED";
  attestation: "NOT_VERIFIED";
  freshness: "NOT_VERIFIED";
  expiry: "NOT_EVALUABLE";
  effectiveAvailability: "NOT_EVALUATED";
  manualIntent: "NOT_VERIFIED";
  trustedForLiveUse: false;
  publicationAuthorized: false;
  checkoutAuthorized: false;
  blockers: readonly string[];
}>;

// Data descriptors only: do not invoke getters or propagate private extra fields.
function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) &&
    [Object.prototype, null].includes(Object.getPrototypeOf(value));
}
function own(value: Record<string, unknown>, key: string): unknown {
  return Object.getOwnPropertyDescriptor(value, key)?.value;
}

/**
 * Offline JSON-shaped observation only. HTTP status is supplied data, not a
 * trusted transport observation. Even a matching 404 proves no real absence.
 * No availability policy: #32/#34 retain ownership of effective projection.
 * Caller provenance, overrides, issuer/signature/time claims cannot grant trust.
 */
export function inspectFirstSkuTrustedOperationalReadiness(
  selectedPublicId: string, status: number, body: unknown,
): FirstSkuTrustedOperationalReadiness {
  const finish = (evidence: WireEvidence, erpFacts: FirstSkuTrustedOperationalReadiness["erpFacts"] = null): FirstSkuTrustedOperationalReadiness => ({
    shape: evidence === "VALID_PRODUCT" || evidence === "CONTRACT_ABSENCE_ONLY" ? "SHAPE_COMPATIBLE" : "STRUCTURAL_FAILURE",
    evidence, erpFacts, authenticity: "NOT_VERIFIED", attestation: "NOT_VERIFIED",
    freshness: "NOT_VERIFIED", expiry: "NOT_EVALUABLE", effectiveAvailability: "NOT_EVALUATED",
    manualIntent: "NOT_VERIFIED", trustedForLiveUse: false, publicationAuthorized: false, checkoutAuthorized: false,
    blockers: ["AUTHENTICITY_NOT_VERIFIED", "ATTESTATION_NOT_VERIFIED", "FRESHNESS_NOT_VERIFIED",
      "COMMERCE_AUTHORITY_ABSENT", ...(evidence === "VALID_PRODUCT" ? [] : [evidence])],
  });
  try {
    if (!isPublicId(selectedPublicId)) return finish("INVALID_SELECTION");
    if (!record(body)) return finish("INVALID_ENVELOPE");
    if (own(body, "version") !== OPERATIONAL_CONTRACT_VERSION) return finish("UNSUPPORTED_VERSION");
    const envelopeId = own(body, "public_id");
    if (envelopeId !== undefined && envelopeId !== selectedPublicId) return finish("IDENTITY_MISMATCH");
    if (status !== 200) {
      const error = own(body, "error");
      if (status === 404 && envelopeId === selectedPublicId && !Object.hasOwn(body, "product") &&
        record(error) && own(error, "code") === "product_not_found") return finish("CONTRACT_ABSENCE_ONLY");
      return finish("SOURCE_UNAVAILABLE");
    }
    if (Object.hasOwn(body, "error")) return finish("INVALID_ENVELOPE");
    const product = own(body, "product");
    if (!record(product)) return finish("INVALID_PRODUCT");
    const result = normalizeOperationalProduct({
      public_id: own(product, "public_id"), retail_price_huf: own(product, "retail_price_huf"),
      sellable_stock: own(product, "sellable_stock"), operational_ready: own(product, "operational_ready"),
    });
    if (!result.ok) return finish("INVALID_PRODUCT");
    if (result.product.publicId !== selectedPublicId) return finish("IDENTITY_MISMATCH");
    return finish("VALID_PRODUCT", { operationalReady: result.product.operationalReady, sellableStock: result.product.sellableStock });
  } catch {
    return finish("INVALID_ENVELOPE");
  }
}

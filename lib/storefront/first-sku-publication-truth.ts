import "server-only";

import { validateEditorialCatalogue, type EditorialLocale, type EditorialProduct } from "../catalog/editorial-catalogue";
import { isPublicId, normalizeOperationalProduct, type OperationalProductError } from "../erp/product-operational";
import { validateOverride } from "../erp/emergency-override";
import type { EffectiveOperationalState } from "../erp/effective-operational-state";

type PublishedState = "PUBLISHED_OPERATIONAL_UNAVAILABLE" | "PUBLISHED_NOT_READY" |
  "PUBLISHED_OUT_OF_STOCK" | "PUBLISHED_SALES_PAUSED" | "PUBLISHED_OPERATIONAL_SIGNAL_ONLY";
type Blocker = "PUBLICATION_NOT_CONFIRMED" | "SELECTED_LOCALE_MISSING" |
  "OPERATIONAL_EVIDENCE_UNAVAILABLE" | "OPERATIONAL_NOT_READY" | "OPERATIONAL_OUT_OF_STOCK" |
  "SALES_PAUSED" | "MANUAL_INTENT_ONLY" | "CHECKOUT_NOT_EVALUATED" | "FRESHNESS_NOT_EVALUATED";
type Limits = Readonly<{
  checkoutAuthorization: "NOT_EVALUATED";
  freshness: "NOT_EVALUATED";
  blockers: readonly Blocker[];
}>;
export type FirstSkuPublicationTruth = Limits & (
  | Readonly<{ state: "UNPUBLISHED_OR_ABSENT" }>
  | Readonly<{
    state: PublishedState;
    publicId: string;
    locale: EditorialLocale;
    selectedLocaleContent: "PRESENT" | "MISSING";
    effectiveAvailability: EffectiveOperationalState["availability"] | null;
    provenance: EffectiveOperationalState["provenance"] | null;
    overrideDisposition: EffectiveOperationalState["overrideDisposition"] | null;
    evidence: "KNOWN" | "NO_SOURCE" | "UNAVAILABLE" | "INVALID" | "PRODUCT_NOT_FOUND";
    /** Copied canonical facts only; no quantity/eligibility math or reservation. */
    erpFacts: Readonly<{ operationalReady: boolean; sellableStock: number }> | null;
  }>
);

const failures: readonly OperationalProductError["code"][] = [
  "configuration_error", "authentication_error", "rate_limited", "timeout", "cancelled",
  "network_error", "upstream_unavailable", "temporarily_busy", "erp_read_unavailable",
  "malformed_response", "contract_mismatch", "product_not_found", "source_internal_error",
  "invalid_payload", "invalid_fields", "invalid_public_id", "identity_mismatch",
  "source_not_configured", "source_unavailable",
];
const invalidEvidence = new Set(["malformed_response", "contract_mismatch", "invalid_payload",
  "invalid_fields", "invalid_public_id", "identity_mismatch"]);
const states = {
  AVAILABLE: "PUBLISHED_OPERATIONAL_SIGNAL_ONLY", NOT_READY: "PUBLISHED_NOT_READY",
  OUT_OF_STOCK: "PUBLISHED_OUT_OF_STOCK", SALES_PAUSED: "PUBLISHED_SALES_PAUSED",
  TEMPORARILY_UNAVAILABLE: "PUBLISHED_OPERATIONAL_UNAVAILABLE",
  PRODUCT_NOT_FOUND: "PUBLISHED_OPERATIONAL_UNAVAILABLE", OPERATIONAL_FAILURE: "PUBLISHED_OPERATIONAL_UNAVAILABLE",
} as const;

/** Inspect plain data, not accessor payloads; no raw error/override metadata escapes. */
function data(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  return !!value && typeof value === "object" && [Object.prototype, null].includes(Object.getPrototypeOf(value)) &&
    keys.every(key => Object.hasOwn(Object.getOwnPropertyDescriptor(value, key) ?? {}, "value"));
}
function snapshot(publicId: string, value: EffectiveOperationalState | null) {
  try {
    if (!data(value, ["publicId", "availability", "provenance", "erp", "operationalReady", "sellableStock",
      "basePriceHuf", "activeOverride", "overrideDisposition", "checkoutAuthorization"]) ||
      value.publicId !== publicId || value.checkoutAuthorization !== "NOT_EVALUATED" ||
      !Object.hasOwn(states, value.availability) || !["ERP", "MANUAL_OVERRIDE", "UNAVAILABLE"].includes(value.provenance) ||
      !["NONE", "AUTO", "ACTIVE", "EXPIRED", "REVOKED", "IGNORED_PRODUCT_NOT_FOUND", "ERROR"].includes(value.overrideDisposition)) return null;
    let evidence: "KNOWN" | "NO_SOURCE" | "UNAVAILABLE" | "INVALID" | "PRODUCT_NOT_FOUND";
    let erpFacts: Readonly<{ operationalReady: boolean; sellableStock: number }> | null = null;
    const erp = value.erp;
    if (!data(erp, ["ok"])) return null;
    if (erp.ok === true) {
      if (!data(erp.product, ["publicId", "basePriceHuf", "sellableStock", "operationalReady"])) return null;
      const product = erp.product;
      const checked = normalizeOperationalProduct({ public_id: product.publicId, retail_price_huf: product.basePriceHuf,
        sellable_stock: product.sellableStock, operational_ready: product.operationalReady });
      if (!checked.ok || checked.product.publicId !== publicId || value.basePriceHuf !== checked.product.basePriceHuf ||
        value.operationalReady !== checked.product.operationalReady || value.sellableStock !== checked.product.sellableStock) return null;
      evidence = "KNOWN";
      erpFacts = { operationalReady: checked.product.operationalReady, sellableStock: checked.product.sellableStock };
    } else if (erp.ok === false) {
      if (!data(erp.error, ["code"]) || !failures.includes(erp.error.code) || value.basePriceHuf !== null ||
        value.operationalReady !== null || value.sellableStock !== null) return null;
      evidence = invalidEvidence.has(erp.error.code) ? "INVALID" : erp.error.code === "source_not_configured" ? "NO_SOURCE" :
        erp.error.code === "product_not_found" ? "PRODUCT_NOT_FOUND" : "UNAVAILABLE";
    } else return null;
    // Reject impossible provenance combinations, without deriving availability
    // from stock/readiness or overriding the existing resolver's manual intent.
    if (value.provenance === "UNAVAILABLE" && !["TEMPORARILY_UNAVAILABLE", "OPERATIONAL_FAILURE"].includes(value.availability)) return null;
    if (value.provenance === "ERP" && erp.ok === false && value.availability !== "PRODUCT_NOT_FOUND") return null;
    if (evidence === "PRODUCT_NOT_FOUND" && value.availability !== "PRODUCT_NOT_FOUND") return null;
    if (value.provenance === "MANUAL_OVERRIDE") {
      const override = validateOverride(value.activeOverride);
      if (!override.ok || override.record.publicId !== publicId || override.record.status !== "ACTIVE" ||
        override.record.mode === "AUTO" || value.overrideDisposition !== "ACTIVE") return null;
    } else if (value.activeOverride !== null) return null;
    return { effectiveAvailability: value.availability, provenance: value.provenance,
      overrideDisposition: value.overrideDisposition, evidence, erpFacts };
  } catch { return null; }
}

/**
 * Trusted server selection + editorial fact + PRE-RESOLVED effective snapshot.
 * Diagnostic only: does not resolve/recompute availability, read a clock/source,
 * choose discoverability policy, publish, expose price, or authorize commerce.
 * The existing snapshot has no attested freshness contract; never invent one.
 */
export function projectFirstSkuPublicationTruth(
  publicId: string, editorial: EditorialProduct | null, locale: EditorialLocale,
  operational: EffectiveOperationalState | null,
): FirstSkuPublicationTruth {
  const limits = { checkoutAuthorization: "NOT_EVALUATED", freshness: "NOT_EVALUATED" } as const;
  const blockers: Blocker[] = ["CHECKOUT_NOT_EVALUATED", "FRESHNESS_NOT_EVALUATED"];
  const validated = validateEditorialCatalogue([editorial]);
  if (!isPublicId(publicId) || !["en", "hu", "ko"].includes(locale) || !validated.ok ||
    validated.records[0].state !== "published" || validated.records[0].publicId !== publicId) {
    return { state: "UNPUBLISHED_OR_ABSENT", ...limits, blockers: [...blockers, "PUBLICATION_NOT_CONFIRMED"] };
  }
  const selectedLocaleContent = validated.records[0].translations[locale] === null ? "MISSING" : "PRESENT";
  if (selectedLocaleContent === "MISSING") blockers.push("SELECTED_LOCALE_MISSING");
  const current = snapshot(publicId, operational);
  const state: PublishedState = !current || current.evidence === "INVALID" ? "PUBLISHED_OPERATIONAL_UNAVAILABLE" : states[current.effectiveAvailability];
  if (state === "PUBLISHED_OPERATIONAL_UNAVAILABLE") blockers.push("OPERATIONAL_EVIDENCE_UNAVAILABLE");
  if (state === "PUBLISHED_NOT_READY") blockers.push("OPERATIONAL_NOT_READY");
  if (state === "PUBLISHED_OUT_OF_STOCK") blockers.push("OPERATIONAL_OUT_OF_STOCK");
  if (state === "PUBLISHED_SALES_PAUSED") blockers.push("SALES_PAUSED");
  if (current?.provenance === "MANUAL_OVERRIDE") blockers.push("MANUAL_INTENT_ONLY");
  return { state, publicId, locale, selectedLocaleContent, ...limits, blockers,
    ...(current ?? { effectiveAvailability: null, provenance: null, overrideDisposition: null,
      evidence: operational === null ? "UNAVAILABLE" : "INVALID", erpFacts: null }) };
}

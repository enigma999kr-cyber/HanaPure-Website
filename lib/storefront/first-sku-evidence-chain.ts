import "server-only";

import { isPublicId, normalizeOperationalProduct } from "../erp/product-operational";
import type { FirstSkuPublicationTruth } from "./first-sku-publication-truth";
import { inspectFirstSkuTrustedOperationalReadiness } from "./first-sku-trusted-operational-readiness";

const actions = {
  INVALID_SELECTION: "Select a canonical identity and supported locale on the server.",
  PUBLICATION_MISSING: "Obtain approved real editorial content; keep public catalogue empty until authorized.",
  PROJECTION_INVALID: "Supply a matching unmodified publication diagnostic.",
  IDENTITY_MISMATCH: "Reconcile exact selected identities before further evaluation.",
  LOCALE_MISSING: "Obtain approved content for the selected locale.",
  WIRE_INVALID: "Reconcile the internal version and payload contract offline.",
  CONTRACT_ABSENCE_ONLY: "Verify real source identity before interpreting absence.",
  UPSTREAM_UNAVAILABLE: "Obtain bounded source and override evidence under separate authority.",
  EVIDENCE_CONFLICT: "Reconcile independent snapshots; do not prefer favorable facts.",
  ZERO_STOCK: "Retain the supplied zero-stock fact; do not infer reservations.",
  NOT_READY: "Retain ERP readiness=false; do not replace ERP policy.",
  MANUAL_INTENT_ONLY: "Review manual provenance; intent cannot grant commerce authority.",
  OPERATIONAL_BLOCKER: "Resolve the existing publication projector's operational blocker.",
  AUTHENTICITY_UNVERIFIED: "Obtain independently verified issuer and source evidence.",
  TRANSPORT_UNVERIFIED: "Obtain authorized gateway peer, TLS and authentication evidence.",
  FRESHNESS_UNVERIFIED: "Establish an attested observation clock and expiry contract.",
  COMMERCE_NOT_EVALUATED: "Obtain separate real-SKU, price/VAT, checkout and fulfillment decisions.",
} as const;
type Reason = keyof typeof actions;
type Facts = Readonly<{ operationalReady: boolean; sellableStock: number }>;
export type FirstSkuEvidenceChain = Readonly<{
  classification: "STRUCTURAL_OK" | "CONTRACT_ABSENCE_ONLY" | "UPSTREAM_UNAVAILABLE" | "INVALID_OR_UNKNOWN";
  publicId?: string;
  publication: "LOCAL_SYNTHETIC" | "MISSING" | "UNAVAILABLE";
  wire: "LOCAL_SYNTHETIC" | "UNAVAILABLE";
  projectionFacts: Facts | null;
  wireFacts: Facts | null;
  authenticity: "UNVERIFIED";
  transportAttestation: "UNVERIFIED";
  freshness: "UNVERIFIED";
  expiry: "NOT_EVALUATED";
  vatCheckout: "NOT_EVALUATED";
  fulfillment: "NOT_EVALUATED";
  readyForLivePublication: false;
  readyForCheckout: false;
  trustedForLiveUse: false;
  blockers: readonly Readonly<{ code: Reason; action: string }>[];
}>;

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) &&
    [Object.prototype, null].includes(Object.getPrototypeOf(value));
}
function own(value: Record<string, unknown>, key: string): unknown {
  return Object.getOwnPropertyDescriptor(value, key)?.value;
}
function facts(value: unknown): Facts | null {
  if (!object(value)) return null;
  const result = normalizeOperationalProduct({ public_id: "00000000-0000-0000-0000-000000000000",
    retail_price_huf: 0, sellable_stock: own(value, "sellableStock"), operational_ready: own(value, "operationalReady") });
  return result.ok ? { sellableStock: result.product.sellableStock, operationalReady: result.product.operationalReady } : null;
}

/** Pure sync composition: no second ERP/override read, clock or trust promotion.
 * Publication must come from #32/#34; it remains an unauthenticated diagnostic.
 * Descriptor access avoids ordinary getters, not arbitrary executable Proxy traps.
 */
export function composeFirstSkuEvidenceChain(
  selectedPublicId: string, locale: string, publication: FirstSkuPublicationTruth | unknown,
  status: number, body: unknown,
): FirstSkuEvidenceChain {
  const reasons = new Set<Reason>();
  let classification: FirstSkuEvidenceChain["classification"] = "INVALID_OR_UNKNOWN";
  let publicationDomain: FirstSkuEvidenceChain["publication"] = "UNAVAILABLE";
  let wire: FirstSkuEvidenceChain["wire"] = "UNAVAILABLE";
  let publicId: string | undefined;
  let projectionFacts: Facts | null = null, wireFacts: Facts | null = null;
  try {
    if (!isPublicId(selectedPublicId) || !["en", "hu", "ko"].includes(locale)) reasons.add("INVALID_SELECTION");
    else {
      const observed = inspectFirstSkuTrustedOperationalReadiness(selectedPublicId, status, body);
      wireFacts = observed.erpFacts;
      if (observed.evidence === "VALID_PRODUCT") { classification = "STRUCTURAL_OK"; wire = "LOCAL_SYNTHETIC"; }
      else if (observed.evidence === "CONTRACT_ABSENCE_ONLY") {
        classification = "CONTRACT_ABSENCE_ONLY"; wire = "LOCAL_SYNTHETIC"; reasons.add("CONTRACT_ABSENCE_ONLY");
      } else if (observed.evidence === "SOURCE_UNAVAILABLE") { classification = "UPSTREAM_UNAVAILABLE"; reasons.add("UPSTREAM_UNAVAILABLE"); }
      else reasons.add(observed.evidence === "IDENTITY_MISMATCH" ? "IDENTITY_MISMATCH" : "WIRE_INVALID");
      if (!object(publication)) reasons.add("PROJECTION_INVALID");
      else if (own(publication, "state") === "UNPUBLISHED_OR_ABSENT") {
        publicationDomain = "MISSING"; reasons.add("PUBLICATION_MISSING");
        // #32 deliberately merges absent, draft and invalid private content.
      } else {
        const state = own(publication, "state");
        const allowedStates = ["PUBLISHED_OPERATIONAL_SIGNAL_ONLY", "PUBLISHED_NOT_READY", "PUBLISHED_OUT_OF_STOCK", "PUBLISHED_SALES_PAUSED", "PUBLISHED_OPERATIONAL_UNAVAILABLE"];
        const valid = typeof state === "string" && allowedStates.includes(state) &&
          own(publication, "checkoutAuthorization") === "NOT_EVALUATED" && own(publication, "freshness") === "NOT_EVALUATED" &&
          ["PRESENT", "MISSING"].includes(own(publication, "selectedLocaleContent") as string) &&
          ["ERP", "MANUAL_OVERRIDE", "UNAVAILABLE", null].includes(own(publication, "provenance") as string | null) &&
          ["KNOWN", "NO_SOURCE", "UNAVAILABLE", "INVALID", "PRODUCT_NOT_FOUND"].includes(own(publication, "evidence") as string);
        if (!valid) reasons.add("PROJECTION_INVALID");
        else if (own(publication, "publicId") !== selectedPublicId || own(publication, "locale") !== locale) reasons.add("IDENTITY_MISMATCH");
        else {
          publicationDomain = "LOCAL_SYNTHETIC"; publicId = selectedPublicId;
          const suppliedFacts = own(publication, "erpFacts");
          projectionFacts = facts(suppliedFacts);
          if ((suppliedFacts !== null && projectionFacts === null) ||
            (own(publication, "evidence") === "KNOWN") !== (projectionFacts !== null)) reasons.add("PROJECTION_INVALID");
          if (own(publication, "selectedLocaleContent") === "MISSING") reasons.add("LOCALE_MISSING");
          if (own(publication, "provenance") === "MANUAL_OVERRIDE") reasons.add("MANUAL_INTENT_ONLY");
          if (state !== "PUBLISHED_OPERATIONAL_SIGNAL_ONLY") reasons.add("OPERATIONAL_BLOCKER");
          if (["NO_SOURCE", "UNAVAILABLE"].includes(own(publication, "evidence") as string)) reasons.add("UPSTREAM_UNAVAILABLE");
          if (own(publication, "evidence") === "INVALID") reasons.add("PROJECTION_INVALID");
          if (projectionFacts?.sellableStock === 0) reasons.add("ZERO_STOCK");
          if (projectionFacts?.operationalReady === false) reasons.add("NOT_READY");
          const expectedEvidence = observed.evidence === "VALID_PRODUCT" ? "KNOWN" : observed.evidence === "CONTRACT_ABSENCE_ONLY" ? "PRODUCT_NOT_FOUND" : null;
          if ((expectedEvidence !== null && own(publication, "evidence") !== expectedEvidence) ||
            (projectionFacts !== null && wireFacts === null) ||
            (projectionFacts && wireFacts && (projectionFacts.sellableStock !== wireFacts.sellableStock || projectionFacts.operationalReady !== wireFacts.operationalReady))) reasons.add("EVIDENCE_CONFLICT");
        }
      }
    }
  } catch { reasons.add("PROJECTION_INVALID"); }
  if (wireFacts?.sellableStock === 0) reasons.add("ZERO_STOCK");
  if (wireFacts?.operationalReady === false) reasons.add("NOT_READY");
  if (reasons.has("PROJECTION_INVALID") || reasons.has("IDENTITY_MISMATCH") || reasons.has("EVIDENCE_CONFLICT")) {
    classification = "INVALID_OR_UNKNOWN"; publicId = undefined;
  }
  reasons.add("AUTHENTICITY_UNVERIFIED"); reasons.add("TRANSPORT_UNVERIFIED");
  reasons.add("FRESHNESS_UNVERIFIED"); reasons.add("COMMERCE_NOT_EVALUATED");
  return { classification, ...(publicId ? { publicId } : {}), publication: publicationDomain, wire,
    projectionFacts, wireFacts, authenticity: "UNVERIFIED", transportAttestation: "UNVERIFIED",
    freshness: "UNVERIFIED", expiry: "NOT_EVALUATED", vatCheckout: "NOT_EVALUATED", fulfillment: "NOT_EVALUATED",
    readyForLivePublication: false, readyForCheckout: false, trustedForLiveUse: false,
    blockers: (Object.keys(actions) as Reason[]).filter(code => reasons.has(code)).map(code => ({ code, action: actions[code] })) };
}

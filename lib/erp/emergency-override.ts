import "server-only";

import {
  isPublicId,
  type OperationalProductResult,
} from "./product-operational";

export type OverrideMode = "AUTO" | "FORCE_AVAILABLE" | "FORCE_OUT_OF_STOCK" | "SALES_PAUSED";
export type OverrideMutation = Readonly<{ actorId: string; reason: string; at: string }>;
export type EmergencyOverride = Readonly<{
  publicId: string;
  mode: OverrideMode;
  reason: string;
  /** Future authenticated admin identity, supplied only by trusted server code. */
  actorId: string;
  createdAt: string;
  expiresAt?: string;
  status: "ACTIVE" | "REVOKED";
  revocation?: OverrideMutation;
}>;

/** ISO UTC with seconds, optional millisecond precision; reject date rollovers. */
export function isUtcTimestamp(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)) return false;
  const millis = Date.parse(value);
  return Number.isFinite(millis) &&
    new Date(millis).toISOString() === (value.includes(".") ? value : value.replace("Z", ".000Z"));
}

const nonempty = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;
const modes: readonly string[] = ["AUTO", "FORCE_AVAILABLE", "FORCE_OUT_OF_STOCK", "SALES_PAUSED"];

export type OverrideValidation =
  | Readonly<{ ok: true; record: EmergencyOverride }>
  | Readonly<{ ok: false; code: "invalid_override" }>;

/** Validate both new commands and provider records. No quantity/price fields accepted. */
export function validateOverride(input: unknown): OverrideValidation {
  if (!input || typeof input !== "object" || Array.isArray(input)) return { ok: false, code: "invalid_override" };
  const data = input as Record<string, unknown>;
  const allowed = ["publicId", "mode", "reason", "actorId", "createdAt", "expiresAt", "status", "revocation"];
  if (Object.keys(data).some((key) => !allowed.includes(key)) ||
    !isPublicId(data.publicId) || typeof data.mode !== "string" || !modes.includes(data.mode) ||
    typeof data.reason !== "string" || (data.mode !== "AUTO" && !nonempty(data.reason)) ||
    !nonempty(data.actorId) || !isUtcTimestamp(data.createdAt) ||
    (data.status !== "ACTIVE" && data.status !== "REVOKED") ||
    (data.expiresAt !== undefined && (!isUtcTimestamp(data.expiresAt) ||
      Date.parse(data.expiresAt) <= Date.parse(data.createdAt)))) {
    return { ok: false, code: "invalid_override" };
  }
  let revocation: OverrideMutation | undefined;
  if (data.status === "REVOKED") {
    const raw = data.revocation;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ok: false, code: "invalid_override" };
    const value = raw as Record<string, unknown>;
    if (Object.keys(value).some((key) => !["actorId", "reason", "at"].includes(key)) ||
      !nonempty(value.actorId) || !nonempty(value.reason) || !isUtcTimestamp(value.at) ||
      Date.parse(value.at) < Date.parse(data.createdAt)) return { ok: false, code: "invalid_override" };
    revocation = Object.freeze({ actorId: value.actorId, reason: value.reason, at: value.at });
  } else if (data.revocation !== undefined) return { ok: false, code: "invalid_override" };
  return {
    ok: true,
    record: Object.freeze({
      publicId: data.publicId, mode: data.mode as OverrideMode, reason: data.reason,
      actorId: data.actorId, createdAt: data.createdAt, status: data.status,
      ...(data.expiresAt === undefined ? {} : { expiresAt: data.expiresAt as string }),
      ...(revocation ? { revocation } : {}),
    }),
  };
}

export type OverrideReadResult =
  | Readonly<{ ok: true; record: EmergencyOverride | null; revision: string | null }>
  | Readonly<{ ok: false; code: "override_store_failure" | "invalid_override" }>;

export type EffectiveAvailability = Readonly<{
  availability: "AVAILABLE" | "OUT_OF_STOCK" | "SALES_PAUSED" | "NOT_READY" |
    "TEMPORARILY_UNAVAILABLE" | "PRODUCT_NOT_FOUND" | "OPERATIONAL_FAILURE";
  provenance: "ERP" | "MANUAL_OVERRIDE" | "UNAVAILABLE";
  /** Original ERP result remains distinct from manual intent and store failure. */
  erp: OperationalProductResult;
  operationalReady: boolean | null;
  sellableStock: number | null;
  activeOverride: EmergencyOverride | null;
  overrideDisposition: "NONE" | "AUTO" | "ACTIVE" | "EXPIRED" | "REVOKED" | "IGNORED_PRODUCT_NOT_FOUND" | "ERROR";
  overrideError?: "override_store_failure" | "invalid_override" | "invalid_resolution_input";
  /** Availability intent is never a checkout/reservation authorization. */
  checkoutAuthorization: "NOT_EVALUATED";
}>;

/**
 * Pure server-domain resolution: no I/O, publication decision, price math,
 * readiness derivation, stock recomputation, reservation, or checkout approval.
 * A single stored current record avoids competing-mode ordering ambiguities.
 */
export function resolveEffectiveAvailability(
  publicId: string,
  erp: OperationalProductResult,
  override: OverrideReadResult,
  now: string,
): EffectiveAvailability {
  const facts = {
    erp, operationalReady: erp.ok ? erp.product.operationalReady : null,
    sellableStock: erp.ok ? erp.product.sellableStock : null,
    checkoutAuthorization: "NOT_EVALUATED" as const,
  };
  const failure = (overrideError: EffectiveAvailability["overrideError"]): EffectiveAvailability => ({
    ...facts, availability: "OPERATIONAL_FAILURE", provenance: "UNAVAILABLE",
    activeOverride: null, overrideDisposition: "ERROR", overrideError,
  });
  if (!isPublicId(publicId) || !isUtcTimestamp(now) ||
    (erp.ok && erp.product.publicId !== publicId)) return failure("invalid_resolution_input");
  if (!override.ok) return failure(override.code);

  let active: EmergencyOverride | null = null;
  let disposition: EffectiveAvailability["overrideDisposition"] = "NONE";
  if (override.record !== null) {
    const valid = validateOverride(override.record);
    if (!valid.ok || valid.record.publicId !== publicId || Date.parse(valid.record.createdAt) > Date.parse(now)) {
      return failure("invalid_override");
    }
    const record = valid.record;
    if (record.status === "REVOKED") {
      if (Date.parse(record.revocation!.at) > Date.parse(now)) return failure("invalid_override");
      disposition = "REVOKED";
    } else if (record.expiresAt !== undefined && Date.parse(record.expiresAt) <= Date.parse(now)) {
      disposition = "EXPIRED";
    } else if (record.mode === "AUTO") disposition = "AUTO";
    else { active = record; disposition = "ACTIVE"; }
  }
  const common = { ...facts, activeOverride: active, overrideDisposition: disposition };
  // A trusted ERP business 404 cannot be overridden into an existing product.
  if (!erp.ok && erp.error.code === "product_not_found") return {
    ...common, availability: "PRODUCT_NOT_FOUND", provenance: "ERP",
    activeOverride: null, overrideDisposition: active ? "IGNORED_PRODUCT_NOT_FOUND" : disposition,
  };
  if (active) return {
    ...common, provenance: "MANUAL_OVERRIDE",
    availability: active.mode === "SALES_PAUSED" ? "SALES_PAUSED" :
      active.mode === "FORCE_OUT_OF_STOCK" ? "OUT_OF_STOCK" : "AVAILABLE",
  };
  if (!erp.ok) return { ...common, availability: "TEMPORARILY_UNAVAILABLE", provenance: "UNAVAILABLE" };
  return {
    ...common, provenance: "ERP",
    availability: !erp.product.operationalReady ? "NOT_READY" :
      erp.product.sellableStock > 0 ? "AVAILABLE" : "OUT_OF_STOCK",
  };
}

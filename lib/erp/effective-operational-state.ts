import "server-only";

import {
  readOperationalProduct,
  type ErpOperationalSource,
  type OperationalReadOptions,
} from "./product-operational";
import {
  resolveEffectiveAvailability,
  type EffectiveAvailability,
} from "./emergency-override";
import {
  readCurrentOverride,
  type EmergencyOverrideReader,
} from "./emergency-override-store";

/** Internal server result, not a browser DTO or authorization to sell. */
export type EffectiveOperationalState = EffectiveAvailability & Readonly<{
  publicId: string;
  /** ERP canonical value only; no customer-price/VAT interpretation. */
  basePriceHuf: number | null;
  /** Current store snapshot revision, even when expired/revoked/AUTO. */
  overrideRevision: string | null;
}>;

export type EffectiveOperationalDependencies = Readonly<{
  erpSource?: ErpOperationalSource;
  overrideStore: EmergencyOverrideReader;
}>;

export type EffectiveOperationalReadOptions = OperationalReadOptions & Readonly<{
  /** Trusted server/test resolution time; defaults to UTC after both reads. */
  now?: string;
}>;

/**
 * No default provider, cache, retry, mutation, or production connection.
 * Always read ERP, including under manual controls: otherwise known canonical
 * facts and trusted product absence could be lost. Concurrent reads minimize
 * latency but are separate snapshots, not a cross-system atomic transaction.
 * The injected store must bound its own I/O; its existing interface has no signal.
 */
export async function readEffectiveOperationalState(
  publicId: string,
  dependencies: EffectiveOperationalDependencies,
  options?: EffectiveOperationalReadOptions,
): Promise<EffectiveOperationalState> {
  const [erp, override] = await Promise.all([
    readOperationalProduct(publicId, dependencies.erpSource, { signal: options?.signal }),
    readCurrentOverride(dependencies.overrideStore, publicId),
  ]);
  const effective = resolveEffectiveAvailability(
    publicId, erp, override, options?.now ?? new Date().toISOString(),
  );
  return {
    ...effective,
    publicId,
    basePriceHuf: erp.ok ? erp.product.basePriceHuf : null,
    overrideRevision: override.ok ? override.revision : null,
  };
}

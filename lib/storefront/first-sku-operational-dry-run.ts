import "server-only";

import { validateEditorialCatalogue, type EditorialLocale, type EditorialProduct } from "../catalog/editorial-catalogue";
import { isPublicId } from "../erp/product-operational";
import {
  readEffectiveOperationalState, type EffectiveOperationalDependencies,
  type EffectiveOperationalReadOptions, type EffectiveOperationalState,
} from "../erp/effective-operational-state";
import { projectFirstSkuPublicationTruth, type FirstSkuPublicationTruth } from "./first-sku-publication-truth";

/**
 * Internal evidence join only: a trusted server-selected identity and editorial
 * record, never browser input. No default provider, transport, persistence or
 * commercial authorization. Existing owners retain all resolution policies.
 */
export async function dryRunFirstSkuOperationalEvidence(
  publicId: string,
  editorial: EditorialProduct | null,
  locale: EditorialLocale,
  dependencies: EffectiveOperationalDependencies,
  options?: EffectiveOperationalReadOptions,
): Promise<FirstSkuPublicationTruth> {
  let selected = editorial;
  let publishedSnapshot: EditorialProduct | null = null;
  let operational: EffectiveOperationalState | null = null;
  try {
    // Do not even inspect operational dependencies/options for private/invalid
    // publication. Validation also supplies an immutable snapshot across await.
    if (isPublicId(publicId) && (locale === "en" || locale === "hu" || locale === "ko")) {
      const validated = validateEditorialCatalogue([editorial]);
      if (validated.ok && validated.records[0].state === "published" && validated.records[0].publicId === publicId) {
        publishedSnapshot = validated.records[0];
        selected = publishedSnapshot;
        operational = await readEffectiveOperationalState(publicId, dependencies, options);
      }
    }
  } catch {
    // Unexpected dependency/accessor errors are not diagnostic payloads. Retain
    // only an already validated publication snapshot, with unavailable evidence.
    selected = publishedSnapshot;
    operational = null;
  }
  return projectFirstSkuPublicationTruth(publicId, selected, locale, operational);
}

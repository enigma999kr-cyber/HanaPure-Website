import "server-only";

import { brandNames } from "../../data/brands";
import { isPublicId } from "../erp/product-operational";

export type EditorialLocale = "en" | "hu" | "ko";
export type EditorialImage = Readonly<{ src: string; alt: string }>;
export type EditorialContent = Readonly<{
  name: string;
  description: string;
  images: readonly EditorialImage[];
  /** null explicitly means content has not been supplied; not a safety assessment. */
  usage: string | null;
  caution: string | null;
}>;
export type EditorialProduct = Readonly<{
  /** Immutable ERP identity. Never substitute a slug, SKU or locally generated ID. */
  publicId: string;
  brand: (typeof brandNames)[number];
  /** Stable, locale-independent lookup key. No rename/redirect workflow in v1. */
  slug: string;
  state: "draft" | "published";
  /** null is an explicit missing translation; no implicit locale fallback. */
  translations: Readonly<Record<EditorialLocale, EditorialContent | null>>;
}>;
export type CatalogueErrorCode = "invalid_catalogue" | "invalid_record" |
  "invalid_brand" | "duplicate_public_id" | "duplicate_slug" | "incomplete_published_content";
export type CatalogueValidation =
  | Readonly<{ ok: true; records: readonly EditorialProduct[] }>
  | Readonly<{ ok: false; code: CatalogueErrorCode; index?: number }>;

const locales: readonly EditorialLocale[] = ["en", "hu", "ko"];
const nonempty = (value: string) => value.trim().length > 0;

/** Exact data properties only: no operational fields, getters or inherited payload. */
function exact(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))) return false;
  const actual = Reflect.ownKeys(value);
  return actual.length === keys.length && keys.every((key) =>
    Object.hasOwn(value, key) && Object.hasOwn(Object.getOwnPropertyDescriptor(value, key)!, "value"));
}

function imageSource(src: string): boolean {
  if (!nonempty(src) || src !== src.trim() || /[\u0000-\u0020\\]/.test(src)) return false;
  if (src.startsWith("/") && !src.startsWith("//")) return true;
  try {
    const url = new URL(src);
    return url.protocol === "https:" && !url.username && !url.password;
  } catch { return false; }
}

function content(value: unknown): EditorialContent | null {
  if (!exact(value, ["name", "description", "images", "usage", "caution"]) ||
    typeof value.name !== "string" || typeof value.description !== "string" ||
    !Array.isArray(value.images) ||
    !(value.usage === null || typeof value.usage === "string") ||
    !(value.caution === null || typeof value.caution === "string")) return null;
  const images: EditorialImage[] = [];
  for (const image of value.images) {
    if (!exact(image, ["src", "alt"]) || typeof image.src !== "string" ||
      !imageSource(image.src) || typeof image.alt !== "string") return null;
    images.push(Object.freeze({ src: image.src, alt: image.alt }));
  }
  return Object.freeze({ name: value.name, description: value.description,
    images: Object.freeze(images), usage: value.usage, caution: value.caution });
}

/**
 * Structural editorial completeness only, not LP approval/compliance/launch readiness.
 * Published records need at least one named/described translation; every supplied
 * translation and image alt must be complete. Missing locales stay null. No required
 * launch locale, minimum image count, mandatory caution text or commerce policy is set.
 */
export function validateEditorialCatalogue(input: unknown): CatalogueValidation {
  if (!Array.isArray(input)) return { ok: false, code: "invalid_catalogue" };
  const records: EditorialProduct[] = [];
  const ids = new Set<string>();
  const slugs = new Set<string>();
  for (let index = 0; index < input.length; index++) {
    const invalid = (code: CatalogueErrorCode): CatalogueValidation => ({ ok: false, code, index });
    try {
      const raw = input[index];
      if (!exact(raw, ["publicId", "brand", "slug", "state", "translations"]) ||
        !isPublicId(raw.publicId) || typeof raw.slug !== "string" ||
        !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(raw.slug) ||
        (raw.state !== "draft" && raw.state !== "published") ||
        !exact(raw.translations, locales)) return invalid("invalid_record");
      if (typeof raw.brand !== "string" || !brandNames.some((brand) => brand === raw.brand)) {
        return invalid("invalid_brand");
      }
      // Detect case variants of the same UUID without rewriting the ERP identity.
      const identity = raw.publicId.toLowerCase();
      if (ids.has(identity)) return invalid("duplicate_public_id");
      if (slugs.has(raw.slug)) return invalid("duplicate_slug");
      const translations = {} as Record<EditorialLocale, EditorialContent | null>;
      for (const locale of locales) {
        const supplied = raw.translations[locale];
        const parsed = supplied === null ? null : content(supplied);
        if (supplied !== null && parsed === null) return invalid("invalid_record");
        translations[locale] = parsed;
      }
      const supplied = locales.flatMap((locale) => translations[locale] ?? []);
      if (raw.state === "published" && (supplied.length === 0 || supplied.some((translation) =>
        !nonempty(translation.name) || !nonempty(translation.description) ||
        translation.images.some((image) => !nonempty(image.alt))))) {
        return invalid("incomplete_published_content");
      }
      records.push(Object.freeze({ publicId: raw.publicId,
        brand: raw.brand as EditorialProduct["brand"], slug: raw.slug, state: raw.state,
        translations: Object.freeze(translations) }));
      ids.add(identity);
      slugs.add(raw.slug);
    } catch { return invalid("invalid_record"); }
  }
  return { ok: true, records: Object.freeze(records) };
}

/** Validated immutable snapshot. No provider, network, operational join or write API. */
export function createLocalCatalogueReader(input: unknown) {
  const validated = validateEditorialCatalogue(input);
  if (!validated.ok) throw new Error(`editorial_catalogue:${validated.code}`);
  const published = Object.freeze(validated.records.filter((record) => record.state === "published"));
  return Object.freeze({
    listPublished: () => published,
    findPublishedByPublicId: (publicId: string) => published.find((record) => record.publicId === publicId) ?? null,
    findPublishedBySlug: (slug: string) => published.find((record) => record.slug === slug) ?? null,
  });
}

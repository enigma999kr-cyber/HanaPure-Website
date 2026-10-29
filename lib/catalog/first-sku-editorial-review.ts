import "server-only";

import { types } from "node:util";
import { validateEditorialCatalogue, type EditorialLocale } from "./editorial-catalogue";

/** Fixed test placeholder, not a generated or approved real product identity. */
export const EDITORIAL_SYNTHETIC_ID = "a1234567-1234-4321-8123-123456789abc";
const locales: readonly EditorialLocale[] = ["en", "hu", "ko"];
const text = {
  HUMAN_REVIEW_REQUIRED: ["Review this locale, optional usage/caution and all unevaluated approvals manually; field completeness grants no publication authority.", "Ellenőrizze kézzel ezt a nyelvi változatot, az opcionális használati és figyelmeztető szöveget, valamint minden nem értékelt jóváhagyást; a mezők teljessége nem engedélyez közzétételt.", "이 언어의 내용, 선택적인 사용법·주의 문구와 미평가 승인을 수동 검토하세요. 필드 완성은 게시 권한을 부여하지 않습니다."],
  INVALID_INPUT: ["Correct the bounded synthetic draft structure.", "Javítsa a korlátozott szintetikus piszkozat szerkezetét.", "제한된 합성 초안의 구조를 수정하세요."],
  IDENTITY: ["Use the selected synthetic placeholder identity.", "Használja a kiválasztott szintetikus helyőrző azonosítót.", "선택한 합성 자리표시자 식별자를 사용하세요."],
  DRAFT_REQUIRED: ["Keep the candidate in draft state.", "Tartsa a jelöltet piszkozat állapotban.", "후보를 초안 상태로 유지하세요."],
  STRUCTURE: ["Correct the existing catalogue contract violation.", "Javítsa a meglévő katalógusszerződés megsértését.", "기존 카탈로그 구조 위반을 수정하세요."],
  COLLISION: ["Resolve the duplicate identity or slug within supplied comparisons.", "Oldja fel a megadott összehasonlítások azonosító- vagy slugütközését.", "제공된 비교 자료 안의 식별자 또는 슬러그 충돌을 해결하세요."],
  UNSAFE_TEXT: ["Remove markup or unsafe control content; submit plain editorial text.", "Távolítsa el a jelölőkódot és a nem biztonságos vezérlőjeleket; adjon meg egyszerű szöveget.", "마크업과 안전하지 않은 제어 문자를 제거하고 일반 편집 텍스트를 입력하세요."],
  LOCALE_MISSING: ["Supply this locale explicitly; do not silently fall back.", "Adja meg ezt a nyelvi változatot; ne használjon csendes helyettesítést.", "이 언어의 내용을 명시적으로 제공하세요. 다른 언어로 조용히 대체하지 마세요."],
  NAME_MISSING: ["Supply a nonblank title for editorial review.", "Adjon meg nem üres címet a szerkesztői ellenőrzéshez.", "편집 검토를 위한 비어 있지 않은 제목을 입력하세요."],
  DESCRIPTION_MISSING: ["Supply a nonblank description for editorial review.", "Adjon meg nem üres leírást a szerkesztői ellenőrzéshez.", "편집 검토를 위한 비어 있지 않은 설명을 입력하세요."],
  ALT_MISSING: ["Describe the supplied image for manual accessibility review.", "Írja le a megadott képet a kézi akadálymentességi ellenőrzéshez.", "수동 접근성 검토를 위해 제공된 이미지의 대체 설명을 입력하세요."],
  POSSIBLE_LOCALE_REUSE: ["Review identical cross-locale text; language correctness is not machine verified.", "Ellenőrizze az azonos, több nyelvnél szereplő szöveget; a nyelvi helyességet a gép nem igazolta.", "언어 간 동일한 텍스트를 검토하세요. 언어 적합성은 자동 검증되지 않았습니다."],
} as const;
type Code = keyof typeof text;
type Issue = Readonly<{ code: Code; field: string; locale: EditorialLocale | null }>;

// Descriptor-only bounded snapshot; reject Proxies before executing their traps.
function snapshot(value: unknown, budget = { nodes: 0, chars: 0 }, depth = 0): unknown {
  if (++budget.nodes > 4000 || depth > 8) throw Error();
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "string") {
    budget.chars += value.length;
    if (value.length > 4000 || budget.chars > 64000) throw Error();
    return value;
  }
  if (!value || typeof value !== "object" || types.isProxy(value)) throw Error();
  if (Array.isArray(value)) {
    if (value.length > 20 || Reflect.ownKeys(value).length !== value.length + 1) throw Error();
    return Array.from({ length: value.length }, (_, i) => {
      const d = Object.getOwnPropertyDescriptor(value, String(i));
      if (!d || !("value" in d)) throw Error(); return snapshot(d.value, budget, depth + 1);
    });
  }
  if (![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw Error();
  const result: Record<string, unknown> = Object.create(null), keys = Reflect.ownKeys(value);
  if (keys.length > 8) throw Error();
  for (const key of keys) {
    if (typeof key !== "string" || key === "__proto__") throw Error();
    const d = Object.getOwnPropertyDescriptor(value, key);
    if (!d || !("value" in d)) throw Error(); result[key] = snapshot(d.value, budget, depth + 1);
  }
  return result;
}
function exact(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) &&
    Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
}
const unsafe = (value: string) => /[<>\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]|(?:javascript|vbscript|data)\s*:|&#(?:x[0-9a-f]+|\d+);/i.test(value);

/** Pure review of synthetic data only. Completeness invites HUMAN review, never approval.
 * No content, media URL, slug, secrets or private source text is echoed in the DTO.
 */
export function reviewFirstSkuEditorialDraft(input: unknown) {
  const issues: Issue[] = [];
  const add = (code: Code, field: string, locale: EditorialLocale | null = null) => issues.push({ code, field, locale });
  const localeStatus: Record<EditorialLocale, "NOT_EVALUATED" | "MISSING" | "INCOMPLETE" | "COMPLETE_FOR_REVIEW"> = { en: "NOT_EVALUATED", hu: "NOT_EVALUATED", ko: "NOT_EVALUATED" };
  const optional: Record<EditorialLocale, { usage: "SUPPLIED" | "NOT_SUPPLIED" | "NOT_EVALUATED"; caution: "SUPPLIED" | "NOT_SUPPLIED" | "NOT_EVALUATED" }> = {
    en: { usage: "NOT_EVALUATED", caution: "NOT_EVALUATED" }, hu: { usage: "NOT_EVALUATED", caution: "NOT_EVALUATED" }, ko: { usage: "NOT_EVALUATED", caution: "NOT_EVALUATED" },
  };
  let invalid = false, comparisonScope = "NOT_EVALUATED";
  try {
    const value = snapshot(input);
    if (!exact(value, ["scope", "selectedPublicId", "draft", "comparisons"]) || value.scope !== "SYNTHETIC_ONLY" ||
      !Array.isArray(value.comparisons)) throw Error();
    const draft = value.draft;
    if (!exact(draft, ["publicId", "brand", "slug", "state", "translations"])) throw Error();
    if (value.selectedPublicId !== EDITORIAL_SYNTHETIC_ID || draft.publicId !== EDITORIAL_SYNTHETIC_ID) { invalid = true; add("IDENTITY", "$.publicId"); }
    if (draft.state !== "draft") { invalid = true; add("DRAFT_REQUIRED", "$.state"); }
    // Every comparison must itself be a structurally valid non-public draft.
    if (value.comparisons.some(item => !exact(item, ["publicId", "brand", "slug", "state", "translations"]) || item.state !== "draft")) throw Error();
    const validated = validateEditorialCatalogue([draft, ...value.comparisons]);
    if (!validated.ok) {
      invalid = true; add(validated.code === "duplicate_slug" || validated.code === "duplicate_public_id" ? "COLLISION" : "STRUCTURE", "$");
    } else {
      comparisonScope = value.comparisons.length ? "LOCAL_SUPPLIED_ONLY" : "NOT_EVALUATED";
      const record = validated.records[0];
      for (const [index, item] of validated.records.entries()) for (const locale of locales) {
        const c = item.translations[locale]; if (!c) continue;
        if (c.images.length > 10) { invalid = true; add("STRUCTURE", index === 0 ? `$.translations.${locale}.images` : "$.comparisons", index === 0 ? locale : null); }
        for (const field of ["name", "description", "usage", "caution"] as const) if (c[field] !== null && unsafe(c[field])) {
          invalid = true; add("UNSAFE_TEXT", index === 0 ? `$.translations.${locale}.${field}` : "$.comparisons", index === 0 ? locale : null);
        }
        for (const [i, image] of c.images.entries()) if (unsafe(image.src) || unsafe(image.alt) || /(?:^|\/)\.\.(?:\/|$)|%2e|%2f|%5c/i.test(image.src)) {
          invalid = true; add("UNSAFE_TEXT", index === 0 ? `$.translations.${locale}.images[${i}]` : "$.comparisons", index === 0 ? locale : null);
        }
      }
      if (!invalid) for (const locale of locales) {
        const c = record.translations[locale], field = `$.translations.${locale}`;
        if (!c) { localeStatus[locale] = "MISSING"; add("LOCALE_MISSING", field, locale); continue; }
        optional[locale] = { usage: c.usage?.trim() ? "SUPPLIED" : "NOT_SUPPLIED", caution: c.caution?.trim() ? "SUPPLIED" : "NOT_SUPPLIED" };
        const before = issues.length;
        if (!c.name.trim()) add("NAME_MISSING", `${field}.name`, locale);
        if (!c.description.trim()) add("DESCRIPTION_MISSING", `${field}.description`, locale);
        for (const [i, image] of c.images.entries()) if (!image.alt.trim()) add("ALT_MISSING", `${field}.images[${i}].alt`, locale);
        // Conservative copy-reuse flag, not language detection or translation certification.
        if (c.name.trim() && c.description.trim() && locales.some(other => other !== locale &&
          record.translations[other]?.name === c.name && record.translations[other]?.description === c.description)) add("POSSIBLE_LOCALE_REUSE", field, locale);
        localeStatus[locale] = issues.length === before ? "COMPLETE_FOR_REVIEW" : "INCOMPLETE";
      }
    }
  } catch { invalid = true; add("INVALID_INPUT", "$"); }
  const unique = issues.filter((issue, index) => issues.findIndex(i => i.code === issue.code && i.field === issue.field && i.locale === issue.locale) === index);
  const status = invalid ? "INVALID_INPUT" : unique.length ? "DRAFT_INCOMPLETE" : "READY_FOR_HUMAN_EDITORIAL_REVIEW";
  return {
    version: "1", scope: "SYNTHETIC_ONLY", status,
    ...(invalid ? {} : { selectedPublicId: EDITORIAL_SYNTHETIC_ID }), locales: localeStatus, optionalContent: optional,
    issues: unique,
    editorTasks: Object.fromEntries(locales.map((locale, index) => [locale, [...unique.map(issue => ({ ...issue, action: text[issue.code][index] })),
      { code: "HUMAN_REVIEW_REQUIRED", field: `$.translations.${locale}`, locale, action: text.HUMAN_REVIEW_REQUIRED[index] }]])),
    comparisonScope, outsideSuppliedCollisionCheck: "NOT_EVALUATED",
    notEvaluated: ["REAL_PRODUCT_IDENTITY", "LANGUAGE_CORRECTNESS", "CONTENT_APPROVAL", "CLAIMS_LEGAL_INCI", "PHOTO_RIGHTS", "SEO_SIGNOFF", "ACCESSIBILITY_MANUAL", "HUMAN_EDITORIAL_SIGNOFF", "ERP_AUTHENTICITY", "ERP_FRESHNESS", "STOCK", "PRICING_VAT", "COMMERCE_CHECKOUT"],
    readyForLivePublication: false, readyForCheckout: false, trustedForLiveUse: false,
  } as const;
}

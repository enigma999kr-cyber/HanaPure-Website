// Synthetic editorial records only. Never imported by the production catalogue.
const content = (locale) => ({
  name: `TEST ONLY ${locale} published item`,
  description: `TEST ONLY ${locale} editorial fixture. Not a real product.`,
  images: [{ src: `/file.svg?locale=${encodeURIComponent(locale)}`, alt: `TEST ONLY ${locale} image` }],
  usage: null,
  caution: null,
});

export const publishedSlug = "test-only-published-item";
export const draftSlug = "test-only-draft-item";
export const missingLocaleSlug = "test-only-missing-translation";
export const gallerySlug = "test-only-gallery";
export const textOnlySlug = "test-only-no-images";
const galleryContent = locale => ({ ...content(locale), name: `TEST ONLY ${locale} gallery item`, images: [
  { src: `/file.svg?gallery=1&locale=${locale}`, alt: `TEST ONLY ${locale} gallery first` },
  { src: `/test-only-missing-gallery.svg?locale=${locale}`, alt: `TEST ONLY ${locale} gallery second` },
  { src: `/file.svg?gallery=3&locale=${locale}`, alt: `TEST ONLY ${locale} gallery third` },
] });
export const publishedCatalogueFixtures = [
  {
    publicId: "12345678-abcd-1234-abcd-123456789abc",
    brand: "Round Lab", slug: publishedSlug, state: "published",
    translations: { en: content("en"), hu: content("hu"), ko: content("ko") },
  },
  {
    publicId: "22345678-abcd-1234-abcd-123456789abc",
    brand: "Round Lab", slug: draftSlug, state: "draft",
    translations: { en: content("draft"), hu: content("draft"), ko: content("draft") },
  },
  {
    publicId: "32345678-abcd-1234-abcd-123456789abc",
    brand: "beplain", slug: missingLocaleSlug, state: "published",
    translations: { en: content("en missing-locale fixture"), hu: null, ko: null },
  },
  {
    publicId: "62345678-abcd-1234-abcd-123456789abc", brand: "beplain", slug: gallerySlug, state: "published",
    translations: { en: galleryContent("en"), hu: galleryContent("hu"), ko: galleryContent("ko") },
  },
  {
    publicId: "72345678-abcd-1234-abcd-123456789abc", brand: "beplain", slug: textOnlySlug, state: "published",
    translations: Object.fromEntries(["en", "hu", "ko"].map(locale => [locale,
      { ...content(locale), name: `TEST ONLY ${locale} text-only item`, images: [] }])),
  },
];

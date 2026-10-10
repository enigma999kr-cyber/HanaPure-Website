// Synthetic editorial records only. Never imported by the production catalogue.
const content = (locale) => ({
  name: `TEST ONLY ${locale} published item`,
  description: `TEST ONLY ${locale} editorial fixture. Not a real product.`,
  images: [{ src: "/file.svg", alt: `TEST ONLY ${locale} image` }],
  usage: null,
  caution: null,
});

export const publishedSlug = "test-only-published-item";
export const draftSlug = "test-only-draft-item";
export const missingLocaleSlug = "test-only-missing-translation";
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
];

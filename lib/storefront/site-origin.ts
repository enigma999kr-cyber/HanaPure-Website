import "server-only";

/** Optional public, non-secret origin. Set only after the site's domain is approved.
 * No host-header, provider-env or speculative production-domain fallback.
 * Static pages capture this value at build time: rebuild after changing it.
 */
export function publicSiteOrigin(value = process.env.HANAPURE_PUBLIC_SITE_ORIGIN): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (!/^https:\/\/[^/?#]+\/?$/i.test(value) || value !== value.trim() || url.protocol !== "https:" || url.username || url.password ||
      url.pathname !== "/" || url.search || url.hash) throw new Error();
    return url.origin;
  } catch {
    throw new Error("Invalid HANAPURE_PUBLIC_SITE_ORIGIN: expected an HTTPS origin without credentials, path, query or fragment.");
  }
}

import type { EditorialLocale } from "../catalog/editorial-catalogue";

export const storefrontLocales = ["en", "hu", "ko"] as const satisfies readonly EditorialLocale[];
export function isStorefrontLocale(value: unknown): value is EditorialLocale {
  return storefrontLocales.some((locale) => locale === value);
}
export function localeFromPath(pathname: string): EditorialLocale | null {
  const segment = pathname.split("/")[1];
  return isStorefrontLocale(segment) ? segment : null;
}
/** null retains the existing unprefixed English URLs. */
export function storefrontHref(path: string, locale: EditorialLocale | null): string {
  return locale === null ? path : `/${locale}${path === "/" ? "" : path}`;
}
/** Only existing storefront destinations are carried across; slugs never change. */
export function switchLocalePath(path: string, locale: EditorialLocale): string {
  const [pathname] = path.split(/[?#]/);
  const suffix = path.slice(pathname.length);
  const current = localeFromPath(pathname);
  const destination = current ? pathname.slice(current.length + 1) || "/" : pathname;
  if (!/^\/(?:brands\/?|products(?:\/[a-z0-9]+(?:-[a-z0-9]+)*)?\/?)?$/.test(destination)) {
    return storefrontHref("/", locale);
  }
  return storefrontHref(destination.replace(/\/$/, "") || "/", locale) + suffix;
}

export const storefrontLabels = {
  en: {
    home: "Home", shop: "Shop", brands: "Brands", language: "Language",
    openMenu: "Open menu", closeMenu: "Close menu", navigation: "Mobile navigation",
    skipContent: "Skip to content", primaryNavigation: "Main navigation",
    heading: "Shop Korean skincare", empty: "No products to browse yet",
    emptyDescription: "Explore our brands while our catalogue is being prepared.",
    exploreBrands: "Explore brands", details: "Product details", back: "Back to products",
    missing: "English product content is not available yet.", usage: "How to use", caution: "Cautions",
    notFound: "Product page not found", notFoundDescription: "This product page is not available.",
    search: "Search", searchProducts: "Search products", searchHint: "Product name, description or brand",
    filterBrand: "Brand", allBrands: "All brands", apply: "Apply", clear: "Clear search and filters",
    results: "Results", noResults: "No matching products", noResultsDescription: "Try another search or clear the filters.",
    invalidBrand: "Unknown brand selection",
  },
  hu: {
    home: "Kezdőlap", shop: "Termékek", brands: "Márkák", language: "Nyelv",
    openMenu: "Menü megnyitása", closeMenu: "Menü bezárása", navigation: "Mobil navigáció",
    skipContent: "Ugrás a tartalomra", primaryNavigation: "Fő navigáció",
    heading: "Koreai bőrápolási termékek", empty: "Nincs még böngészhető termék",
    emptyDescription: "Fedezze fel márkáinkat, amíg katalógusunk készül.",
    exploreBrands: "Márkák felfedezése", details: "Termékadatok", back: "Vissza a termékekhez",
    missing: "A termék magyar nyelvű tartalma még nem érhető el.", usage: "Használat", caution: "Figyelmeztetések",
    notFound: "A termékoldal nem található", notFoundDescription: "Ez a termékoldal nem érhető el.",
    search: "Keresés", searchProducts: "Termékek keresése", searchHint: "Terméknév, leírás vagy márka",
    filterBrand: "Márka", allBrands: "Minden márka", apply: "Alkalmazás", clear: "Keresés és szűrők törlése",
    results: "Találatok", noResults: "Nincs megfelelő termék", noResultsDescription: "Próbáljon más keresést, vagy törölje a szűrőket.",
    invalidBrand: "Ismeretlen márkaválasztás",
  },
  ko: {
    home: "홈", shop: "상품", brands: "브랜드", language: "언어",
    openMenu: "메뉴 열기", closeMenu: "메뉴 닫기", navigation: "모바일 탐색",
    skipContent: "본문으로 건너뛰기", primaryNavigation: "주 탐색",
    heading: "한국 스킨케어 상품", empty: "아직 둘러볼 상품이 없습니다",
    emptyDescription: "상품 카탈로그를 준비하는 동안 브랜드를 둘러보세요.",
    exploreBrands: "브랜드 둘러보기", details: "상품 정보", back: "상품 목록으로",
    missing: "이 상품의 한국어 콘텐츠가 아직 없습니다.", usage: "사용 방법", caution: "주의사항",
    notFound: "상품 페이지를 찾을 수 없습니다", notFoundDescription: "이 상품 페이지는 제공되지 않습니다.",
    search: "검색", searchProducts: "상품 검색", searchHint: "상품명, 설명 또는 브랜드",
    filterBrand: "브랜드", allBrands: "모든 브랜드", apply: "적용", clear: "검색 및 필터 초기화",
    results: "검색 결과", noResults: "조건에 맞는 상품이 없습니다", noResultsDescription: "다른 검색어를 입력하거나 필터를 초기화하세요.",
    invalidBrand: "알 수 없는 브랜드 선택",
  },
} as const;

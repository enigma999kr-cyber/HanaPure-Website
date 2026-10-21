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
  let suffix = path.slice(pathname.length);
  const current = localeFromPath(pathname);
  if (current !== locale && suffix.startsWith("?")) {
    const hashIndex = suffix.indexOf("#"), hash = hashIndex < 0 ? "" : suffix.slice(hashIndex);
    const params = new URLSearchParams(hashIndex < 0 ? suffix : suffix.slice(0, hashIndex));
    if (params.has("pickFirst")) {
      params.delete("pickFirst");
      suffix = (params.size ? `?${params}` : "") + hash;
    }
  }
  const destination = current ? pathname.slice(current.length + 1) || "/" : pathname;
  if (!/^\/(?:cart\/?|brands\/?|products(?:\/[a-z0-9]+(?:-[a-z0-9]+)*)?\/?)?$/.test(destination)) {
    return storefrontHref("/", locale);
  }
  return storefrontHref(destination.replace(/\/$/, "") || "/", locale) + suffix;
}

export const storefrontLabels = {
  en: {
    informationFilters: "Information in this language", withLocaleInfo: "Only products with information in this language", withLocaleImage: "Only products with images in this language",
    visibleResults: "Visible results", resultPage: "Page", resultPages: "Result pages", previousPage: "Previous page", nextPage: "Next page",
    crossPageComparison: "Choose products across result pages", firstResultSelected: "First product selected", cancelFirstResult: "Cancel first product selection",
    chooseFirstResult: "Choose first product across pages", chooseSecondResult: "Compare with the selected first product",
    selectResultComparison: "Select for comparison", compareSelectedResults: "Compare two selected results", resultComparisonCount: "Selected results for comparison",
    matchingNavigation: "Matching product navigation", previousMatch: "Previous matching product", nextMatch: "Next matching product", compareRelated: "Compare with this product",
    gallery: "Product images", inspectImage: "Inspect image", closeImage: "Close image inspection", previousImage: "Previous image", nextImage: "Next image",
    home: "Home", shop: "Shop", brands: "Brands", language: "Language",
    openMenu: "Open menu", closeMenu: "Close menu", navigation: "Mobile navigation",
    skipContent: "Skip to content", primaryNavigation: "Main navigation",
    heading: "Shop Korean skincare", empty: "No products to browse yet",
    emptyDescription: "Explore our brands while our catalogue is being prepared.",
    exploreBrands: "Explore brands", details: "Product details", back: "Back to products",
    missing: "English product content is not available yet.", usage: "How to use", caution: "Cautions",
    detailNavigation: "Product information navigation", description: "Description", detailSelection: "Quantity and cart selection", compareAnother: "Compare with another product",
    notFound: "Product page not found", notFoundDescription: "This product page is not available.",
    search: "Search", searchProducts: "Search products", searchHint: "Product name, description or brand",
    filterBrand: "Brand", allBrands: "All brands", apply: "Apply", clear: "Clear search and filters",
    results: "Results", noResults: "No matching products", noResultsDescription: "Try another search or clear the filters.",
    invalidBrand: "Unknown brand selection",
    quickBrands: "Browse by brand", activeFilters: "Applied search and filters", removeFilter: "Remove filter",
    copySearchLink: "Copy search link", searchLinkCopied: "Search link copied.", searchLinkFailed: "Could not copy this search link. Check clipboard access and try again.",
    sortBy: "Sort by", defaultOrder: "Default order", nameAscending: "Name A–Z", nameDescending: "Name Z–A",
  },
  hu: {
    informationFilters: "Információ ezen a nyelven", withLocaleInfo: "Csak az ezen a nyelven információval rendelkező termékek", withLocaleImage: "Csak az ezen a nyelven képpel rendelkező termékek",
    visibleResults: "Látható találatok", resultPage: "Oldal", resultPages: "Találati oldalak", previousPage: "Előző oldal", nextPage: "Következő oldal",
    crossPageComparison: "Termékek kiválasztása több találati oldalról", firstResultSelected: "Első termék kiválasztva", cancelFirstResult: "Első termék kiválasztásának törlése",
    chooseFirstResult: "Első termék kiválasztása többoldalas összehasonlításhoz", chooseSecondResult: "Összehasonlítás a kiválasztott első termékkel",
    selectResultComparison: "Kiválasztás összehasonlításhoz", compareSelectedResults: "Két kiválasztott találat összehasonlítása", resultComparisonCount: "Összehasonlításhoz kiválasztott találatok",
    matchingNavigation: "Navigáció a megfelelő termékek között", previousMatch: "Előző megfelelő termék", nextMatch: "Következő megfelelő termék", compareRelated: "Összehasonlítás ezzel a termékkel",
    gallery: "Termékképek", inspectImage: "Kép megtekintése nagyban", closeImage: "Nagyított kép bezárása", previousImage: "Előző kép", nextImage: "Következő kép",
    home: "Kezdőlap", shop: "Termékek", brands: "Márkák", language: "Nyelv",
    openMenu: "Menü megnyitása", closeMenu: "Menü bezárása", navigation: "Mobil navigáció",
    skipContent: "Ugrás a tartalomra", primaryNavigation: "Fő navigáció",
    heading: "Koreai bőrápolási termékek", empty: "Nincs még böngészhető termék",
    emptyDescription: "Fedezze fel márkáinkat, amíg katalógusunk készül.",
    exploreBrands: "Márkák felfedezése", details: "Termékadatok", back: "Vissza a termékekhez",
    missing: "A termék magyar nyelvű tartalma még nem érhető el.", usage: "Használat", caution: "Figyelmeztetések",
    detailNavigation: "Termékinformációs navigáció", description: "Leírás", detailSelection: "Mennyiség és kosárválasztás", compareAnother: "Összehasonlítás másik termékkel",
    notFound: "A termékoldal nem található", notFoundDescription: "Ez a termékoldal nem érhető el.",
    search: "Keresés", searchProducts: "Termékek keresése", searchHint: "Terméknév, leírás vagy márka",
    filterBrand: "Márka", allBrands: "Minden márka", apply: "Alkalmazás", clear: "Keresés és szűrők törlése",
    results: "Találatok", noResults: "Nincs megfelelő termék", noResultsDescription: "Próbáljon más keresést, vagy törölje a szűrőket.",
    invalidBrand: "Ismeretlen márkaválasztás",
    quickBrands: "Böngészés márka szerint", activeFilters: "Aktív keresés és szűrők", removeFilter: "Szűrő eltávolítása",
    copySearchLink: "Keresési hivatkozás másolása", searchLinkCopied: "Keresési hivatkozás másolva.", searchLinkFailed: "A keresési hivatkozás nem másolható. Ellenőrizze a vágólaphoz való hozzáférést, és próbálja újra.",
    sortBy: "Rendezés", defaultOrder: "Alapértelmezett sorrend", nameAscending: "Név A–Z", nameDescending: "Név Z–A",
  },
  ko: {
    informationFilters: "현재 언어의 정보", withLocaleInfo: "현재 언어의 정보가 있는 상품만", withLocaleImage: "현재 언어의 이미지가 있는 상품만",
    visibleResults: "표시된 검색 결과", resultPage: "페이지", resultPages: "검색 결과 페이지", previousPage: "이전 페이지", nextPage: "다음 페이지",
    crossPageComparison: "여러 검색 결과 페이지에서 비교 상품 선택", firstResultSelected: "선택한 첫 번째 상품", cancelFirstResult: "첫 번째 상품 선택 취소",
    chooseFirstResult: "페이지 간 비교의 첫 상품으로 선택", chooseSecondResult: "선택한 첫 번째 상품과 비교",
    selectResultComparison: "비교할 상품 선택", compareSelectedResults: "선택한 검색 결과 두 개 비교", resultComparisonCount: "비교할 검색 결과 선택 수",
    matchingNavigation: "조건에 맞는 상품 탐색", previousMatch: "조건에 맞는 이전 상품", nextMatch: "조건에 맞는 다음 상품", compareRelated: "이 상품과 비교",
    gallery: "상품 이미지", inspectImage: "이미지 크게 보기", closeImage: "확대 이미지 닫기", previousImage: "이전 이미지", nextImage: "다음 이미지",
    home: "홈", shop: "상품", brands: "브랜드", language: "언어",
    openMenu: "메뉴 열기", closeMenu: "메뉴 닫기", navigation: "모바일 탐색",
    skipContent: "본문으로 건너뛰기", primaryNavigation: "주 탐색",
    heading: "한국 스킨케어 상품", empty: "아직 둘러볼 상품이 없습니다",
    emptyDescription: "상품 카탈로그를 준비하는 동안 브랜드를 둘러보세요.",
    exploreBrands: "브랜드 둘러보기", details: "상품 정보", back: "상품 목록으로",
    missing: "이 상품의 한국어 콘텐츠가 아직 없습니다.", usage: "사용 방법", caution: "주의사항",
    detailNavigation: "상품 정보 바로가기", description: "상품 설명", detailSelection: "수량과 장바구니 선택", compareAnother: "다른 상품과 비교",
    notFound: "상품 페이지를 찾을 수 없습니다", notFoundDescription: "이 상품 페이지는 제공되지 않습니다.",
    search: "검색", searchProducts: "상품 검색", searchHint: "상품명, 설명 또는 브랜드",
    filterBrand: "브랜드", allBrands: "모든 브랜드", apply: "적용", clear: "검색 및 필터 초기화",
    results: "검색 결과", noResults: "조건에 맞는 상품이 없습니다", noResultsDescription: "다른 검색어를 입력하거나 필터를 초기화하세요.",
    invalidBrand: "알 수 없는 브랜드 선택",
    quickBrands: "브랜드별 둘러보기", activeFilters: "적용된 검색 및 필터", removeFilter: "조건 해제",
    copySearchLink: "검색 링크 복사", searchLinkCopied: "검색 링크를 복사했습니다.", searchLinkFailed: "검색 링크를 복사할 수 없습니다. 클립보드 접근 권한을 확인하고 다시 시도해 주세요.",
    sortBy: "정렬 기준", defaultOrder: "기본 순서", nameAscending: "이름 오름차순", nameDescending: "이름 내림차순",
  },
} as const;

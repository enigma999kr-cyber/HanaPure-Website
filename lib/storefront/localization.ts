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
    planAddCollection: "Add selected products to shopping plan", planAddPair: "Add these compared products to my shopping plan",
    planChanged: "The selection or context changed. Review it and try again. Nothing was added to the plan.",
    planCopy: "Copy shopping plan link", planCopied: "Shopping plan link copied. This temporary URL does not synchronize browser carts or accounts.", planCopyFailed: "The complete shopping plan link could not be copied.",
    planImpact: "Possible merge impact — not yet saved", planCurrent: "Current stored quantity", planAbsent: "Not in cart", planIncoming: "Quantity to add", planExpected: "Expected quantity after merge",
    planNewLines: "New lines", planExistingLines: "Existing lines", planImpactUnits: "Expected units in affected lines", planImpactUnsafe: "The merge impact cannot be checked safely. No result is confirmed.",
    planEditDraft: "Edit this draft as a shopping plan", planReviewSaved: "Review quantities confirmed as saved", planReviewHidden: "Some affected items are hidden by the current cart view. Reset the view to review them.",
    planHeading: "Personal shopping plan", planNotice: "A temporary URL-only plan, not an order. Prices, stock, acceptance and fulfilment are not confirmed. Adding or editing here does not change your browser cart.",
    planAdd: "Add to shopping plan", planSelect: "Select for shopping plan", planPageSelection: "Selected on this visible page", planAddSelected: "Add selected page items to plan",
    planLines: "Planned products", planUnits: "Planned units", planQuantity: "Planned quantity", planSet: "Set planned quantity",
    planEmpty: "Your shopping plan is empty. This is separate from your browser cart.", planUnchanged: "The plan is unchanged. Products already included keep their chosen quantity.",
    planInvalidQuantity: "Choose public page items or enter a positive safe whole-number planned quantity. The plan has not changed.",
    planLimit: "This action cannot keep the complete plan within 40 products and the URL limit. Nothing changed. Shorten the search or clear the plan.",
    planInvalid: "This plan cannot be reviewed safely against the current public catalogue. Discard it or request a fresh plan. Nothing was imported.",
    planRemove: "Remove from plan", planClear: "Clear plan only", planDiscard: "Discard invalid plan", planReviewCart: "Review this plan in my cart",
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
    planAddCollection: "Kiválasztott termékek hozzáadása a vásárlási tervhez", planAddPair: "Az összehasonlított termékek hozzáadása a vásárlási tervemhez",
    planChanged: "A kiválasztás vagy a környezet megváltozott. Ellenőrizze, és próbálja újra. Semmit sem adtunk a tervhez.",
    planCopy: "Vásárlási terv hivatkozásának másolása", planCopied: "A vásárlási terv hivatkozását másoltuk. Ez az ideiglenes URL nem szinkronizál kosarakat vagy fiókokat.", planCopyFailed: "A teljes vásárlási terv hivatkozását nem sikerült másolni.",
    planImpact: "Lehetséges összevonási hatás — még nincs mentve", planCurrent: "Jelenleg tárolt mennyiség", planAbsent: "Nincs a kosárban", planIncoming: "Hozzáadandó mennyiség", planExpected: "Várható mennyiség összevonás után",
    planNewLines: "Új tételek", planExistingLines: "Meglévő tételek", planImpactUnits: "Az érintett tételek várható összmennyisége", planImpactUnsafe: "Az összevonás hatása nem ellenőrizhető biztonságosan. Az eredmény nem megerősített.",
    planEditDraft: "Piszkozat szerkesztése vásárlási tervként", planReviewSaved: "A megerősítetten mentett mennyiségek áttekintése", planReviewHidden: "Néhány érintett tételt elrejt a kosár jelenlegi nézete. Áttekintésükhöz állítsa vissza a nézetet.",
    planHeading: "Személyes vásárlási terv", planNotice: "Ideiglenes, csak a hivatkozásban tárolt terv, nem rendelés. Az ár, készlet, elfogadás és teljesítés nem megerősített. Az itteni hozzáadás és szerkesztés nem módosítja a böngésző kosarát.",
    planAdd: "Hozzáadás a vásárlási tervhez", planSelect: "Kiválasztás a vásárlási tervhez", planPageSelection: "Kiválasztva ezen a látható oldalon", planAddSelected: "Kiválasztott oldaltételek hozzáadása a tervhez",
    planLines: "Tervezett termékek", planUnits: "Tervezett darabszám", planQuantity: "Tervezett mennyiség", planSet: "Tervezett mennyiség beállítása",
    planEmpty: "A vásárlási terv üres. Ez különbözik a böngésző kosarától.", planUnchanged: "A terv nem változott. A már szereplő termékek megtartják a választott mennyiséget.",
    planInvalidQuantity: "Válasszon nyilvános oldaltételeket, vagy adjon meg biztonságos pozitív egész mennyiséget. A terv nem változott.",
    planLimit: "A művelet nem tudja megtartani a teljes tervet a 40 termékes és hivatkozáshossz-korláton belül. Nem történt módosítás. Rövidítse a keresést, vagy törölje a tervet.",
    planInvalid: "A terv nem ellenőrizhető biztonságosan a jelenlegi nyilvános katalógus alapján. Vesse el, vagy kérjen friss tervet. Nem történt importálás.",
    planRemove: "Eltávolítás a tervből", planClear: "Csak a terv törlése", planDiscard: "Érvénytelen terv elvetése", planReviewCart: "A terv áttekintése a kosaramban",
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
    planAddCollection: "선택한 상품을 쇼핑 계획에 담기", planAddPair: "비교 중인 두 상품을 내 쇼핑 계획에 담기",
    planChanged: "선택 항목이나 탐색 상태가 바뀌었습니다. 확인 후 다시 시도해 주세요. 계획에 추가하지 않았습니다.",
    planCopy: "쇼핑 계획 링크 복사", planCopied: "쇼핑 계획 링크를 복사했습니다. 이 임시 URL은 브라우저 장바구니나 계정을 동기화하지 않습니다.", planCopyFailed: "전체 쇼핑 계획 링크를 복사하지 못했습니다.",
    planImpact: "예상 합치기 결과 — 아직 저장되지 않음", planCurrent: "현재 저장 수량", planAbsent: "장바구니에 없음", planIncoming: "추가할 수량", planExpected: "합친 후 예상 수량",
    planNewLines: "새 항목", planExistingLines: "기존 항목", planImpactUnits: "대상 항목의 예상 총수량", planImpactUnsafe: "합치기 결과를 안전하게 확인할 수 없습니다. 결과가 확정되지 않았습니다.",
    planEditDraft: "이 초안을 쇼핑 계획으로 편집", planReviewSaved: "저장이 확인된 수량 검토", planReviewHidden: "일부 대상 항목이 현재 장바구니 보기에서 숨겨져 있습니다. 보기를 초기화하여 검토해 주세요.",
    planHeading: "개인 쇼핑 계획", planNotice: "URL에만 담긴 임시 계획이며 주문이 아닙니다. 가격, 재고, 주문 접수와 이행은 확정되지 않았습니다. 여기서 추가하거나 편집해도 브라우저 장바구니는 변경되지 않습니다.",
    planAdd: "쇼핑 계획에 추가", planSelect: "쇼핑 계획용 선택", planPageSelection: "현재 표시된 페이지에서 선택", planAddSelected: "선택한 페이지 상품을 계획에 추가",
    planLines: "계획한 상품 종류 수", planUnits: "계획한 총 수량", planQuantity: "계획 수량", planSet: "계획 수량 설정",
    planEmpty: "쇼핑 계획이 비어 있습니다. 브라우저 장바구니와는 별개입니다.", planUnchanged: "계획이 변경되지 않았습니다. 이미 포함된 상품은 선택한 수량을 유지합니다.",
    planInvalidQuantity: "공개 페이지 상품을 선택하거나 안전한 양의 정수 수량을 입력해 주세요. 계획은 변경되지 않았습니다.",
    planLimit: "40개 상품 및 URL 길이 제한 안에서 전체 계획을 유지할 수 없어 변경하지 않았습니다. 검색어를 줄이거나 계획을 비워 주세요.",
    planInvalid: "현재 공개 카탈로그로 이 계획을 안전하게 검토할 수 없습니다. 계획을 버리거나 새 계획을 요청해 주세요. 가져온 항목은 없습니다.",
    planRemove: "계획에서 제거", planClear: "계획만 비우기", planDiscard: "잘못된 계획 버리기", planReviewCart: "이 계획을 장바구니에서 검토",
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

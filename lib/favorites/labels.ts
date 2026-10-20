export const favoriteLabels = {
  en: {
    save: "Save product", remove: "Remove saved product", heading: "Saved products",
    empty: "No saved products from the current catalogue.", loading: "Loading saved products…",
    storage: "Saved products could not be stored or read in this browser. Your change was not saved.",
    invalid: "Saved product data could not be read. Reset it to save products again.",
    reset: "Reset saved products", limit: "You can save up to 100 products.",
  },
  hu: {
    save: "Termék mentése", remove: "Mentett termék eltávolítása", heading: "Mentett termékek",
    empty: "Nincs mentett termék a jelenlegi katalógusból.", loading: "Mentett termékek betöltése…",
    storage: "A mentett termékek nem tárolhatók vagy olvashatók ebben a böngészőben. A módosítás nem lett mentve.",
    invalid: "A mentett termékek adatai nem olvashatók. Új mentéshez állítsa alaphelyzetbe őket.",
    reset: "Mentett termékek alaphelyzetbe állítása", limit: "Legfeljebb 100 terméket menthet.",
  },
  ko: {
    save: "상품 저장", remove: "저장한 상품 해제", heading: "저장한 상품",
    empty: "현재 카탈로그에 저장한 상품이 없습니다.", loading: "저장한 상품을 불러오는 중…",
    storage: "이 브라우저에서 저장한 상품을 읽거나 보관할 수 없습니다. 변경사항이 저장되지 않았습니다.",
    invalid: "저장한 상품 데이터를 읽을 수 없습니다. 다시 저장하려면 초기화해 주세요.",
    reset: "저장한 상품 초기화", limit: "최대 100개 상품을 저장할 수 있습니다.",
  },
} as const;

# HanaPure Website completion checklist

이 문서는 실제 제품 완성도와 출시 준비 상태를 기록한다. `MASTER_PLAN.md`은 향후 방향을 다루고, 이 체크리스트는 현재 구현과 고객 흐름의 준비 상태를 다룬다. 실제 tracked code와 Git history가 구현 상태의 최우선 source of truth다. 주요 milestone 이후 또는 Progress Audit 때 갱신한다.

기준: 2026-09-29, `main`의 `b201fca` (`feat: add searchable brand directory`). 작성 시작 전 작업 트리는 깨끗했다. `HANDOFF`와 `MASTER_PLAN`에는 이 커밋 이전의 Brands 상태가 남아 있으므로 아래 Brands 항목은 현재 코드와 직전 구현 검증 결과를 따른다. 직전 구현 작업에서 lint, production build, TypeScript 빌드 단계, `/brands`의 목록·검색·글자 필터·검색 결과 없음 상태를 확인했다. 이번 문서 작업에서는 기능 테스트를 다시 실행하지 않았다.

상태: `[x]` 동작 확인된 완료 · `[~]` 부분 구현 또는 일부 범위만 확인 · `[ ]` 미구현/미검증 · `[TBD]` 범위나 방식의 결정이 필요함. 페이지나 컴포넌트가 존재한다는 이유만으로 고객 흐름 전체를 완료 처리하지 않는다.

## 1. Project Foundation

- [x] Next.js 16.2.10 / React 19.2.4 / TypeScript / Tailwind CSS 4 기반: `package.json`, App Router 및 스타일 코드 확인.
- [~] Git / repository safety: `main`과 `origin/main`이 동기화되어 있고, `.gitignore`와 작업 규칙이 있다. 브랜치 보호 등 원격 저장소 설정은 확인하지 않았다.
- [~] AGENTS / HANDOFF / MASTER_PLAN 문서: 세 파일이 tracked되어 있다. HANDOFF와 MASTER_PLAN의 Brands 구현 상태 문구는 현재 코드보다 오래되었다.
- [x] build / lint 기반: npm 스크립트가 있고 직전 Brands 구현에서 두 명령이 통과했다.
- [~] environment/configuration readiness: `next.config.ts`, TypeScript, ESLint, PostCSS 설정은 존재한다. 운영 환경 변수와 배포 환경은 검증되지 않았다.

## 2. Design System / Brand

- [x] HanaPure white / warm-white / beige / dark 색상 체계: `app/globals.css` 토큰과 사용처 확인; `2ec3132`에서 pink 제거 완료.
- [~] Typography: Geist 변수를 로드하지만 `body`는 Arial/Helvetica를 지정한다. 최종 서체 결정과 일관성 확인이 필요하다.
- [~] Spacing / layout consistency: Container와 Tailwind 간격이 적용됐지만 전체 사이트 기준의 검토는 아직 없다.
- [~] Buttons / shared UI primitives: Button·Container가 존재한다. 버튼 변형은 있으나 Hero CTA는 동작하지 않는다.
- [~] Responsive design rules: Hero와 Brands에 반응형 클래스가 있다. 전역 모바일 UX 기준과 전 화면 검증은 미완료.
- [~] LP-reviewed brand direction: premium/minimal/warm 및 색상 방향이 문서와 코드에 반영됐다. 브랜드별 문구와 Featured Brands의 최종 역할은 LP 검토가 남았다.
- [ ] Starter/default branding 제거: 루트 metadata, favicon, README, `public/`의 기본 에셋이 남아 있다.

## 3. Global Layout / Navigation

- [~] Header: 홈페이지와 Brands 페이지에 표시되지만 다수의 컨트롤이 작동하지 않는다.
- [~] Desktop navigation: Brands만 `/brands`로 이동한다. 나머지 주요 메뉴는 `#` 링크다.
- [~] Mobile navigation: 햄버거 버튼은 있으나 메뉴가 열리지 않는다.
- [ ] Shop navigation: 레이블만 있고 하위 메뉴와 목적지가 없다.
- [~] Brands navigation: 데스크톱 헤더 링크가 `/brands`로 동작한다. 모바일 메뉴에서는 접근할 수 없다.
- [ ] Search entry: 헤더 Search 버튼은 비활성 상태다.
- [ ] Language switcher: EN 버튼은 비활성 상태다.
- [ ] Cart entry: Cart 버튼은 비활성 상태다.
- [ ] Footer: 컴포넌트와 출력이 없다.
- [~] Functional links and routes: `/`와 `/brands`만 구현됐다. Hero CTA 및 브랜드 카드 링크도 목적지가 없다.

## 4. Homepage

- [~] Hero: 문구와 레이아웃이 구현됐다. CTA는 기능이 없다.
- [~] Trust messaging: 세 가지 신뢰 문구가 보인다. 출시에 사용할 근거·표현 검토는 별도 필요.
- [~] Featured Brands: Round Lab, Anua, SKIN1004의 임시 카드가 있다. 상세 링크는 `#`이고 섹션 유지 여부는 미결정.
- [x] Why HanaPure: 제목, 설명, 세 카드가 홈페이지에 렌더링된다.
- [ ] Best Sellers: 섹션과 실제 상품 데이터가 없다.
- [ ] New Arrivals: 섹션과 실제 상품 데이터가 없다.
- [TBD] Other planned homepage sections: 추가 섹션의 우선순위와 구성은 Kimin·LP 결정 필요.
- [~] Responsive/mobile behavior: Hero 개선 커밋 `1df629e`와 반응형 클래스가 있다. 전체 모바일 QA는 미완료.
- [ ] CTA functionality: 두 Hero 버튼에 이동 또는 동작이 연결되지 않았다.

## 5. Brands

- [x] Exact approved/candidate brand data source: `data/brands.ts`에 지정된 철자의 16개 이름이 있다. 판매 확정 재고를 뜻하지 않는다.
- [x] `/brands` route: `app/brands/page.tsx`가 있고 production build에서 정적 경로로 생성됐다.
- [x] 16-brand directory: 실제 페이지에서 16개 이름 표시를 확인했다.
- [x] Alphabetical grouping: 이름을 정렬해 첫 글자별로 표시한다.
- [x] A–Z navigation: 첫 글자 버튼 필터가 동작하고 해당 글자 결과만 표시됨을 확인했다.
- [x] Brand-name search: 대소문자 구분 없는 이름 검색과 결과 수 갱신을 확인했다.
- [TBD] Brand detail pages: 필요 여부와 상품/브랜드 콘텐츠 범위가 결정되지 않았다.
- [ ] LP-reviewed customer-facing positioning copy: 디렉터리에는 브랜드명만 있으며 브랜드별 고객 문구는 아직 검토·추가되지 않았다.

## 6. Product Catalogue

- [ ] Product data model: 없음.
- [ ] Product listing: 없음.
- [ ] Product detail pages: 없음.
- [ ] Product images: 실제 상품 이미지 없음.
- [ ] Prices: 없음.
- [ ] Availability: 재고 또는 판매 가능 여부 없음.
- [ ] Product type filtering: 없음.
- [ ] Skin type filtering: 없음.
- [ ] Skin concern filtering: 없음.
- [ ] Brand filtering for products: 브랜드명 검색은 있으나 상품 필터는 없다.
- [ ] Sorting for products: 없음.
- [ ] Best Sellers: 없음.
- [ ] New Arrivals: 없음.
- [ ] Sets / Offers / Gift Ideas: 없음.

## 7. Search / Discovery

- [ ] Site search: 없음; 헤더 Search는 비활성.
- [ ] Product search: 상품 데이터와 검색 기능 모두 없음.
- [x] Brand search: `/brands`에서 이름 검색이 동작한다.
- [~] Empty state: Brands의 검색 결과 없음 안내만 있다. 다른 목록/데이터 상태는 없다.
- [~] No-results state: Brands 검색에는 구현됐고 동작을 확인했다. 사이트/상품 검색에는 없다.
- [TBD] Recommendations: 콘텐츠 기준과 구현 방식 결정 필요.
- [ ] Skin-concern discovery: 없음.

## 8. Cart / Commerce

- [ ] Cart: 없음; 헤더 레이블만 있다.
- [ ] Quantity update: 없음.
- [ ] Remove item: 없음.
- [ ] Price calculations: 없음.
- [ ] Checkout: 없음.
- [ ] Customer details: 주문 입력 흐름 없음.
- [ ] Delivery: 배송 옵션·요금·주소 입력 없음.
- [ ] Payment: 없음.
- [ ] Order confirmation: 없음.
- [TBD] Taxes / VAT handling: 판매 지역과 운영·세무 규칙의 확정 필요; 구현 없음.
- [ ] Commerce error handling: 결제/주문 흐름 자체가 없다.

## 9. Customer Account

- [ ] Sign-in: 없음.
- [ ] Registration: 없음.
- [ ] Profile: 없음.
- [ ] Wishlist: 없음.
- [ ] Browsing history: 없음.
- [ ] Order history: 없음.
- [ ] Order tracking: 없음.
- [ ] Returns: 고객 반품 흐름 없음.

## 10. Help / Customer Service

- [ ] Help Centre: 없음.
- [ ] Delivery information: 없음.
- [ ] Returns / exchange: 없음.
- [ ] Payment information: 없음.
- [ ] Account help: 없음.
- [ ] Contact/support: 없음.
- [ ] Terms and conditions: 없음.
- [ ] Privacy / legal information: 없음.

## 11. Multilingual

- [~] English: 현재 두 페이지의 표시 문구는 영어다. 번역 관리·전 콘텐츠 검토는 없다.
- [ ] Hungarian: 없음.
- [ ] Korean: 없음.
- [ ] Locale routing: 없음.
- [ ] Language switcher: EN 버튼은 기능이 없다.
- [ ] Translated navigation: 없음.
- [ ] Translated product content: 상품 콘텐츠 자체가 없다.
- [ ] Translated metadata: 없음.
- [ ] Long-text layout testing, especially Hungarian: 수행 근거 없음.

## 12. SEO / Metadata

- [~] HanaPure page title / description: Brands 페이지 metadata는 HanaPure 문구다. 루트 metadata는 여전히 `Create Next App`이다.
- [ ] Favicon / branding assets: starter favicon과 기본 `public/` SVG를 대체하지 않았다.
- [~] Per-page metadata: `/brands`에만 고유 metadata가 있다.
- [ ] Canonical URLs: 없음.
- [ ] Open Graph: 없음.
- [ ] Sitemap: 없음.
- [ ] robots.txt: 없음.
- [TBD] Structured data where appropriate: 적용 대상과 상품 데이터 확정 필요.
- [ ] Product SEO: 상품 페이지가 없다.
- [ ] Multilingual SEO: locale 구현이 없다.

## 13. Mobile / Accessibility / UX

- [~] Responsive layouts: 일부 반응형 클래스가 있다. 전 경로의 모바일 QA는 미완료.
- [~] Mobile navigation: 메뉴 버튼만 있고 기능은 없다.
- [~] Touch targets: Brands 글자 필터는 최소 높이 클래스를 사용한다. 전체 사이트 검토는 없다.
- [~] Keyboard navigation: Brands 검색·글자 필터의 기본 입력 동작은 확인했다. 사이트 전체 키보드 점검은 없다.
- [~] Semantic structure: 제목, `main`, 목록, 검색 레이블이 일부 적용됐다. 전체 구조 검토는 없다.
- [~] Accessible labels: Brands 검색과 모바일 메뉴 버튼 등에 있다. 모든 컨트롤의 접근성 점검은 없다.
- [~] Focus states: Brands 검색과 글자 버튼에는 명시적 스타일이 있다. 전역 일관성은 미검증.
- [TBD] Image alt text: 실제 브랜드/상품 이미지 도입 시 기준과 검증 필요.
- [ ] Loading states: 고객 흐름용 상태가 없다.
- [~] Empty states: Brands 검색 결과 없음 상태만 있다.
- [ ] Error states: 고객 흐름용 오류 UI가 없다.

## 14. Performance / Technical Quality

- [x] Production build: 직전 Brands 구현에서 `npm run build` 통과, `/`·`/brands` 정적 경로 생성 확인.
- [x] Lint: 직전 Brands 구현에서 `npm run lint` 통과.
- [x] TypeScript health: 같은 production build의 TypeScript 단계 통과. 별도 전체 품질 보증을 뜻하지 않는다.
- [TBD] Image optimization: 실제 상품 이미지 소스와 정책 미결정.
- [ ] Performance review: 실제 기기/네트워크 성능 점검 근거 없음.
- [ ] Bundle/dependency review: 별도 검토 근거 없음.
- [ ] Error handling: 상거래와 데이터 흐름에 대한 처리 없음.
- [TBD] Monitoring/logging strategy: 운영 방식 결정 필요.

## 15. ERP Integration

- [TBD] Product ownership/source of truth: 웹사이트와 ERP의 데이터 소유권 미결정.
- [TBD] Inventory synchronization: 연동 범위·시점 미결정, 구현 없음.
- [TBD] Pricing synchronization: 연동 범위·시점 미결정, 구현 없음.
- [TBD] Order transfer: 연동 방식 미결정, 구현 없음.
- [TBD] Fulfillment status: 연동 방식 미결정, 구현 없음.
- [TBD] Failure/retry handling: 연동 설계 전.
- [TBD] Authentication/access controls: 연동 설계 전.
- [ ] Integration testing: 연결 구현이 없어 수행하지 않았다.

## 16. B2B / Future Expansion

- [TBD] B2B ordering: 향후 가능성; 범위·시점 미결정.
- [TBD] Wholesale pricing: B2B 운영 모델 미결정.
- [TBD] Bulk orders: B2B 운영 모델 미결정.
- [TBD] Wider EU expansion: 헝가리 이후 시장·시점 미결정.
- [TBD] Future AI Skin Advisor: 아이디어 단계.
- [TBD] Routine Builder: 아이디어 단계.
- [TBD] My Skin Profile: 아이디어 단계.

## 17. Launch Readiness

- [ ] All critical customer flows work: 상품 선택부터 결제·주문 확인까지 연결된 흐름이 없다.
- [ ] Desktop QA: Brands의 제한적 브라우저 확인은 있었으나 데스크톱 전체 화면과 고객 흐름 QA는 수행하지 않았다.
- [ ] Mobile QA: Hero 개선 커밋과 반응형 코드는 있으나 실제 모바일 고객 흐름 QA는 수행하지 않았다.
- [ ] Multilingual QA: 번역·locale 기능이 없다.
- [ ] Checkout QA: checkout 기능이 없다.
- [ ] Legal/compliance content: 이용약관·개인정보·배송·반품 콘텐츠가 없다.
- [ ] Production deployment: 배포 확인 근거 없음.
- [TBD] Analytics: 도구와 측정 목표 미결정.
- [TBD] Backups / recovery: 운영 데이터와 복구 방식 미결정.
- [TBD] Monitoring: 운영 체계 미결정.
- [TBD] Rollback plan: 배포 방식과 복구 절차 미결정.

## Status summary

### Completed

- Next.js/React/TypeScript/Tailwind 기반과 직전 lint/build/TypeScript 검증.
- 완료된 HanaPure 색상 체계와 홈페이지의 Why HanaPure 표시.
- `/brands` 경로, 정확한 16개 이름, 정렬된 그룹, A–Z 필터, 이름 검색.

### Partially completed

- Git 작업 규칙과 핵심 문서는 있으나 원격 보호 설정은 미확인이고 일부 문서의 Brands 상태는 오래되었다.
- 헤더·데스크톱 이동·홈페이지 Hero/Featured Brands·반응형 UI: 표시 요소는 있으나 다수의 이동과 CTA가 작동하지 않는다.
- 서체·레이아웃·접근성·SEO: 일부 요소만 적용되거나 제한적으로 확인됐다.
- 영어 콘텐츠와 Brands의 검색 결과 없음 상태는 있으나 사이트 전체 범위는 아니다.

### Not started

- 실제 상품 데이터와 목록/상세, 사이트·상품 검색, 장바구니와 주문/결제, 계정, 고객 지원, 헝가리어·한국어, 배포와 데스크톱·모바일을 포함한 전체 출시 QA.

### TBD

- 브랜드 상세 페이지, 홈페이지 추가 섹션, 추천 방식, 세금/VAT 규칙, ERP 데이터 소유권·연동 범위, B2B/유럽 확대, 운영 모니터링·복구 방식.

### Current launch-blocking items

1. 실제 판매 상품, 가격, 재고, 이미지와 상품 상세가 없다.
2. 장바구니부터 결제·주문 확인까지의 고객 거래 흐름이 없다.
3. 모바일 메뉴와 핵심 내비게이션/CTA가 기능하지 않아 고객이 사이트를 완주할 수 없다.
4. 배송·반품·결제 안내, 이용약관·개인정보 등 고객 운영 및 법적 콘텐츠가 없다.
5. 헝가리 출시를 위한 언어·결제/세금·배송 운영 검증과 전체 QA/배포 준비가 없다.

### Recommended next 5 implementation priorities

1. Kimin·LP와 출시 범위, 실제 상품 데이터 소유권, 브랜드 후보의 판매 가능 여부를 확정한다.
2. 모바일 메뉴와 핵심 경로·CTA를 실제 목적지에 연결하고, 상품 탐색 경로를 정리한다.
3. 상품 모델·목록·상세와 가격·재고·이미지를 구현한다.
4. 장바구니·checkout·배송·결제·주문 확인 흐름을 구축하고 운영 규칙을 검증한다.
5. 헝가리어 및 필수 고객/법적 콘텐츠를 준비한 뒤 접근성·모바일·구매·배포 QA를 완료한다.

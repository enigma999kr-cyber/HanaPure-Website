# Homepage & Brands Body Localization v1 — Implementation Report

Date: 2026-10-06. Destination: W.HanaPure WEB Command Center.
Status: technical implementation and validation complete; HU/KO editorial review pending. No milestone closure/LP acceptance is claimed.

## Verified baseline and Git boundary

Repository: C:/Users/Enigma/hanapure-shop. Branch main.
At preflight HEAD == origin/main == ac5f26e14b851a042ba599aeab7c1959d8b937b7, ahead/behind 0/0, tracked clean, staged none.
HEAD remains unchanged. No stage, commit, push, dependency change or next milestone started.

Protected file: docs/HanaPure_Website_Secure_Connectivity_Readiness_Audit.md.
Untouched / untracked / unstaged / uncommitted. SHA-256 unchanged:
D78599C5D11F7068C3F9B64211BF7505BE5521E1AD7B988458CC5F935BAAB02C.

## Implemented behavior

- Legacy / and /brands retain English body and existing controls.
- /en, /hu, /ko Home/Brands now render their respective body language, including Hero, Featured Brands, Why HanaPure, Brands introduction and directory labels/count/no-results text.
- Shared server body components receive the validated existing locale; no new i18n framework. BrandDirectory receives only the selected serializable directory strings from the server; its query/letter/filter/grouping logic is unchanged.
- Existing English strings were moved to a typed marketing dictionary; HU/KO translations use their meaning conservatively. EN strings are existing copy, not new marketing assertions. Proper brand names remain unchanged; data/brands.ts remains the 16-brand authority.
- Existing section order, classes and navigation targets remain. A single word-wrapping utility on the directory All button fixes the translated Hungarian label clipping at 320px without changing its grid or behavior.
- Minimal SEO adjustment advertises the actual translated Home/Brands bodies with matching descriptions, own-locale canonical URLs, reciprocal EN/HU/KO alternates and sitemap entries. Legacy routes remain noindex; absent public origin remains fail-closed/noindex with empty sitemap/disallow-all robots.
- Catalogue publication rules, locale-independent slug, ERP publicId and price/stock/readiness authority, existing auth/staging core are unchanged.
- Home CTA buttons remain unwired and Featured Brand links remain #, as explicitly excluded. No real product content or new commercial policy was added.

## Exact changed files

12 existing files modified:

- `app/[locale]/brands/page.tsx`
- `app/[locale]/page.tsx`
- `app/brands/page.tsx`
- `app/page.tsx`
- `components/brands/BrandCard.tsx`
- `components/brands/BrandDirectory.tsx`
- `components/brands/FeaturedBrands.tsx`
- `components/home/Hero.tsx`
- `components/home/WhyHanaPure.tsx`
- `lib/storefront/seo.ts`
- `tests/catalogue-storefront.test.mjs`
- `tests/storefront-seo.test.mjs`

5 new files (includes this requested final Markdown report):

- `components/brands/BrandsContent.tsx`
- `components/home/HomeContent.tsx`
- `docs/HanaPure_Website_Home_Brands_Localization_v1_Report.md`
- `lib/storefront/marketing-copy.ts`
- `tests/marketing-localization.test.mjs`

The pre-existing protected audit is not a changed file. AGENTS.md, MASTER_PLAN.md, handoff, COMPLETION_CHECKLIST.md, package files, Header, catalogue/ERP/auth/staging core are unchanged.

## Validation results

- Focused and directly relevant tests: 52/52 PASS across marketing-localization, catalogue-storefront, catalogue-discovery, editorial-catalogue, storefront-localization and storefront-seo.
- New tests render actual Home/Brands routes and real BrandDirectory initial state using the installed TypeScript/React SSR conventions. Header browser pathname hooks are excluded from that SSR body test; unchanged Header switching is covered by existing regression and actual browser verification.
- Legacy English body matches /en output; selected-language body/labels, exact 16 brands, count patterns, invalid locale, publication/slug and translated SEO availability/absent-origin guards pass.
- Production browser: HU A filter returns Abib/Anua/AXIS-Y (3); All restores selection; case-insensitive ROUND search returns Round Lab (1); no-results strings verified in EN/HU/KO; Header HU→KO→EN switching reaches matching Brands route/body.
- HU Home and Brands at 320/375/768/1024/1280px: document widths respectively 305/360/753/1009/1265 (vertical scrollbar accounted for), no horizontal overflow. 320px and 1280px screenshots inspected. Final 320px Mind button client/scroll width both 27 and client/scroll height both 40; full label wraps.
- TypeScript: npx tsc --noEmit --incremental false PASS.
- Lint: npm run lint PASS, final run with no warnings/errors.
- Production build: npm run build PASS, Next.js 16.3.8, existing route set retained.
- git diff --check PASS.
- No unrelated ERP/provider historical suites rerun; no new testing framework.
- Build/local server first hit sandbox Windows SWC path-access denial; authorized permission retry succeeded. Existing MODULE_TYPELESS_PACKAGE_JSON and LF/CRLF notices were nonfailing. No configuration changes were used to bypass them.
- Browser viewport override reset, temporary tabs closed, temporary production servers stopped.

## All introduced localized strings for LP editorial review

Every dictionary leaf is listed below with its existing English source and introduced HU/KO translation. {count} is the runtime count placeholder; array indexes preserve existing trust/point order. Brand names, A–Z letters and existing visual checkmark/arrow symbols are not translated.

| Key | EN source (reused) | HU translation (review pending) | KO translation (review pending) |
| --- | --- | --- | --- |
| `hero.eyebrow` | Trusted Korean Skincare | Megbízható koreai bőrápolás | 믿을 수 있는 한국 스킨케어 |
| `hero.heading` | Feel confident in your skin. | Érezze magát magabiztosan a bőrében. | 피부에 자신감을 느껴보세요. |
| `hero.description` | Starting in Hungary, growing across Europe — HanaPure carefully selects authentic Korean skincare with real skin benefits and trusted guidance. | Magyarországról indulva, Európában növekedve — a HanaPure gondosan válogatja az eredeti koreai bőrápolási termékeket, valódi bőrápolási előnyökkel és megbízható útmutatással. | 헝가리에서 시작해 유럽으로 성장하는 HanaPure는 실제 피부 관리 효과와 믿을 수 있는 안내를 바탕으로 정품 한국 스킨케어를 신중하게 선택합니다. |
| `hero.shop` | Shop Korean Skincare | Koreai bőrápolási termékek | 한국 스킨케어 쇼핑 |
| `hero.routine` | Discover Your Routine | Fedezze fel bőrápolási rutinját | 나의 스킨케어 루틴 알아보기 |
| `hero.trust.0` | Authentic Korean Brands | Eredeti koreai márkák | 정품 한국 브랜드 |
| `hero.trust.1` | Real Skincare Benefits | Valódi bőrápolási előnyök | 실제 피부 관리 효과 |
| `hero.trust.2` | Curated with Trust | Bizalommal válogatva | 신뢰를 바탕으로 한 선택 |
| `featured.eyebrow` | Featured Brands | Kiemelt márkák | 주목할 브랜드 |
| `featured.heading` | Carefully selected Korean skincare, | Gondosan válogatott koreai bőrápolás, | 신중하게 선택한 한국 스킨케어, |
| `featured.headingEnd` | trusted by our team. | csapatunk bizalmával. | 우리 팀이 신뢰합니다. |
| `featured.description` | Every brand inside HanaPure has been chosen because we genuinely believe in its quality, philosophy, and skincare benefits. | A HanaPure minden márkáját azért választottuk, mert őszintén hiszünk a minőségében, szemléletében és bőrápolási előnyeiben. | HanaPure의 모든 브랜드는 품질, 철학, 피부 관리 효과에 대한 진심 어린 믿음을 바탕으로 선택했습니다. |
| `featured.discover` | Discover Brand | Fedezze fel a márkát | 브랜드 알아보기 |
| `featured.roundLab.tagline` | Hydration Specialist | A hidratálás specialistája | 보습 전문가 |
| `featured.roundLab.description` | Gentle skincare inspired by clean Korean ingredients and daily hydration. | Gyengéd bőrápolás, amelyet tiszta koreai összetevők és a mindennapi hidratálás ihlettek. | 깨끗한 한국 원료와 일상적인 보습에서 영감을 받은 순한 스킨케어입니다. |
| `featured.anua.tagline` | Calm Daily Care | Nyugodt mindennapi ápolás | 편안한 데일리 케어 |
| `featured.anua.description` | Minimal formulas focused on soothing, balancing, and supporting sensitive skin. | Egyszerű formulák, amelyek az érzékeny bőr megnyugtatására, egyensúlyára és támogatására összpontosítanak. | 민감한 피부를 진정시키고 균형을 맞추며 돕는 데 중점을 둔 간결한 처방입니다. |
| `featured.skin1004.tagline` | Centella Expert | A Centella szakértője | 센텔라 전문가 |
| `featured.skin1004.description` | Known for calming skincare centered around Madagascar Centella. | A madagaszkári Centellára épülő, nyugtató bőrápolásáról ismert. | 마다가스카르 센텔라를 중심으로 한 진정 스킨케어로 알려져 있습니다. |
| `why.eyebrow` | Why HanaPure | Miért a HanaPure? | 왜 HanaPure인가요? |
| `why.heading` | A bridge between Korean skincare and European customers. | Híd a koreai bőrápolás és az európai vásárlók között. | 한국 스킨케어와 유럽 고객을 잇는 다리. |
| `why.description` | HanaPure combines Korean skincare knowledge with a customer-first perspective — helping you discover products that are authentic, effective, and carefully selected. | A HanaPure a koreai bőrápolási ismereteket vásárlóközpontú szemlélettel ötvözi — segítve az eredeti, hatékony és gondosan válogatott termékek felfedezését. | HanaPure는 한국 스킨케어 지식과 고객 우선의 관점을 결합하여 정품이며 효과적이고 신중하게 선택된 제품을 발견할 수 있도록 돕습니다. |
| `why.points.0.title` | Perspective | Szemlélet | 관점 |
| `why.points.0.description` | Created with a deep understanding of what skincare customers truly need. | A bőrápolási termékeket vásárlók valódi igényeinek mély megértésével jött létre. | 스킨케어 고객에게 진정으로 필요한 것을 깊이 이해하며 만들어졌습니다. |
| `why.points.1.title` | Korean Expertise | Koreai szakértelem | 한국 스킨케어 전문성 |
| `why.points.1.description` | Built on years of experience importing and selecting trusted Korean skincare for European customers. | Az európai vásárlóknak szánt, megbízható koreai bőrápolási termékek importjában és kiválasztásában szerzett többéves tapasztalatra épül. | 유럽 고객을 위해 믿을 수 있는 한국 스킨케어를 수입하고 선택해 온 다년간의 경험을 바탕으로 합니다. |
| `why.points.2.title` | Carefully Curated | Gondosan válogatva | 신중한 선택 |
| `why.points.2.description` | We believe quality is more valuable than quantity. Every product in HanaPure is carefully chosen because we genuinely trust it. | Hiszünk abban, hogy a minőség értékesebb a mennyiségnél. A HanaPure minden termékét gondosan választjuk ki, mert őszintén megbízunk benne. | 우리는 양보다 질이 더 가치 있다고 믿습니다. HanaPure의 모든 제품은 진심으로 신뢰하기에 신중하게 선택합니다. |
| `brands.eyebrow` | HanaPure directory | HanaPure márkajegyzék | HanaPure 브랜드 목록 |
| `brands.heading` | Explore our brands. | Fedezze fel márkáinkat. | 브랜드를 살펴보세요. |
| `brands.description` | A considered selection of Korean skincare names, gathered in one place for easy discovery. | Koreai bőrápolási márkák átgondolt válogatása, egy helyen a könnyű felfedezésért. | 한국 스킨케어 브랜드를 신중하게 모아 한곳에서 쉽게 살펴볼 수 있습니다. |
| `brands.seoDescription` | Explore Korean skincare brands in the HanaPure directory. | Fedezze fel a koreai bőrápolási márkákat a HanaPure márkajegyzékében. | HanaPure 브랜드 목록에서 한국 스킨케어 브랜드를 살펴보세요. |
| `directory.browse` | Browse brands | Márkák böngészése | 브랜드 둘러보기 |
| `directory.searchLabel` | Search by brand name | Keresés márkanév alapján | 브랜드 이름으로 검색 |
| `directory.searchPlaceholder` | Search brands | Márkák keresése | 브랜드 검색 |
| `directory.filterLabel` | Filter brands by first letter | Márkák szűrése kezdőbetű szerint | 첫 글자로 브랜드 필터링 |
| `directory.alphabet` | Browse A–Z | Böngészés A–Z | A–Z 둘러보기 |
| `directory.all` | All | Mind | 전체 |
| `directory.resultOne` | {count} brand found | {count} márka található | 브랜드 {count}개 찾음 |
| `directory.resultMany` | {count} brands found | {count} márka található | 브랜드 {count}개 찾음 |
| `directory.empty` | No brands found | Nem található márka | 브랜드를 찾을 수 없습니다 |
| `directory.emptyDescription` | Try another name or choose All to browse every brand. | Próbáljon másik nevet, vagy válassza a Mind lehetőséget az összes márka böngészéséhez. | 다른 이름으로 검색하거나 전체를 선택해 모든 브랜드를 살펴보세요. |

## Remaining editorial review

LP must review all HU/KO rows for tone, naturalness, skincare terminology and preservation of the English meaning. In particular review the confidence headline, trust phrases, existing “real benefits”/“effective”/“clean ingredients” wording, the three existing brand taglines/descriptions, and Hungarian form of address (“Érezze”/“Fedezze”).
Technical tests prove wiring/rendering, not truth/substantiation of existing claims, native-language approval, compliance or commercial launch readiness.
These are translations of existing copy; no new product/brand facts or routine capability is asserted by this milestone.
Production catalogue remains empty and excluded UI/business functions remain pending.

## Final working tree

```text
 M app/[locale]/brands/page.tsx
 M app/[locale]/page.tsx
 M app/brands/page.tsx
 M app/page.tsx
 M components/brands/BrandCard.tsx
 M components/brands/BrandDirectory.tsx
?? components/brands/BrandsContent.tsx
 M components/brands/FeaturedBrands.tsx
 M components/home/Hero.tsx
?? components/home/HomeContent.tsx
 M components/home/WhyHanaPure.tsx
?? docs/HanaPure_Website_Home_Brands_Localization_v1_Report.md
?? docs/HanaPure_Website_Secure_Connectivity_Readiness_Audit.md
?? lib/storefront/marketing-copy.ts
 M lib/storefront/seo.ts
 M tests/catalogue-storefront.test.mjs
?? tests/marketing-localization.test.mjs
 M tests/storefront-seo.test.mjs
```

Staged files: none. No stage/commit/push occurred.
Protected SHA-256 remains the expected value above.

READY FOR HANA PURE WEB COMMAND CENTER REVIEW — STOP

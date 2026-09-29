# HanaPure Website project handoff

## Purpose

This handoff is for continuing the HanaPure website project in a future ChatGPT/Codex session. It records current implementation separately from business direction and planned work.

## Status and source of truth

The website is intentionally paused while HanaPure ERP has higher development priority. Resume from the existing foundation rather than rebuilding it. This document reflects tracked implementation through commit `b201fca` (`feat: add searchable brand directory`, 2026-09-29); check the current code and Git history again when work resumes. Tracked code is authoritative for what is implemented. The business and brand direction below guides future work. See `MASTER_PLAN.md` for the roadmap, `COMPLETION_CHECKLIST.md` for launch readiness, and `../AGENTS.md` for permanent working rules.

Repository: `https://github.com/enigma999kr-cyber/HanaPure-Website.git` (`main`). The known local checkout is `C:\Users\Enigma\hanapure-shop`; verify the actual path and working tree at the start of a future session.

## Business, roles, and brand direction

HanaPure is a curated Korean skincare e-commerce business planned to launch first in Hungary, with possible later expansion in Europe. It aims to be premium, minimal, warm, trustworthy, and customer-first: a considered selection rather than an overwhelming catalogue.

- Kimin leads business, Korean sourcing, import, supply chain, operations, and ERP.
- Lilla Park (LP) is co-founder and brings the creative and customer-experience perspective, long-term Amazon experience, and strong knowledge of and interest in Korean skincare. She reviews important UX, brand presentation, and customer-facing decisions.
- ChatGPT/Codex supports technical architecture, implementation, maintainability, the UX system, and future ERP integration.

The existing mission line is “Helping people feel confident through carefully curated Korean skincare.” The earlier signature “Curated in Trust. Inspired by Korea. Created for Europe.” is a proposal, not a confirmed site element.

The brand story joins Kimin's Korean sourcing and European operations experience with LP's understanding of Hungarian/European customers and Korean skincare. HanaPure aims to bridge Korean skincare and European customers. Its guiding principle is to carefully select products that deserve customer trust rather than present an overwhelming catalogue.

## Implemented website architecture

- `package.json` pins Next.js `16.2.10`, React/React DOM `19.2.4`, with TypeScript, Tailwind CSS 4, and ESLint. The project uses the Next.js App Router.
- `app/layout.tsx` provides the root layout and font setup. `app/page.tsx` implements `/`, and `app/brands/page.tsx` implements `/brands`. There are no tracked API routes, product data layer, commerce backend, or other page routes.
- The homepage renders `Header`, `Hero`, `FeaturedBrands`, and `WhyHanaPure`, in that order. Shared components are `components/ui/Button.tsx` and `components/ui/Container.tsx`.
- `data/brands.ts` contains the exact 16 approved/candidate brand names listed below. `components/brands/BrandDirectory.tsx` sorts and groups them alphabetically, provides an A–Z first-letter filter and case-insensitive brand-name search, and displays a no-results state. Commit `b201fca` also connected the desktop Header's Brands link to `/brands`.
- `app/globals.css` defines the implemented HanaPure tokens: white, warm white, ivory, light/regular/deep beige, border, dark text, and muted text. Tailwind theme mappings expose them to components. Commit `2ec3132` applied this palette across the homepage and completed pink removal from the tracked palette.
- Commit `1df629e` improved the mobile hero layout before the color-system commit. Responsive classes exist in the current components, but this does not establish full mobile UX.

The Brands implementation passed lint and a production build, which generated both `/` and `/brands` as static routes. The directory's 16-name display, search, letter filter, and no-results state were also checked in the local browser during that implementation. These checks do not establish launch readiness for other customer flows.

## Current homepage and UX decisions

The hero uses “Trusted Korean Skincare” and “Feel confident in your skin.” Its body introduces HanaPure as starting in Hungary and growing across Europe, with authentic Korean skincare and trusted guidance. The visible buttons are “Shop Korean Skincare” and “Discover Your Routine”; its trust points are Authentic Korean Brands, Real Skincare Benefits, and Curated with Trust. `WhyHanaPure` presents “A bridge between Korean skincare and European customers.” with three cards: Perspective, Korean Expertise, and Carefully Curated. Preserve reviewed brand language unless Kimin and LP approve a change.

The current header displays Shop, Brands, Skin Concerns, Best Sellers, New Arrivals, and Why HanaPure; the right side displays Search, EN, and Cart. These labels reflect the current navigation direction. The desktop Brands link reaches `/brands`; the other desktop links still point to `#`. The right-side controls and the mobile hamburger have no implemented behavior. LP's planned Shop grouping includes product type, skin type, skin concerns, sets, offers, and gift ideas; no dropdown exists yet.

`FeaturedBrands` is a temporary three-card homepage section for Round Lab, Anua, and SKIN1004. Each uses a beige-toned gradient panel, descriptive copy, and a `Discover Brand` link pointing to `#`. The separate text-focused `/brands` directory is implemented, but its final relationship to this homepage preview has not been decided.

The approved visual direction is white/warm white as the main background, multiple beige tones for secondary areas, and black/dark text. Pink is excluded from the final palette. The existing CSS follows this palette. The implemented Brands directory is text-focused, alphabetical, searchable by brand name, and presented in white/beige styling. Brand detail pages remain undecided. Customer-first positioning copy has not been added and requires LP review; avoid exaggerated or miracle skincare claims.

LP wants a premium, minimal, warm presentation with more beige character while retaining generous white space; avoid a blank or generic feel. Earlier inspiration references were Apple for information hierarchy, Amazon for help and customer-service layout, Sephora for imagery and product search, and Olive Young Global for skincare discovery and education. These are references, not implemented features or instructions to copy another site.

Planned languages are English, Hungarian, and Korean. The current page is English, and `EN` is only a placeholder; localization is not implemented.

## Approved/candidate brands

Preserve these names exactly as supplied; inclusion in this list does not mean catalogue data or commercial availability has been implemented:

- beplain
- Round Lab
- Anua
- medicube
- Purito Seoul
- VT Cosmetics
- Abib
- AXIS-Y
- Centellian24
- numbuzin
- SKIN1004
- COSRX
- Dr. Althea
- Dr.G
- CELIMAX
- IUNIK

### Initial product interests

LP's initial product interests are planning input, not site data or confirmed inventory:

- beplain: cleansers; Round Lab: toner, sunscreen, lotion; Anua: serums, lotion; medicube: serums, lotion.
- Purito Seoul: serums, ceramide cream; VT Cosmetics: serums; Abib: eye patches, overnight masks; AXIS-Y: eye creams, lotions.
- Centellian24: serums, lotions; numbuzin: serums, toner pads; SKIN1004: serums, sunscreen; COSRX: snail serum line, ceramide mist, cream.
- Dr. Althea: creams, mists; Dr.G: sunscreen, lotion; CELIMAX: masks, toner pads, retinal; IUNIK: serums, creams.

## Unfinished areas and known inconsistencies

- The Brands directory has no brand detail pages or LP-reviewed brand positioning copy. The three homepage brand cards remain a separate temporary preview with `#` links; LP has not decided whether to retain them.
- No product catalogue, Best Sellers, New Arrivals, skin-concern navigation, routines, checkout, payments, accounts, order tracking, support centre, or ERP connection exists.
- Apart from the desktop Brands link, Header links and brand-card links are placeholders. Hero CTA buttons, Search, EN, Cart, and the mobile menu are inert.
- `app/layout.tsx` still exports `Create Next App` title and generated description. `README.md` is the uncustomized starter readme, `public/` contains default Next.js SVGs, and `app/favicon.ico` remains from the starter app.
- Geist font variables are loaded in `app/layout.tsx`, but `body` in `app/globals.css` explicitly uses Arial/Helvetica. Decide the intended typography before making visual changes.

Later planning includes product discovery by brand, type, skin type, and concern; Best Sellers and New Arrivals; sets, offers, gifts, seasonal and travel selections; skincare education and recommendations; accounts, wishlists, orders, and customer support. A skin profile, routine builder, AI advisor, B2B ordering, and ERP integration remain future possibilities. None are implemented in this website.

## Safe resumption

1. Confirm repository path, branch, status, tracked files, and recent commits. Read `AGENTS.md`, this handoff, and `MASTER_PLAN.md`; reconcile all plans with current code and follow the current task's authorization.
2. Keep the website and ERP in separate repositories. Review the installed Next.js documentation before application code changes.
3. When website work is prioritized again, review the existing `/brands` implementation rather than rebuilding it. Confirm with LP whether the three-card homepage section remains a curated preview, and prepare customer-first brand copy for her review. Decide whether brand detail pages are needed before planning them.
4. Work in small, reviewable steps with mobile behavior considered from the start. Verify each step and report what is implemented versus still planned. Follow `AGENTS.md` and the current task's authorization for Git operations; this handoff does not authorize pulling, committing, pushing, or changing branches.

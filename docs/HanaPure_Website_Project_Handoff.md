# HanaPure Website Project Handoff

## Purpose
This file is the authoritative handoff note for continuing the HanaPure website project in a new ChatGPT conversation using GPT-5.6 Sol.

## Project Identity
- Project: HanaPure Website
- Local project path: `C:\Users\Enigma\hanapure-shop`
- GitHub repository: `https://github.com/enigma999kr-cyber/HanaPure-Website.git`
- Main branch: `main`
- First saved foundation commit: `Initial HanaPure website foundation`
- Stack: Next.js App Router, TypeScript, Tailwind CSS
- Development environment used successfully: Node.js v24.18.0, npm 11.16.0, Git 2.55.0

## Collaboration / Roles
- Kimin: CEO / business & product direction. Korean entrepreneur with long experience importing and handling Korean products in Europe.
- Lilla Park (LP): Creative Director / UX / customer perspective. Hungarian/European, long-term Amazon employee, strong knowledge, experience, and attachment to Korean skincare.
- ChatGPT: technical architecture, development guidance, UX system design, SEO, scalability, future ERP integration, and objective review.

## Core Working Style
1. Proceed one technical step at a time.
2. Give exact file paths.
3. When a file needs modification, provide the COMPLETE replacement file, not partial snippets.
4. Kimin prefers to delete the old file contents and paste the complete replacement code.
5. After each step, Kimin normally sends a screenshot for review before proceeding.
6. Mobile responsiveness must be considered from the beginning, not added at the end.
7. LP reviews important visual/UX decisions; incorporate her feedback early.
8. Do not rush launch. Quality, maintainability, customer trust, and clear architecture take priority.
9. Keep the website and HanaPure ERP as separate repositories/projects, with future integration in mind.
10. Use Git regularly: `git add .` -> commit -> `git push`.

## Brand / Business Direction
HanaPure is intended to be a premium, curated Korean skincare platform starting in Hungary, with future European expansion.

### Mission
`Helping people feel confident through carefully curated Korean skincare.`

### Brand Story
HanaPure combines two complementary perspectives:
- Kimin understands Korea, Korean suppliers/products, import, distribution, and European business operations.
- LP understands Hungarian/European customers and Korean skincare from a passionate, knowledgeable user perspective.
- HanaPure acts as a bridge between Korean skincare innovation and European customers.

### Brand Principle
`We don't overwhelm you with thousands of products. We carefully select the ones that truly deserve your trust.`

### Proposed brand signature
`Curated in Trust. Inspired by Korea. Created for Europe.`

## Visual / UX Direction Agreed with LP
- Overall aesthetic: premium, minimal, warm, customer-first.
- Apple: aesthetic reference — minimalism, premium feeling, clean information hierarchy.
- Amazon: Help Centre / FAQ / customer-service layout inspiration.
- Sephora: product imagery and product-search inspiration.
- Olive Young Global: Korean skincare discovery, skin concern navigation, education.
- Do NOT make the site feel overly blank or generic.
- LP wants MORE beige character but also more white overall.
- Latest LP color decision:
  - White / warm white as main page background.
  - Multiple beige tones for secondary areas, cards, overlays, pop-up tables.
  - Black/dark text.
  - REMOVE pink from the website palette.
- Brand directory should be text-focused rather than image-heavy.
- LP wants the site to feel a little more premium than the current version.

## Languages
Planned languages:
- Hungarian
- English
- Korean

The site should be designed so multilingual support can be implemented cleanly later.

## Header / Navigation – Current Agreed Direction
Main navigation:
- Shop
- Brands
- Skin Concerns
- Best Sellers
- New Arrivals
- Why HanaPure

Right-side items currently shown:
- Search
- EN (placeholder for future language switcher)
- Cart

Mobile:
- Hamburger menu is already present in the Header structure.

### Shop dropdown planned by LP
- By Product Type
- By Skin Type
- By Skin Concerns
- Sets
- Offers
- Gift Ideas

## Current Homepage Components / State

### Existing project component structure
- `components/ui/Container.tsx`
- `components/ui/Button.tsx`
- `components/layout/Header.tsx`
- `components/home/Hero.tsx`
- `components/home/WhyHanaPure.tsx`
- `components/brands/BrandCard.tsx`
- `components/brands/FeaturedBrands.tsx`

### Current homepage assembly
`app/page.tsx` currently assembles:
- Header
- Hero
- FeaturedBrands
- WhyHanaPure

### Hero – current direction
Eyebrow:
`Trusted Korean Skincare`

Headline:
`Feel confident in your skin.`

Body:
`Starting in Hungary, growing across Europe — HanaPure carefully selects authentic Korean skincare with real skin benefits and trusted guidance.`

Buttons:
- Shop Korean Skincare
- Discover Your Routine

Trust points:
- Authentic Korean Brands
- Real Skincare Benefits
- Curated with Trust

### Why HanaPure – current approved copy
Card 1:
- Title: `Perspective`
- Copy: `Created with a deep understanding of what skincare customers truly need.`

Card 2:
- Title: `Korean Expertise`
- Copy: `Built on years of experience importing and selecting trusted Korean skincare for European customers.`

Card 3:
- Title: `Carefully Curated`
- Copy: `We believe quality is more valuable than quantity. Every product in HanaPure is carefully chosen because we genuinely trust it.`

Section heading:
`A bridge between Korean skincare and European customers.`

Section body:
`HanaPure combines Korean skincare knowledge with a customer-first perspective — helping you discover products that are authentic, effective, and carefully selected.`

## Current Featured Brands Implementation
The current homepage still has a temporary featured-card implementation showing only:
- Round Lab
- Anua
- Skin1004

Each card currently has a soft color/gradient area, text, and `Discover Brand →`.

IMPORTANT: This is NOT the final brand UX. LP's latest feedback changes the next direction.

## LP's Final Approved / Candidate Brand List
Use these names exactly as written:
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

## LP's Latest Brand Directory Requirements
This is the next important UX direction:
- Move from placeholder data to real brands.
- Brands should be TEXT-FOCUSED.
- Brands should be sorted alphabetically for easy finding.
- Add an alphabet navigation / grouping similar to a luxury beauty brand directory.
- Add a SEARCH FILTER that searches by brand name.
- The reference image LP shared is for alphabetical sorting UX only; use LP's own brand list above.
- Customer-first wording is preferred. ChatGPT should propose wording for each brand and LP will review it.
- Examples of customer-first phrasing:
  - Best for Dry Skin
  - Calms Sensitive Skin
  - Barrier Repair
  - Brightening
- Do not overstate benefits or use miracle claims.

## Known Product Interests from LP
These were supplied as initial product/category interests:
- beplain — cleansers
- Round Lab — toner, sunscreen, lotion
- Anua — serums, lotion
- medicube — serums, lotion
- Purito Seoul — serums, ceramide cream
- VT Cosmetics — serums
- Abib — eye patches, overnight masks
- AXIS-Y — eye creams, lotions
- Centellian24 — serums, lotions
- numbuzin — serums, toner pads
- SKIN1004 — serums, sunscreen
- COSRX — snail line (serum), ceramide mist, cream
- Dr. Althea — creams, mists
- Dr.G — sunscreen, lotion
- CELIMAX — masks, toner pads, retinal
- IUNIK — serums, creams

## Planned Customer / Site Features
From LP's planning:
- Customer profile
- Order tracking
- Wishlist / lists
- Browsing history
- Help Centre by topic
- Order & Returns
- Payment / charges
- Account / sign-in
- Services & Offers
- Terms & Conditions
- Delivery information
- Returns & Exchange
- Recommendations & skincare support
- New / trending ingredients
- Skin-concern guidance
- Skin goals
- Product navigation by brand, product type, skin type, skin concern
- Best Sellers
- New Arrivals
- Sets
- Offers
- Gift ideas by occasion / budget / category
- Seasonal picks
- Travel minis / travel sets
- Newsletter / educational content
- Instagram / Facebook / TikTok
- Influencer hauls

Future ideas:
- My Skin Profile
- Routine Builder
- AI Skin Advisor
- B2B ordering
- ERP integration

## Important Business Context
HanaPure is planned for Hungary first.
Kimin and LP may later expand further in Europe.
Kimin has long-term experience importing Korean goods into Europe.
LP has long-term Amazon experience and strong Korean-skincare expertise.
There is a potentially important online-commerce business meeting planned for August 2026; if successful, HanaPure may directly import and supply significant quantities to that buyer.
Future help will also be needed with suppliers, MOQ, direct import, EU cosmetics compliance, Responsible Person, CPSR, CPNP, PIF, labeling, logistics, and B2B supply planning.

## Development Pause / Priority Context
The website project was intentionally paused while HanaPure ERP receives higher priority.
When website development resumes, continue from this exact handoff rather than redesigning from scratch.

## Recommended Next Technical Step
Do NOT rebuild the completed foundation.
Start by reconciling the current `FeaturedBrands` implementation with LP's latest decision:
1. Define the final White / Beige / Black design tokens and remove remaining pink references.
2. Decide whether the homepage Featured Brands section remains as a small curated preview.
3. Build a separate text-focused Brand Directory / Brands page:
   - real 16-brand list
   - alphabetical sections
   - A–Z navigation/filter
   - brand-name search
   - premium white/beige presentation
4. Propose customer-first wording for each brand for LP review.
5. After LP approval, proceed to Best Sellers / New Arrivals / product data.

## Git / Safety
Repository:
`https://github.com/enigma999kr-cyber/HanaPure-Website.git`

Branch:
`main`

Before any new work:
- Run `git status`
- Run `git pull`
- Confirm the working tree is clean
- Make changes only after confirming the correct repository/project
- Commit and push after each stable milestone

## Instruction to the next ChatGPT session
Act as the technical architect/CTO for HanaPure. Preserve the decisions above. Do not casually replace LP-approved UX or brand language. When proposing a change, explain why and keep LP/Kimin review in the loop. Give Kimin complete replacement files with exact paths, one step at a time, and wait for his screenshot/test confirmation before moving to the next technical step.

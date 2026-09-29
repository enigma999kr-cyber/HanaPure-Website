# HanaPure Website master plan

This is a high-level roadmap, not a claim of implementation or a launch schedule. The website is paused while HanaPure ERP has higher priority. Reassess priorities with Kimin and LP when website work resumes. Tracked code and Git history determine implementation status; see `HanaPure_Website_Project_Handoff.md` for the current-state audit.

## Completed foundation

- Next.js 16 App Router, React 19, TypeScript, Tailwind CSS 4, and ESLint project foundation.
- One homepage route with Header, Hero, Featured Brands, and Why HanaPure components, plus shared Button and Container components.
- Responsive hero improvements (`1df629e`) and HanaPure white/warm-white/beige/dark color tokens applied to the current homepage (`2ec3132`). Pink removal from the tracked palette is complete.

These are visual and structural foundations; the current controls and links do not yet constitute functional shopping flows.

## Next website work, when resumed

- Confirm with LP whether the three-card Featured Brands homepage section remains a curated preview.
- Build a separate, text-focused Brands directory from the exact 16-brand list in the handoff, with alphabetical groups/navigation and brand-name search. Use the established white/beige palette and review customer-first positioning copy with LP before treating it as approved.
- Replace placeholder navigation and calls to action as corresponding destinations become real. Review mobile menu behavior, accessibility, metadata, starter assets, and typography as part of scoped work.
- Establish maintainable product/brand content ownership before adding larger catalogue features. Do not treat candidate brands or product interests as confirmed inventory.

## Later catalogue and commerce functionality

- Product catalogue and product detail pages; browsing by brand, product type, skin type, and skin concern; Best Sellers, New Arrivals, sets, offers, gifts, seasonal picks, and travel sizes where supported by real products.
- Cart, checkout, payments, delivery, returns, order lifecycle, and customer communications. Define commerce platform, operational rules, and data ownership before implementation.
- Recommendations, skin-goal guidance, educational content, newsletter, and social content can follow validated customer needs and available content. Avoid unsupported skincare claims.

## Multilingual work

- Plan English, Hungarian, and Korean content structure, routing, translation ownership, and review process.
- Implement locale-aware navigation, product/customer content, and SEO when the content and operational scope are ready. The current `EN` label is only a placeholder.

## Account and support functionality

- Customer sign-in/profile, wishlists/lists, browsing history, and order tracking after the commerce and privacy requirements are defined.
- Help Centre by topic, order/returns guidance, payment/charges, delivery, terms, services/offers, and contact paths aligned with actual operations.
- A skin profile, routine builder, or AI advisor remains exploratory, not committed functionality.

## ERP integration

- Keep ERP and website development separate. When both systems are ready, define interfaces for product, inventory, pricing, orders, and fulfillment; agree ownership, synchronization, failure handling, and access controls before implementation.
- The ERP's current higher priority does not imply that integration has begun.

## B2B possibilities

- Evaluate direct import and wholesale/B2B ordering only when business requirements and supplier arrangements are confirmed.
- Regulatory, labeling, logistics, and supply obligations require dedicated business and specialist review before any B2B or wider European launch commitments.

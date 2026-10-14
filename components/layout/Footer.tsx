import Link from "next/link";
import Container from "@/components/ui/Container";
import type { EditorialLocale } from "@/lib/catalog/editorial-catalogue";
import { storefrontHref, storefrontLabels } from "@/lib/storefront/localization";
import { cartLabels } from "@/lib/cart/labels";

export default function Footer({ locale = "en", routeLocale = null }: {
  locale?: EditorialLocale; routeLocale?: EditorialLocale | null;
}) {
  const labels = storefrontLabels[locale];
  const links = [["/", labels.home], ["/products", labels.shop], ["/brands", labels.brands], ["/cart", cartLabels[locale].cart]];
  return <footer lang={locale} aria-label="HanaPure" className="border-t border-hanapure-border bg-hanapure-ivory py-8 text-hanapure-text">
    <Container>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-2xl font-light tracking-wide">HanaPure</p>
        <nav aria-label="HanaPure">
          <ul className="flex flex-wrap gap-2">
            {links.map(([path, label]) => <li key={path}>
              <Link href={storefrontHref(path, routeLocale)} className="inline-flex min-h-11 items-center rounded-sm px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hanapure-text">{label}</Link>
            </li>)}
          </ul>
        </nav>
      </div>
    </Container>
  </footer>;
}

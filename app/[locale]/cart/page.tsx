import Header from "@/components/layout/Header";
import CartContent from "@/components/cart/CartContent";
import { cartLabels } from "@/lib/cart/labels";
import { requireStorefrontLocale } from "@/lib/storefront/require-locale";
type Props = { params: Promise<{ locale: string }> };
export async function generateMetadata({ params }: Props) {
  const locale = requireStorefrontLocale((await params).locale);
  return { title: `${cartLabels[locale].cart} | HanaPure`, robots: { index: false, follow: true } };
}
export default async function CartPage({ params }: Props) {
  const locale = requireStorefrontLocale((await params).locale);
  return <main lang={locale} className="min-h-screen bg-hanapure-warm-white text-hanapure-text"><Header /><CartContent locale={locale} routeLocale={locale} /></main>;
}

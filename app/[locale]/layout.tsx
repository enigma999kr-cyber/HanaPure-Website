import { requireStorefrontLocale } from "@/lib/storefront/require-locale";

export default async function LocaleLayout({ children, params }: {
  children: React.ReactNode; params: Promise<{ locale: string }>;
}) {
  const locale = requireStorefrontLocale((await params).locale);
  // Scoped language boundary keeps the existing root layout and legacy URLs intact.
  return <div lang={locale}>{children}</div>;
}

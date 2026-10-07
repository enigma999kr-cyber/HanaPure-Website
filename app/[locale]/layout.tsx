import { requireStorefrontLocale } from "@/lib/storefront/require-locale";
import localFont from "next/font/local";

const gowunBatang = localFont({
  src: [
    { path: "../fonts/gowun-batang/GowunBatang-Regular.woff2", weight: "400", style: "normal" },
    { path: "../fonts/gowun-batang/GowunBatang-Bold.woff2", weight: "700", style: "normal" },
  ],
  display: "swap",
  // This shared layout also wraps EN/HU: only Korean text should load these files.
  preload: false,
  fallback: ["Batang", "serif"],
  adjustFontFallback: false,
});

export default async function LocaleLayout({ children, params }: {
  children: React.ReactNode; params: Promise<{ locale: string }>;
}) {
  const locale = requireStorefrontLocale((await params).locale);
  // Scoped language boundary keeps the existing root layout and legacy URLs intact.
  return <div lang={locale} className={locale === "ko" ? gowunBatang.className : undefined}>{children}</div>;
}

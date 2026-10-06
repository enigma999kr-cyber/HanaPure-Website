"use client";

import Link from "next/link";
import { storefrontLocales, storefrontLabels, switchLocalePath } from "@/lib/storefront/localization";
import type { EditorialLocale } from "@/lib/catalog/editorial-catalogue";

export default function LanguageSwitcher({ locale, pathname, onNavigate }: {
  locale: EditorialLocale; pathname: string; onNavigate?: () => void;
}) {
  return (
    <nav aria-label={storefrontLabels[locale].language} className="flex items-center gap-2">
      {storefrontLocales.map((target) => (
        <Link key={target} href={switchLocalePath(pathname, target)} lang={target}
          aria-label={{ en: "English", hu: "Magyar", ko: "한국어" }[target]}
          aria-current={target === locale ? "true" : undefined} onClick={onNavigate}
          className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-sm text-xs focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hanapure-text aria-[current=true]:font-semibold aria-[current=true]:underline">
          {target.toUpperCase()}
        </Link>
      ))}
    </nav>
  );
}

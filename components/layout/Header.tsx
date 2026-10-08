"use client";

import Container from "@/components/ui/Container";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import LanguageSwitcher from "./LanguageSwitcher";
import { localeFromPath, storefrontHref, storefrontLabels } from "@/lib/storefront/localization";

export default function Header({ catalogueQuery = "" }: { catalogueQuery?: string } = {}) {
  const pathname = usePathname() ?? "/";
  const routeLocale = localeFromPath(pathname);
  const locale = routeLocale ?? "en";
  const labels = storefrontLabels[locale];
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const headerRef = useRef<HTMLElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const desktopShopRef = useRef<HTMLAnchorElement>(null);

  function closeMenuForNavigation() {
    setIsMenuOpen(false);
    // The chosen mobile link is about to be hidden, including same-page links.
    menuButtonRef.current?.focus();
  }

  useEffect(() => {
    if (!isMenuOpen) return;

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        setIsMenuOpen(false);
        menuButtonRef.current?.focus();
      }
    }

    const desktopQuery = window.matchMedia("(min-width: 64rem)");
    function handleBreakpointChange(event: MediaQueryListEvent) {
      if (event.matches) {
        const active = document.activeElement;
        // CSS may already have blurred a newly hidden mobile control.
        if (active === document.body || active === menuButtonRef.current ||
          headerRef.current?.querySelector("#mobile-navigation")?.contains(active)) {
          desktopShopRef.current?.focus();
        }
        setIsMenuOpen(false);
      }
    }

    function handlePointerDown(event: PointerEvent) {
      if (event.target instanceof Node && !headerRef.current?.contains(event.target)) {
        setIsMenuOpen(false);
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    document.addEventListener("pointerdown", handlePointerDown);
    desktopQuery.addEventListener("change", handleBreakpointChange);

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("pointerdown", handlePointerDown);
      desktopQuery.removeEventListener("change", handleBreakpointChange);
    };
  }, [isMenuOpen]);

  return (
    <>
    <a href="#main-content" lang={locale}
      className="sr-only focus:not-sr-only focus:fixed focus:left-5 focus:top-3 focus:z-[60] focus:rounded-sm focus:bg-hanapure-white focus:px-4 focus:py-3 focus:text-hanapure-text">
      {labels.skipContent}
    </a>
    <header ref={headerRef} lang={locale}
      onBlur={(event) => {
        if (isMenuOpen && !event.currentTarget.contains(event.relatedTarget)) {
          // CSS can blur a hidden mobile control before the media change callback.
          // Transfer focus before closing removes that callback's effect listener.
          const fromMobile = event.target === menuButtonRef.current ||
            event.currentTarget.querySelector("#mobile-navigation")?.contains(event.target);
          if (event.relatedTarget === null && fromMobile &&
            window.matchMedia("(min-width: 64rem)").matches) {
            desktopShopRef.current?.focus();
          }
          setIsMenuOpen(false);
        }
      }}
      className="fixed top-0 left-0 z-50 w-full border-b border-hanapure-border bg-hanapure-warm-white/90 backdrop-blur-md">
      <Container>
        <div className="flex h-20 items-center justify-between">
          {/* Logo */}
          <Link
            href={storefrontHref("/", routeLocale)}
            className="text-2xl font-light tracking-wide text-hanapure-text focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-hanapure-text"
          >
            HanaPure
          </Link>

          {/* Desktop Navigation */}
          <nav aria-label={labels.primaryNavigation} className="hidden items-center gap-4 text-sm text-hanapure-muted lg:flex xl:gap-6">
            <Link ref={desktopShopRef} href={storefrontHref("/products", routeLocale)} className="inline-flex min-h-11 items-center transition hover:text-hanapure-text">
              {labels.shop}
            </Link>

            <Link href={storefrontHref("/brands", routeLocale)} className="inline-flex min-h-11 items-center transition hover:text-hanapure-text">
              {labels.brands}
            </Link>

            <span className="hidden xl:inline">
              Skin Concerns
            </span>

            <span className="hidden xl:inline">
              Best Sellers
            </span>

            <span className="hidden xl:inline">
              New Arrivals
            </span>

            <span className="hidden xl:inline">
              Why HanaPure
            </span>
          </nav>

          {/* Right Menu */}
          <div className="hidden items-center gap-5 text-sm text-hanapure-muted lg:flex">
            <a href={`${storefrontHref("/products", routeLocale)}${catalogueQuery}#catalogue-search`} className="inline-flex min-h-11 items-center transition hover:text-hanapure-text focus-visible:outline-2 focus-visible:outline-hanapure-text">
              {labels.search}
            </a>

            <LanguageSwitcher locale={locale} pathname={`${pathname}${catalogueQuery}`} />

            <button type="button" disabled>
              Cart
            </button>
          </div>

          {/* Mobile Menu */}
          <button
            ref={menuButtonRef}
            type="button"
            className="flex min-h-11 min-w-11 flex-col items-center justify-center gap-1.5 rounded-sm text-hanapure-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hanapure-text lg:hidden"
            aria-label={isMenuOpen ? labels.closeMenu : labels.openMenu}
            aria-expanded={isMenuOpen}
            aria-controls="mobile-navigation"
            onClick={() => setIsMenuOpen((open) => !open)}
          >
            <span
              aria-hidden="true"
              className={`h-0.5 w-6 rounded bg-current transition-transform ${isMenuOpen ? "translate-y-2 rotate-45" : ""}`}
            ></span>
            <span
              aria-hidden="true"
              className={`h-0.5 w-6 rounded bg-current transition-opacity ${isMenuOpen ? "opacity-0" : ""}`}
            ></span>
            <span
              aria-hidden="true"
              className={`h-0.5 w-6 rounded bg-current transition-transform ${isMenuOpen ? "-translate-y-2 -rotate-45" : ""}`}
            ></span>
          </button>
        </div>
      </Container>
      <nav
        id="mobile-navigation"
        aria-label={labels.navigation}
        hidden={!isMenuOpen}
        className="max-h-[calc(100dvh-5rem)] overflow-y-auto overscroll-contain border-t border-hanapure-border bg-hanapure-warm-white lg:hidden"
      >
        <Container>
          <div className="flex flex-col py-3 text-base text-hanapure-text">
            <Link
              href={storefrontHref("/", routeLocale)}
              className="rounded-sm px-2 py-3 hover:bg-hanapure-beige-light focus-visible:outline-2 focus-visible:outline-hanapure-text"
              onClick={closeMenuForNavigation}
            >
              {labels.home}
            </Link>
            <Link
              href={storefrontHref("/products", routeLocale)}
              className="rounded-sm px-2 py-3 hover:bg-hanapure-beige-light focus-visible:outline-2 focus-visible:outline-hanapure-text"
              onClick={closeMenuForNavigation}
            >
              {labels.shop}
            </Link>
            <Link
              href={storefrontHref("/brands", routeLocale)}
              className="rounded-sm px-2 py-3 hover:bg-hanapure-beige-light focus-visible:outline-2 focus-visible:outline-hanapure-text"
              onClick={closeMenuForNavigation}
            >
              {labels.brands}
            </Link>
            <LanguageSwitcher locale={locale} pathname={`${pathname}${catalogueQuery}`} onNavigate={closeMenuForNavigation} />
          </div>
        </Container>
      </nav>
    </header>
    </>
  );
}

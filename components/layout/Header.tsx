"use client";

import Container from "@/components/ui/Container";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";

export default function Header() {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!isMenuOpen) return;

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setIsMenuOpen(false);
        menuButtonRef.current?.focus();
      }
    }

    const desktopQuery = window.matchMedia("(min-width: 64rem)");
    function handleBreakpointChange(event: MediaQueryListEvent) {
      if (event.matches) setIsMenuOpen(false);
    }

    document.addEventListener("keydown", handleKeyDown);
    desktopQuery.addEventListener("change", handleBreakpointChange);

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      desktopQuery.removeEventListener("change", handleBreakpointChange);
    };
  }, [isMenuOpen]);

  return (
    <header className="fixed top-0 left-0 z-50 w-full border-b border-hanapure-border bg-hanapure-warm-white/90 backdrop-blur-md">
      <Container>
        <div className="flex h-20 items-center justify-between">
          {/* Logo */}
          <Link
            href="/"
            className="text-2xl font-light tracking-wide text-hanapure-text focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-hanapure-text"
          >
            HanaPure
          </Link>

          {/* Desktop Navigation */}
          <nav className="hidden items-center gap-8 text-sm text-hanapure-muted lg:flex">
            <a href="#" className="transition hover:text-hanapure-text">
              Shop
            </a>

            <Link href="/brands" className="transition hover:text-hanapure-text">
              Brands
            </Link>

            <a href="#" className="transition hover:text-hanapure-text">
              Skin Concerns
            </a>

            <a href="#" className="transition hover:text-hanapure-text">
              Best Sellers
            </a>

            <a href="#" className="transition hover:text-hanapure-text">
              New Arrivals
            </a>

            <a href="#" className="transition hover:text-hanapure-text">
              Why HanaPure
            </a>
          </nav>

          {/* Right Menu */}
          <div className="hidden items-center gap-5 text-sm text-hanapure-muted lg:flex">
            <button className="transition hover:text-hanapure-text">
              Search
            </button>

            <button className="transition hover:text-hanapure-text">EN</button>

            <button className="transition hover:text-hanapure-text">
              Cart
            </button>
          </div>

          {/* Mobile Menu */}
          <button
            ref={menuButtonRef}
            type="button"
            className="flex min-h-11 min-w-11 flex-col items-center justify-center gap-1.5 rounded-sm text-hanapure-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hanapure-text lg:hidden"
            aria-label={isMenuOpen ? "Close menu" : "Open menu"}
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
        aria-label="Mobile navigation"
        hidden={!isMenuOpen}
        className="border-t border-hanapure-border bg-hanapure-warm-white lg:hidden"
      >
        <Container>
          <div className="flex flex-col py-3 text-base text-hanapure-text">
            <Link
              href="/"
              className="rounded-sm px-2 py-3 hover:bg-hanapure-beige-light focus-visible:outline-2 focus-visible:outline-hanapure-text"
              onClick={() => setIsMenuOpen(false)}
            >
              Home
            </Link>
            <Link
              href="/brands"
              className="rounded-sm px-2 py-3 hover:bg-hanapure-beige-light focus-visible:outline-2 focus-visible:outline-hanapure-text"
              onClick={() => setIsMenuOpen(false)}
            >
              Brands
            </Link>
          </div>
        </Container>
      </nav>
    </header>
  );
}

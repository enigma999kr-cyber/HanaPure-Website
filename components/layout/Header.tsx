import Container from "@/components/ui/Container";

export default function Header() {
  return (
    <header className="fixed top-0 left-0 z-50 w-full border-b border-hanapure-border bg-hanapure-warm-white/90 backdrop-blur-md">
      <Container>
        <div className="flex h-20 items-center justify-between">
          {/* Logo */}
          <div className="text-2xl font-light tracking-wide text-hanapure-text">
            HanaPure
          </div>

          {/* Desktop Navigation */}
          <nav className="hidden items-center gap-8 text-sm text-hanapure-muted lg:flex">
            <a href="#" className="transition hover:text-hanapure-text">
              Shop
            </a>

            <a href="#" className="transition hover:text-hanapure-text">
              Brands
            </a>

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
            className="flex flex-col gap-1.5 lg:hidden"
            aria-label="Open Menu"
          >
            <span className="h-0.5 w-6 rounded bg-hanapure-text"></span>
            <span className="h-0.5 w-6 rounded bg-hanapure-text"></span>
            <span className="h-0.5 w-6 rounded bg-hanapure-text"></span>
          </button>
        </div>
      </Container>
    </header>
  );
}

import Container from "@/components/ui/Container";

export default function Header() {
  return (
    <header className="fixed top-0 left-0 z-50 w-full border-b border-[#E9DFD2] bg-[#FCF8F2]/90 backdrop-blur-md">
      <Container>
        <div className="flex h-20 items-center justify-between">

          {/* Logo */}
          <div className="text-2xl font-light tracking-wide text-gray-900">
            HanaPure
          </div>

          {/* Desktop Navigation */}
          <nav className="hidden items-center gap-8 text-sm text-gray-700 lg:flex">

            <a href="#" className="hover:text-black transition">
              Shop
            </a>

            <a href="#" className="hover:text-black transition">
              Brands
            </a>

            <a href="#" className="hover:text-black transition">
              Skin Concerns
            </a>

            <a href="#" className="hover:text-black transition">
              Best Sellers
            </a>

            <a href="#" className="hover:text-black transition">
              New Arrivals
            </a>

            <a href="#" className="hover:text-black transition">
              Why HanaPure
            </a>

          </nav>

          {/* Right Menu */}
          <div className="hidden items-center gap-5 text-sm text-gray-700 lg:flex">

            <button className="hover:text-black transition">
              Search
            </button>

            <button className="hover:text-black transition">
              EN
            </button>

            <button className="hover:text-black transition">
              Cart
            </button>

          </div>

          {/* Mobile Menu */}
          <button
            className="flex flex-col gap-1.5 lg:hidden"
            aria-label="Open Menu"
          >
            <span className="h-0.5 w-6 rounded bg-gray-900"></span>
            <span className="h-0.5 w-6 rounded bg-gray-900"></span>
            <span className="h-0.5 w-6 rounded bg-gray-900"></span>
          </button>

        </div>
      </Container>
    </header>
  );
}
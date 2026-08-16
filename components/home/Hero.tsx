import Button from "@/components/ui/Button";

export default function Hero() {
  return (
    <section className="relative flex min-h-[100svh] items-start justify-center overflow-hidden px-5 pb-16 pt-32 text-center sm:px-6 sm:pb-20 sm:pt-36 lg:min-h-screen lg:items-center lg:py-28">
      <div className="absolute inset-0 bg-gradient-to-b from-hanapure-warm-white via-hanapure-white to-hanapure-ivory" />

      <div className="absolute left-1/2 top-24 h-80 w-80 -translate-x-1/2 rounded-full bg-hanapure-beige-light opacity-40 blur-3xl sm:top-20 sm:h-[520px] sm:w-[520px]" />

      <div className="relative z-10 mx-auto w-full max-w-5xl">
        <p className="mb-4 text-xs uppercase tracking-[0.3em] text-hanapure-muted sm:text-sm">
          Trusted Korean Skincare
        </p>

        <h1 className="mx-auto mb-6 max-w-4xl text-4xl font-light leading-[1.08] text-hanapure-text sm:text-5xl md:text-7xl">
          Feel confident in your skin.
        </h1>

        <p className="mx-auto mb-8 max-w-2xl text-base leading-7 text-hanapure-muted sm:mb-10 sm:text-lg sm:leading-8">
          Starting in Hungary, growing across Europe — HanaPure carefully
          selects authentic Korean skincare with real skin benefits and trusted
          guidance.
        </p>

        <div className="mx-auto flex w-full max-w-sm flex-col gap-3 sm:max-w-none sm:flex-row sm:justify-center sm:gap-4">
          <Button className="w-full sm:w-auto">Shop Korean Skincare</Button>
          <Button className="w-full sm:w-auto" variant="secondary">
            Discover Your Routine
          </Button>
        </div>

        <div className="mx-auto mt-10 grid max-w-3xl gap-3 text-sm leading-6 text-hanapure-muted sm:mt-12 sm:grid-cols-3 sm:gap-4">
          <div>✓ Authentic Korean Brands</div>
          <div>✓ Real Skincare Benefits</div>
          <div>✓ Curated with Trust</div>
        </div>
      </div>
    </section>
  );
}

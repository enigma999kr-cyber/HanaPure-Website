import Button from "@/components/ui/Button";

export default function Hero() {
  return (
    <section className="relative flex min-h-screen items-center justify-center overflow-hidden px-6 text-center">
      <div className="absolute inset-0 bg-gradient-to-b from-[#FCF8F2] via-[#FFFDF9] to-[#F7EFE6]" />

      <div className="absolute left-1/2 top-20 h-[520px] w-[520px] -translate-x-1/2 rounded-full bg-[#F4EADF] opacity-40 blur-3xl" />

      <div className="relative z-10">
        <p className="mb-4 text-sm uppercase tracking-[0.3em] text-gray-500">
          Trusted Korean Skincare
        </p>

        <h1 className="mb-6 max-w-4xl text-5xl font-light leading-tight text-gray-900 md:text-7xl">
          Feel confident in your skin.
        </h1>

        <p className="mb-10 max-w-2xl text-lg leading-8 text-gray-600">
          Starting in Hungary, growing across Europe — HanaPure carefully
          selects authentic Korean skincare with real skin benefits and trusted
          guidance.
        </p>

        <div className="flex flex-col gap-4 sm:flex-row sm:justify-center">
          <Button>Shop Korean Skincare</Button>
          <Button variant="secondary">Discover Your Routine</Button>
        </div>

        <div className="mt-12 grid gap-4 text-sm text-gray-600 sm:grid-cols-3">
          <div>✓ Authentic Korean Brands</div>
          <div>✓ Real Skincare Benefits</div>
          <div>✓ Curated with Trust</div>
        </div>
      </div>
    </section>
  );
}
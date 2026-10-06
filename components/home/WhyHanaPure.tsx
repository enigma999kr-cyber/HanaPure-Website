import Container from "@/components/ui/Container";
import { marketingCopy } from "@/lib/storefront/marketing-copy";
import type { EditorialLocale } from "@/lib/catalog/editorial-catalogue";

export default function WhyHanaPure({ locale = "en" }: { locale?: EditorialLocale }) {
  const copy = marketingCopy[locale].why;
  return (
    <section className="bg-hanapure-beige-light py-28">
      <Container>
        <div className="mx-auto max-w-3xl text-center">
          <p className="mb-4 text-sm uppercase tracking-[0.3em] text-hanapure-muted">
            {copy.eyebrow}
          </p>

          <h2 className="mb-6 text-4xl font-light text-hanapure-text md:text-5xl">
            {copy.heading}
          </h2>

          <p className="text-lg leading-8 text-hanapure-muted">
            {copy.description}
          </p>
        </div>

        <div className="mt-16 grid gap-6 md:grid-cols-3">
          {copy.points.map((point) => (
            <div
              key={point.title}
              className="rounded-3xl bg-hanapure-white p-8 shadow-sm"
            >
              <h3 className="mb-4 text-xl font-medium text-hanapure-text">
                {point.title}
              </h3>

              <p className="leading-7 text-hanapure-muted">
                {point.description}
              </p>
            </div>
          ))}
        </div>
      </Container>
    </section>
  );
}

import Container from "@/components/ui/Container";

const points = [
  {
    title: "Perspective",
    description:
      "Created with a deep understanding of what skincare customers truly need.",
  },
  {
    title: "Korean Expertise",
    description:
      "Built on years of experience importing and selecting trusted Korean skincare for European customers.",
  },
  {
    title: "Carefully Curated",
    description:
      "We believe quality is more valuable than quantity. Every product in HanaPure is carefully chosen because we genuinely trust it.",
  },
];

export default function WhyHanaPure() {
  return (
    <section className="bg-hanapure-beige-light py-28">
      <Container>
        <div className="mx-auto max-w-3xl text-center">
          <p className="mb-4 text-sm uppercase tracking-[0.3em] text-hanapure-muted">
            Why HanaPure
          </p>

          <h2 className="mb-6 text-4xl font-light text-hanapure-text md:text-5xl">
            A bridge between Korean skincare and European customers.
          </h2>

          <p className="text-lg leading-8 text-hanapure-muted">
            HanaPure combines Korean skincare knowledge with a customer-first
            perspective — helping you discover products that are authentic,
            effective, and carefully selected.
          </p>
        </div>

        <div className="mt-16 grid gap-6 md:grid-cols-3">
          {points.map((point) => (
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

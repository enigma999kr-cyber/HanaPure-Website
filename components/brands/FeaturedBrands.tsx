import BrandCard from "./BrandCard";

const brands = [
  {
    name: "Round Lab",
    tagline: "Hydration Specialist",
    description:
      "Gentle skincare inspired by clean Korean ingredients and daily hydration.",
    accent: "bg-gradient-to-br from-[#F4EADF] to-[#FFFDF9]",
  },
  {
    name: "Anua",
    tagline: "Calm Daily Care",
    description:
      "Minimal formulas focused on soothing, balancing, and supporting sensitive skin.",
    accent: "bg-gradient-to-br from-[#E9CFC6] to-[#FFFDF9]",
  },
  {
    name: "Skin1004",
    tagline: "Centella Expert",
    description:
      "Known for calming skincare centered around Madagascar Centella.",
    accent: "bg-gradient-to-br from-[#F8F2EB] to-[#FFFDF9]",
  },
];

export default function FeaturedBrands() {
  return (
    <section className="bg-[#F8F2EB] py-28">
      <div className="mx-auto max-w-7xl px-6">
        <p className="mb-4 text-center text-sm uppercase tracking-[0.3em] text-gray-500">
          Featured Brands
        </p>

        <h2 className="mx-auto mb-6 max-w-3xl text-center text-5xl font-light text-gray-900">
          Carefully selected Korean skincare,
          <br />
          trusted by our team.
        </h2>

        <p className="mx-auto mb-16 max-w-2xl text-center text-lg leading-8 text-gray-600">
          Every brand inside HanaPure has been chosen because we genuinely
          believe in its quality, philosophy, and skincare benefits.
        </p>

        <div className="grid gap-8 md:grid-cols-3">
          {brands.map((brand) => (
            <BrandCard
              key={brand.name}
              name={brand.name}
              tagline={brand.tagline}
              description={brand.description}
              accent={brand.accent}
            />
          ))}
        </div>
      </div>
    </section>
  );
}
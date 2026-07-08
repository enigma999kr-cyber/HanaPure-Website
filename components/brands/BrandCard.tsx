type BrandCardProps = {
  name: string;
  tagline: string;
  description: string;
  accent: string;
};

export default function BrandCard({
  name,
  tagline,
  description,
  accent,
}: BrandCardProps) {
  return (
    <article className="group overflow-hidden rounded-[2rem] border border-[#E8E3DD] bg-[#FFFDF9] shadow-sm transition duration-300 hover:-translate-y-1 hover:bg-[#FFFCF8] hover:shadow-lg">
      <div className={`h-40 ${accent}`} />

      <div className="p-8">
        <h3 className="mb-3 text-2xl font-light text-gray-900">{name}</h3>

        <p className="mb-6 text-sm font-medium text-gray-700">{tagline}</p>

        <p className="mb-8 leading-7 text-gray-600">{description}</p>

        <a
          href="#"
          className="text-sm font-medium text-gray-900 transition group-hover:tracking-wide"
        >
          Discover Brand →
        </a>
      </div>
    </article>
  );
}
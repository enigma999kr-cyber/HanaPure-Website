import Header from "@/components/layout/Header";
import Hero from "@/components/home/Hero";
import WhyHanaPure from "@/components/home/WhyHanaPure";
import FeaturedBrands from "@/components/brands/FeaturedBrands";

export default function Home() {
  return (
    <main className="min-h-screen bg-white">
      <Header />

      <Hero />

      <FeaturedBrands />

      <WhyHanaPure />
    </main>
  );
}
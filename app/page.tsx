import HomeContent from "@/components/home/HomeContent";
import { marketingMetadata } from "@/lib/storefront/seo";

export function generateMetadata() {
  return marketingMetadata("home", "en", { legacy: true });
}

export default function Home() {
  return <HomeContent />;
}

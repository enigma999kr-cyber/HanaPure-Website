import Header from "@/components/layout/Header";
import CartContent from "@/components/cart/CartContent";
export const metadata = { title: "Cart | HanaPure", robots: { index: false, follow: true } };
export default function CartPage() {
  return <main className="min-h-screen bg-hanapure-warm-white text-hanapure-text"><Header /><CartContent /></main>;
}

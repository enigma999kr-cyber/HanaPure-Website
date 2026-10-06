import Header from "@/components/layout/Header";
import Container from "@/components/ui/Container";
import Link from "next/link";

export default function ProductNotFound() {
  return (
    <main className="min-h-screen bg-hanapure-warm-white text-hanapure-text">
      <Header />
      <Container className="pb-20 pt-32 sm:pt-36">
        <h1 className="text-4xl font-light">Product page not found</h1>
        <p className="mt-4 leading-7 text-hanapure-muted">This product page is not available.</p>
        <Link href="/products" className="mt-6 inline-flex min-h-11 items-center underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-hanapure-text">Back to products</Link>
      </Container>
    </main>
  );
}

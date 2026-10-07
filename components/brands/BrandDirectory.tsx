"use client";

import { useState } from "react";
import Link from "next/link";
import { brandNames } from "@/data/brands";
import Container from "@/components/ui/Container";
import type { MarketingCopy } from "@/lib/storefront/marketing-copy";

const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");
const sortedBrands = [...brandNames].sort((first, second) =>
  first.toLowerCase().localeCompare(second.toLowerCase(), "en"),
);
const availableLetters = new Set(
  sortedBrands.map((brand) => brand[0].toUpperCase()),
);

export default function BrandDirectory({ labels, catalogueLinks }: {
  labels: MarketingCopy["directory"];
  catalogueLinks: Readonly<Record<string, string>>;
}) {
  const [query, setQuery] = useState("");
  const [selectedLetter, setSelectedLetter] = useState<string | null>(null);
  const normalizedQuery = query.trim().toLowerCase();

  const matchingBrands = sortedBrands.filter(
    (brand) =>
      brand.toLowerCase().includes(normalizedQuery) &&
      (!selectedLetter || brand[0].toUpperCase() === selectedLetter),
  );
  const visibleLetters = alphabet.filter((letter) =>
    matchingBrands.some((brand) => brand[0].toUpperCase() === letter),
  );

  return (
    <section aria-label={labels.browse} className="pb-24 pt-4 sm:pt-8">
      <Container>
        <div className="rounded-3xl border border-hanapure-border bg-hanapure-white p-5 shadow-sm sm:p-8">
          <label
            htmlFor="brand-search"
            className="mb-3 block text-sm font-medium text-hanapure-text"
          >
            {labels.searchLabel}
          </label>
          <input
            id="brand-search"
            type="search"
            autoComplete="off"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={labels.searchPlaceholder}
            className="w-full rounded-2xl border border-hanapure-border bg-hanapure-warm-white px-5 py-4 text-base text-hanapure-text outline-none placeholder:text-hanapure-muted focus-visible:border-hanapure-beige-deep focus-visible:ring-2 focus-visible:ring-hanapure-beige"
          />

          <div className="mt-8" aria-label={labels.filterLabel}>
            <p className="mb-3 text-sm font-medium text-hanapure-text">
              {labels.alphabet}
            </p>
            <div className="grid grid-cols-7 gap-1.5 sm:grid-cols-10 md:grid-cols-14 lg:grid-cols-[repeat(27,minmax(0,1fr))]">
              <button
                type="button"
                aria-pressed={selectedLetter === null}
                onClick={() => setSelectedLetter(null)}
                className="min-h-10 break-words rounded-lg px-1 text-sm font-medium transition hover:bg-hanapure-beige-light focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hanapure-text aria-pressed:bg-hanapure-text aria-pressed:text-hanapure-white"
              >
                {labels.all}
              </button>
              {alphabet.map((letter) => (
                <button
                  key={letter}
                  type="button"
                  disabled={!availableLetters.has(letter)}
                  aria-pressed={selectedLetter === letter}
                  onClick={() => setSelectedLetter(letter)}
                  className="min-h-10 rounded-lg text-sm font-medium transition hover:bg-hanapure-beige-light focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hanapure-text aria-pressed:bg-hanapure-text aria-pressed:text-hanapure-white disabled:cursor-not-allowed disabled:text-hanapure-border disabled:hover:bg-transparent"
                >
                  {letter}
                </button>
              ))}
            </div>
          </div>
        </div>

        <p aria-live="polite" className="mt-8 text-sm text-hanapure-muted">
          {(matchingBrands.length === 1 ? labels.resultOne : labels.resultMany).replace("{count}", String(matchingBrands.length))}
        </p>

        {matchingBrands.length === 0 ? (
          <div className="mt-6 rounded-3xl border border-hanapure-border bg-hanapure-white px-6 py-12 text-center">
            <h2 className="text-2xl font-light">{labels.empty}</h2>
            <p className="mt-3 text-hanapure-muted">
              {labels.emptyDescription}
            </p>
          </div>
        ) : (
          <div className="mt-5 space-y-10">
            {visibleLetters.map((letter) => (
              <section key={letter} aria-labelledby={`letter-${letter}`}>
                <h2
                  id={`letter-${letter}`}
                  className="border-b border-hanapure-border pb-3 text-3xl font-light text-hanapure-text"
                >
                  {letter}
                </h2>
                <ul className="grid sm:grid-cols-2 lg:grid-cols-3">
                  {matchingBrands
                    .filter((brand) => brand[0].toUpperCase() === letter)
                    .map((brand) => (
                      <li
                        key={brand}
                        className="border-b border-hanapure-border text-xl font-light text-hanapure-text"
                      >
                        <Link href={catalogueLinks[brand]}
                          className="flex min-h-11 items-center rounded-sm px-1 py-6 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-hanapure-text">
                          {brand}
                        </Link>
                      </li>
                    ))}
                </ul>
              </section>
            ))}
          </div>
        )}
      </Container>
    </section>
  );
}

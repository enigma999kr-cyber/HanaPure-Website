import "server-only";
import { notFound } from "next/navigation";
import { isStorefrontLocale } from "./localization";

export function requireStorefrontLocale(value: string) {
  if (!isStorefrontLocale(value)) notFound();
  return value;
}

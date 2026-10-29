import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { reviewFirstSkuEditorialDraft, EDITORIAL_SYNTHETIC_ID } from "../lib/catalog/first-sku-editorial-review.ts";

// No private-file reader, output path, listener or overwrite API. Existing private
// intake ACL/reparse protections remain the only path for real private file work.
export function syntheticEditorialTemplate(mode = "all") {
  if (!["one", "all"].includes(mode)) throw Error("INVALID_SAMPLE_MODE");
  const content = (name, description, alt) => ({ name, description, images: [{ src: "/synthetic-review-only.svg", alt }], usage: null, caution: null });
  return { scope: "SYNTHETIC_ONLY", selectedPublicId: EDITORIAL_SYNTHETIC_ID, comparisons: [], draft: {
    publicId: EDITORIAL_SYNTHETIC_ID, brand: "Round Lab", slug: "synthetic-review-only", state: "draft",
    translations: { en: content("Synthetic editorial sample", "Offline draft for manual review only.", "Synthetic placeholder"),
      hu: mode === "one" ? null : content("Szintetikus szerkesztői minta", "Offline piszkozat, kizárólag kézi ellenőrzésre.", "Szintetikus helyőrző"),
      ko: mode === "one" ? null : content("합성 편집 예시", "수동 검토만을 위한 오프라인 초안입니다.", "합성 자리표시자") },
  } };
}
export async function runSyntheticEditorialReview(args, input, environment = {}) {
  const invalid = () => reviewFirstSkuEditorialDraft(null);
  try {
    if (environment.NODE_ENV === "production" || ["VERCEL", "NETLIFY", "CF_PAGES", "DEPLOYMENT_ENV"].some(k => environment[k] !== undefined)) return invalid();
    if (args.length === 2 && ["--sample", "--template"].includes(args[0]) && ["one", "all"].includes(args[1])) {
      const template = syntheticEditorialTemplate(args[1]);
      return args[0] === "--template" ? template : reviewFirstSkuEditorialDraft(template);
    }
    if (args.length !== 1 || args[0] !== "--synthetic-stdin" || !input) return invalid();
    const chunks = []; let size = 0;
    for await (const chunk of input) {
      const bytes = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
      size += bytes.byteLength; if (size > 65536) return invalid(); chunks.push(bytes);
    }
    const json = new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks));
    return reviewFirstSkuEditorialDraft(JSON.parse(json));
  } catch { return invalid(); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const result = await runSyntheticEditorialReview(process.argv.slice(2), process.stdin, process.env);
  console.log(JSON.stringify(result, null, 2));
  if (result.status === "INVALID_INPUT") process.exitCode = 1;
}

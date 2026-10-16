import { createServer } from "node:http";
import { readFileSync, realpathSync, statSync } from "node:fs";
import { dirname, extname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { validateEditorialCatalogue } from "../lib/catalog/editorial-catalogue.ts";
import { storefrontLabels, storefrontLocales } from "../lib/storefront/localization.ts";

// Deliberately outside the Next route/import graph. Supplied drafts, read-only.
const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const inside = (root, path) => {
  const part = relative(root, path);
  return part === "" || (!isAbsolute(part) && part !== ".." && !part.startsWith(`..${sep}`));
};
const escape = value => String(value).replace(/[&<>"']/g, char =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
const mimeTypes = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
  ".webp": "image/webp", ".gif": "image/gif", ".avif": "image/avif" };

function requireLocal(environment) {
  if (environment.NODE_ENV !== "development" || environment.HANAPURE_DRAFT_PREVIEW_LOCAL !== "1" ||
    (environment.APP_ENV !== undefined && environment.APP_ENV !== "local") ||
    ["VERCEL", "VERCEL_ENV", "NETLIFY", "CF_PAGES", "DEPLOYMENT_ENV"].some(key => environment[key] !== undefined)) {
    throw new Error("Draft preview requires explicit local development; deployment/staging/production refused");
  }
}

function outsideRepo(path) {
  if (!isAbsolute(path)) throw new Error("Preview input must be an absolute local path outside the repository");
  const real = realpathSync(path);
  if (inside(repo, real)) throw new Error("Preview input/assets must remain outside the repository");
  return real;
}

function imageFile(root, src) {
  if (!root || !src.startsWith("/") || src.startsWith("//")) return null;
  try {
    const pathname = decodeURIComponent(new URL(src, "http://127.0.0.1").pathname);
    const file = realpathSync(resolve(root, `.${pathname}`));
    const mime = mimeTypes[extname(file).toLowerCase()];
    if (!inside(root, file) || inside(repo, file) || !mime || !statSync(file).isFile() || statSync(file).size > 8_000_000) return null;
    return { file, mime };
  } catch { return null; }
}

const reviewFilters = ["all", "needs-review", "missing-locale"];
const reviewHref = (path, locale, filter) => `${path}?locale=${locale}${filter === "all" ? "" : `&amp;filter=${filter}`}`;

/** Factual field presence only. Optional fields are review prompts, not publication gates. */
export function reviewCoverage(content) {
  return { present: content !== null, nameNonblank: Boolean(content?.name.trim()),
    descriptionNonblank: Boolean(content?.description.trim()), imageCount: content?.images.length ?? 0,
    altNonblankCount: content?.images.filter(image => image.alt.trim()).length ?? 0,
    usageSupplied: content !== null && content.usage !== null,
    cautionSupplied: content !== null && content.caution !== null };
}

function matchesReview(draft, locale, filter) {
  const missingCore = coverage => !coverage.present || !coverage.nameNonblank || !coverage.descriptionNonblank;
  if (filter === "missing-locale") return missingCore(reviewCoverage(draft.translations[locale]));
  if (filter === "needs-review") return storefrontLocales.some(value => {
    const coverage = reviewCoverage(draft.translations[value]);
    return missingCore(coverage) || !coverage.imageCount || coverage.altNonblankCount < coverage.imageCount ||
      !coverage.usageSupplied || !coverage.cautionSupplied;
  });
  return true;
}

/** Quote every cell, retaining line breaks; neutralize formula prefixes after invisible characters. */
export function reviewCsvCell(value) {
  const text = String(value);
  const safe = /^[\s\p{Cc}\p{Cf}]*[=+\-@]/u.test(text) ? `'${text}` : text;
  return `"${safe.replaceAll('"', '""')}"`;
}

export function reviewMatrixCsv(records) {
  const fields = ["present", "name_nonblank", "description_nonblank", "image_count", "alt_nonblank_count", "usage_supplied", "caution_supplied"];
  const header = ["publicId", "slug", "brand", ...storefrontLocales.flatMap(locale => fields.map(field => `${locale}_${field}`))];
  const rows = records.map(draft => [draft.publicId, draft.slug, draft.brand,
    ...storefrontLocales.flatMap(locale => Object.values(reviewCoverage(draft.translations[locale])))]);
  return "\uFEFF" + [header, ...rows].map(row => row.map(reviewCsvCell).join(",")).join("\r\n") + "\r\n";
}

function languageLinks(path, locale, filter = "all") {
  return storefrontLocales.map(value => `<a href="${reviewHref(path, value, filter)}" ${value === locale ? 'aria-current="page"' : ""}>${value.toUpperCase()}</a>`).join("");
}

function render(draft, locale, assets, index = null, indexes = [0], filter = "all") {
  const content = draft.translations[locale];
  const labels = storefrontLabels[locale];
  const path = index === null ? "/" : `/draft/${index}`;
  const mediaPath = index === null ? "" : `/draft/${index}`;
  const images = content?.images.map((image, index) => `<figure>${imageFile(assets, image.src)
    ? `<img src="${mediaPath}/media/${locale}/${index}" alt="${escape(image.alt)}">`
    : `<p role="img" aria-label="${escape(image.alt)}">${escape(image.alt)}</p>`}
    <figcaption>${escape(image.src)}</figcaption></figure>`).join("") ?? "";
  const position = indexes.indexOf(index);
  const navigation = languageLinks(path, locale, filter) + (index === null ? "" :
    `<a href="${reviewHref("/", locale, filter)}">Back to drafts</a>` +
    (position > 0 ? `<a href="${reviewHref(`/draft/${indexes[position - 1]}`, locale, filter)}">Previous draft</a>` : "") +
    (position >= 0 && position + 1 < indexes.length ? `<a href="${reviewHref(`/draft/${indexes[position + 1]}`, locale, filter)}">Next draft</a>` : ""));
  return page(locale, navigation, `<dl><dt>publicId</dt><dd>${escape(draft.publicId)}</dd><dt>slug</dt><dd>${escape(draft.slug)}</dd><dt>state</dt><dd>${escape(draft.state)}</dd></dl>
    <p>${escape(draft.brand)}</p><h1>${escape(content?.name || labels.details)}</h1>
    <p>${escape(content?.description ?? labels.missing)}</p><div class="images">${images}</div>
    ${content?.usage !== null && content?.usage !== undefined ? `<h2>${escape(labels.usage)}</h2><p>${escape(content.usage)}</p>` : ""}
    ${content?.caution !== null && content?.caution !== undefined ? `<h2>${escape(labels.caution)}</h2><p>${escape(content.caution)}</p>` : ""}`);
}

function renderList(records, locale, indexes, filter) {
  const labels = storefrontLabels[locale];
  const filterNames = ["All drafts", "Needs content review", "Missing selected-locale content"];
  const yes = value => value ? "Yes" : "No";
  return page(locale, languageLinks("/", locale, filter), `<h1>Drafts (${records.length})</h1>
    <p>Field presence is a review checklist, not editorial, safety, legal or publication approval. Missing optional fields are review prompts, not validation errors.</p>
    <p>Needs content review: any language has missing core text, images, alt text, usage or caution. Missing selected-locale content: translation is absent, or its name or description is blank. Blank optional text counts as supplied.</p>
    <nav aria-label="Content review filters">${reviewFilters.map((value, index) => `<a href="${reviewHref("/", locale, value)}" ${value === filter ? 'aria-current="page"' : ""}>${filterNames[index]}</a>`).join("")}</nav>
    <p role="status">Showing ${indexes.length} of ${records.length} drafts</p>
    <a href="/review-matrix.csv" download>Download Review Matrix CSV</a><p>Exports all drafts (not just filtered rows)</p>
    ${indexes.length === 0 ? "<p>No drafts match this review filter.</p>" : ""}
    <div class="matrix-scroll" role="region" aria-labelledby="coverage-caption" tabindex="0"><table>
    <caption id="coverage-caption">Draft field coverage — structural presence only</caption>
    <thead><tr>${["Draft / publicId", "Slug", "Brand", "EN", "HU", "KO"].map(value => `<th scope="col">${value}</th>`).join("")}</tr></thead>
    <tbody>${indexes.map(index => {
    const draft = records[index];
    const content = draft.translations[locale];
    return `<tr><th scope="row"><a href="${reviewHref(`/draft/${index}`, locale, filter)}">${escape(content?.name || labels.details)}</a>
      <p>${escape(draft.publicId)}</p>${content === null ? `<p>${escape(labels.missing)}</p>` : ""}</th>
      <td>${escape(draft.slug)}</td><td>${escape(draft.brand)}</td>${storefrontLocales.map(value => {
        const coverage = reviewCoverage(draft.translations[value]);
        return `<td><dl><dt>Translation</dt><dd>${coverage.present ? "Present" : "Missing"}</dd>
          <dt>Name nonblank</dt><dd>${yes(coverage.nameNonblank)}</dd><dt>Description nonblank</dt><dd>${yes(coverage.descriptionNonblank)}</dd>
          <dt>Images</dt><dd>${coverage.imageCount}</dd><dt>Nonblank alt</dt><dd>${coverage.altNonblankCount}/${coverage.imageCount}</dd>
          <dt>Usage supplied</dt><dd>${yes(coverage.usageSupplied)}</dd><dt>Caution supplied</dt><dd>${yes(coverage.cautionSupplied)}</dd></dl></td>`;
      }).join("")}</tr>`;
  }).join("")}</tbody></table></div>`);
}

function page(locale, navigation, body) {
  const labels = storefrontLabels[locale];
  return `<!doctype html><html lang="${locale}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
    <meta name="robots" content="noindex,nofollow"><title>DRAFT — NOT PUBLIC</title>
    <style>*{box-sizing:border-box}body{margin:0;background:#fcfaf7;color:#1c1a18;font-family:Arial,Helvetica,sans-serif}
    main{max-width:960px;margin:auto;padding:24px}nav{display:flex;flex-wrap:wrap;gap:20px;margin:24px 0}a{color:inherit;min-height:44px;display:inline-flex;align-items:center}
    a:focus-visible{outline:2px solid #1c1a18;outline-offset:4px}h1,p,dd,figcaption,li a{overflow-wrap:anywhere;white-space:pre-wrap}
    .badge{background:#e4d4c2;padding:16px}.images{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,240px),1fr));gap:16px}
    figure{margin:0;min-width:0}img{width:100%;aspect-ratio:1;object-fit:contain;background:#fff}figcaption{color:#625e58}dd{margin:8px 0 20px}
    .matrix-scroll{max-width:100%;overflow-x:auto;margin-top:24px}.matrix-scroll:focus-visible{outline:2px solid #1c1a18;outline-offset:4px}
    table{border-collapse:collapse;min-width:1100px;width:100%}th,td{padding:16px;border:1px solid #e5ddd3;text-align:left;vertical-align:top;max-width:260px;overflow-wrap:anywhere}caption{padding:12px;text-align:left}</style></head>
    <body><main><p class="badge">DRAFT — NOT PUBLIC</p><nav aria-label="${escape(labels.language)}">
    ${navigation}</nav>${body}
    </main></body></html>`;
}

export async function startDraftPreview({ draft, assetsDirectory, environment = process.env }) {
  requireLocal(environment);
  const multi = Array.isArray(draft);
  const input = multi ? draft : [draft];
  if (input.length < 1 || input.length > 50) throw new Error("Preview accepts 1–50 drafts");
  const validation = validateEditorialCatalogue(input);
  if (!validation.ok || validation.records.some(record => record.state !== "draft")) throw new Error("Only one or more schema-valid drafts may be previewed");
  const records = validation.records;
  if (Buffer.byteLength(JSON.stringify(records), "utf8") > 1_000_000) throw new Error("Preview input exceeds 1MB");
  let imageCount = 0;
  for (const record of records) for (const content of Object.values(record.translations)) {
    if (content && content.images.length > 10) throw new Error("Preview accepts at most 10 images per translation");
    imageCount += content?.images.length ?? 0;
  }
  if (imageCount > 100) throw new Error("Preview accepts at most 100 images total");
  const assets = assetsDirectory ? outsideRepo(assetsDirectory) : null;
  if (assets && !statSync(assets).isDirectory()) throw new Error("Invalid local asset directory");
  const server = createServer({ maxHeaderSize: 8192 }, (request, response) => {
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("X-Robots-Tag", "noindex, nofollow");
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("Referrer-Policy", "no-referrer");
    response.setHeader("Cross-Origin-Resource-Policy", "same-origin");
    response.setHeader("Cross-Origin-Opener-Policy", "same-origin");
    response.setHeader("Content-Security-Policy", "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'");
    const deny = (status = 403) => { response.writeHead(status, { "Content-Type": "text/plain; charset=utf-8" }); response.end("Preview unavailable"); };
    const authority = `127.0.0.1:${server.address().port}`;
    try { requireLocal(environment); } catch { return deny(); }
    if (request.socket.localAddress !== "127.0.0.1" || request.socket.remoteAddress !== "127.0.0.1" ||
      request.headers.host !== authority ||
      Object.keys(request.headers).some(key => key === "forwarded" || key === "via" || key.startsWith("x-forwarded-")) ||
      (request.headers.origin !== undefined && request.headers.origin !== `http://${authority}`) ||
      request.headers["sec-fetch-site"] === "cross-site") return deny();
    if (!["GET", "HEAD"].includes(request.method) || request.headers["transfer-encoding"] || request.headers["content-length"]) return deny(405);
    let url;
    try { url = new URL(request.url, `http://${authority}`); } catch { return deny(400); }
    if (url.origin !== `http://${authority}`) return deny();
    // Validate the raw path, before URL dot-segment/percent normalization can hide traversal.
    const rawPath = request.url.split("?")[0];
    if (rawPath === "/review-matrix.csv") {
      if (!multi || url.search) return deny(404);
      response.writeHead(200, { "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": 'attachment; filename="hanapure-draft-review-matrix.csv"' });
      return response.end(request.method === "HEAD" ? undefined : reviewMatrixCsv(records));
    }
    const detail = multi && /^\/draft\/(0|[1-9]\d*)$/.exec(rawPath);
    const selected = detail ? Number(detail[1]) : null;
    if (rawPath === "/" || detail) {
      if (detail && (!Number.isSafeInteger(selected) || selected >= records.length)) return deny(404);
      const values = url.searchParams.getAll("locale");
      const filters = url.searchParams.getAll("filter");
      if ([...url.searchParams.keys()].some(key => key !== "locale" && !(multi && key === "filter")) || values.length > 1 ||
        filters.length > 1 || (filters.length && !reviewFilters.includes(filters[0])) ||
        (values.length && !storefrontLocales.includes(values[0]))) return deny(400);
      response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      const locale = values[0] ?? "en";
      const filter = filters[0] ?? "all";
      const indexes = records.flatMap((record, index) => matchesReview(record, locale, filter) ? [index] : []);
      const html = multi && selected === null ? renderList(records, locale, indexes, filter) :
        render(records[selected ?? 0], locale, assets, selected, indexes, filter);
      return response.end(request.method === "HEAD" ? undefined : html);
    }
    const media = multi ? /^\/draft\/(0|[1-9]\d*)\/media\/(en|hu|ko)\/(0|[1-9]\d*)$/.exec(rawPath) :
      /^\/media\/(en|hu|ko)\/(0|[1-9]\d*)$/.exec(rawPath);
    const recordIndex = multi ? Number(media?.[1]) : 0;
    const locale = media?.[multi ? 2 : 1];
    const imageIndex = Number(media?.[multi ? 3 : 2]);
    const image = media && Number.isSafeInteger(recordIndex) && Number.isSafeInteger(imageIndex) &&
      records[recordIndex]?.translations[locale]?.images[imageIndex];
    const file = image && imageFile(assets, image.src);
    if (!file || url.search) return deny(404);
    try {
      response.writeHead(200, { "Content-Type": file.mime });
      response.end(request.method === "HEAD" ? undefined : readFileSync(file.file));
    } catch { response.destroy(); }
  });
  server.requestTimeout = 5000;
  await new Promise((accept, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", accept); });
  return { server, url: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((accept, reject) => server.close(error => error ? reject(error) : accept())) };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    requireLocal(process.env);
    const args = process.argv.slice(2);
    if (args.length !== 2 && args.length !== 4 || args[0] !== "--file" || (args.length === 4 && args[2] !== "--assets")) throw new Error("Use --file ABSOLUTE_PRIVATE_JSON [--assets ABSOLUTE_PRIVATE_ASSETS]");
    const source = outsideRepo(args[1]);
    if (!statSync(source).isFile() || statSync(source).size > 1_000_000) throw new Error("Invalid local draft file");
    const preview = await startDraftPreview({ draft: JSON.parse(readFileSync(source, "utf8")), assetsDirectory: args[3] });
    console.log(`DRAFT — NOT PUBLIC: ${preview.url}`);
    const stop = () => { void preview.close(); };
    process.once("SIGINT", stop); process.once("SIGTERM", stop);
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}

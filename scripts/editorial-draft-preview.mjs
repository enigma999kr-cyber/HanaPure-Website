import { createServer } from "node:http";
import { readFileSync, realpathSync, statSync } from "node:fs";
import { dirname, extname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { validateEditorialCatalogue } from "../lib/catalog/editorial-catalogue.ts";
import { storefrontLabels, storefrontLocales } from "../lib/storefront/localization.ts";

// Deliberately outside the Next route/import graph. One supplied draft, read-only.
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

function render(draft, locale, assets) {
  const content = draft.translations[locale];
  const labels = storefrontLabels[locale];
  const images = content?.images.map((image, index) => `<figure>${imageFile(assets, image.src)
    ? `<img src="/media/${locale}/${index}" alt="${escape(image.alt)}">`
    : `<p role="img" aria-label="${escape(image.alt)}">${escape(image.alt)}</p>`}
    <figcaption>${escape(image.src)}</figcaption></figure>`).join("") ?? "";
  return `<!doctype html><html lang="${locale}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
    <meta name="robots" content="noindex,nofollow"><title>DRAFT — NOT PUBLIC</title>
    <style>*{box-sizing:border-box}body{margin:0;background:#fcfaf7;color:#1c1a18;font-family:Arial,Helvetica,sans-serif}
    main{max-width:960px;margin:auto;padding:24px}nav{display:flex;flex-wrap:wrap;gap:20px;margin:24px 0}a{color:inherit;min-height:44px;display:inline-flex;align-items:center}
    a:focus-visible{outline:2px solid #1c1a18;outline-offset:4px}h1,p,dd,figcaption{overflow-wrap:anywhere;white-space:pre-wrap}
    .badge{background:#e4d4c2;padding:16px}.images{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,240px),1fr));gap:16px}
    figure{margin:0;min-width:0}img{width:100%;aspect-ratio:1;object-fit:contain;background:#fff}figcaption{color:#625e58}dd{margin:8px 0 20px}</style></head>
    <body><main><p class="badge">DRAFT — NOT PUBLIC</p><nav aria-label="${escape(labels.language)}">
    ${storefrontLocales.map(value => `<a href="/?locale=${value}" ${value === locale ? 'aria-current="page"' : ""}>${value.toUpperCase()}</a>`).join("")}</nav>
    <dl><dt>publicId</dt><dd>${escape(draft.publicId)}</dd><dt>slug</dt><dd>${escape(draft.slug)}</dd><dt>state</dt><dd>${escape(draft.state)}</dd></dl>
    <p>${escape(draft.brand)}</p><h1>${escape(content?.name || labels.details)}</h1>
    <p>${escape(content?.description ?? labels.missing)}</p><div class="images">${images}</div>
    ${content?.usage !== null && content?.usage !== undefined ? `<h2>${escape(labels.usage)}</h2><p>${escape(content.usage)}</p>` : ""}
    ${content?.caution !== null && content?.caution !== undefined ? `<h2>${escape(labels.caution)}</h2><p>${escape(content.caution)}</p>` : ""}
    </main></body></html>`;
}

export async function startDraftPreview({ draft, assetsDirectory, environment = process.env }) {
  requireLocal(environment);
  const validation = validateEditorialCatalogue([draft]);
  if (!validation.ok || validation.records[0].state !== "draft") throw new Error("Only one schema-valid draft may be previewed");
  const record = validation.records[0];
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
    if (url.pathname === "/") {
      const values = url.searchParams.getAll("locale");
      if ([...url.searchParams.keys()].some(key => key !== "locale") || values.length > 1 ||
        (values.length && !storefrontLocales.includes(values[0]))) return deny(400);
      response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      return response.end(request.method === "HEAD" ? undefined : render(record, values[0] ?? "en", assets));
    }
    const media = /^\/media\/(en|hu|ko)\/(\d+)$/.exec(url.pathname);
    const image = media && record.translations[media[1]]?.images[Number(media[2])];
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

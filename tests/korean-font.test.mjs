import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";
import ts from "typescript";
import { brotliDecompressSync } from "node:zlib";
import { createHash } from "node:crypto";
import { losslessWoff2 } from "../scripts/optimize-gowun-batang.mjs";

const repo = dirname(dirname(fileURLToPath(import.meta.url)));
// next/font is a build-time transform. The real generated CSS/loading is checked
// in the production browser; this mock tests the actual locale layout contract.
const fontMock = "data:text/javascript," + encodeURIComponent(`
  export let options;
  export default function localFont(value) {
    options = value;
    return { className: "test-gowun-batang" };
  }
`);
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "next/font/local") return { url: fontMock, shortCircuit: true };
    if (specifier === "next/navigation") return nextResolve("next/dist/client/components/navigation.react-server.js", context);
    if (specifier.startsWith("@/")) specifier = pathToFileURL(join(repo, specifier.slice(2))).href;
    try { return nextResolve(specifier, context); }
    catch (error) {
      if (error.code !== "ERR_MODULE_NOT_FOUND") throw error;
      return nextResolve(`${specifier}.ts`, context);
    }
  },
  load(url, context, nextLoad) {
    if (url.endsWith(".tsx")) return {
      format: "module", shortCircuit: true,
      source: ts.transpileModule(readFileSync(fileURLToPath(url), "utf8"), {
        compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
      }).outputText,
    };
    return nextLoad(url, context);
  },
});
const { default: LocaleLayout } = await import("../app/[locale]/layout.tsx");
const font = await import("next/font/local");

test("Gowun Batang is scoped to Korean locale and preserves children and language", async () => {
  const children = "unchanged content";
  for (const locale of ["en", "hu", "ko"]) {
    const element = await LocaleLayout({ children, params: Promise.resolve({ locale }) });
    assert.equal(element.type, "div");
    assert.equal(element.props.lang, locale);
    assert.equal(element.props.children, children);
    assert.equal(element.props.className, locale === "ko" ? "test-gowun-batang" : undefined);
  }
  await assert.rejects(LocaleLayout({ children, params: Promise.resolve({ locale: "fr" }) }),
    error => error.digest === "NEXT_HTTP_ERROR_FALLBACK;404");
});

test("local regular/bold font faces use swap without shared-locale preloading", () => {
  assert.deepEqual(font.options.src, [
    { path: "../fonts/gowun-batang/GowunBatang-Regular.woff2", weight: "400", style: "normal" },
    { path: "../fonts/gowun-batang/GowunBatang-Bold.woff2", weight: "700", style: "normal" },
  ]);
  assert.equal(font.options.display, "swap");
  assert.equal(font.options.preload, false);
  for (const face of font.options.src) {
    const bytes = readFileSync(join(repo, "app/[locale]", face.path));
    assert.equal(bytes.toString("ascii", 0, 4), "wOF2");
    assert.ok(bytes.length > 0);
  }
  const license = readFileSync(join(repo, "app/fonts/gowun-batang/OFL.txt"), "utf8");
  assert.ok(license.includes("Copyright 2021 The Gowun Batang Project Authors"));
  assert.ok(license.includes("SIL OPEN FONT LICENSE Version 1.1"));
});

test("delivered WOFF2 retains every original table, character mapping, outline, metric and license", () => {
  // Independent reader for the null-transform WOFF2 assets. All tables are
  // compared, including cmap, GSUB/GPOS, glyf, hinting, metrics and name/license.
  const knownTags = ["cmap", "head", "hhea", "hmtx", "maxp", "name", "OS/2", "post",
    "cvt ", "fpgm", "glyf", "loca", "prep", "CFF ", "VORG", "EBDT", "EBLC",
    "gasp", "hdmx", "kern", "LTSH", "PCLT", "VDMX", "vhea", "vmtx", "BASE",
    "GDEF", "GPOS", "GSUB"];
  const originalHashes = {
    Regular: "3d88c3ed57ba84f81d0c36772e6f01912cb6aa6cd2b66e29d81531fa15b3451e",
    Bold: "0d34417080b706037f3624ad2527f47f898dc333a5ff19262ef22ca064e2d580",
  };
  for (const weight of ["Regular", "Bold"]) {
    const base = join(repo, "app/fonts/gowun-batang", `GowunBatang-${weight}`);
    const original = readFileSync(base + ".ttf");
    assert.equal(createHash("sha256").update(original).digest("hex"), originalHashes[weight]);
    const output = readFileSync(base + ".woff2");
    assert.equal(output.readUInt32BE(8), output.length);
    assert.equal(output.readUInt32BE(4), original.readUInt32BE(0));
    const count = output.readUInt16BE(12);
    assert.equal(count, original.readUInt16BE(4));
    assert.equal(output.readUInt16BE(14), 0);
    assert.ok(output.subarray(28, 48).every(byte => byte === 0));
    let cursor = 48;
    const entries = [];
    for (let i = 0; i < count; i++) {
      const flags = output[cursor++];
      const tag = knownTags[flags & 63];
      assert.ok(tag, "Unexpected table tag");
      assert.equal(flags >> 6, ["glyf", "loca"].includes(tag) ? 3 : 0);
      let length = 0;
      let byte;
      do { byte = output[cursor++]; length = length * 128 + (byte & 127); } while (byte & 128);
      entries.push({ tag, length });
    }
    assert.equal(cursor + output.readUInt32BE(20), output.length);
    const decoded = brotliDecompressSync(output.subarray(cursor));
    let position = 0;
    for (const [i, entry] of entries.entries()) {
      const offset = 12 + i * 16;
      assert.equal(entry.tag, original.toString("ascii", offset, offset + 4));
      assert.equal(entry.length, original.readUInt32BE(offset + 12));
      const start = original.readUInt32BE(offset + 8);
      assert.deepEqual(decoded.subarray(position, position + entry.length),
        original.subarray(start, start + entry.length), `${weight} ${entry.tag} must remain byte-identical`);
      position += entry.length;
    }
    assert.equal(position, decoded.length);
    assert.ok(output.length < original.length * 0.65, "Meaningful payload reduction required");
  }
});

test("offline font conversion rejects unsupported or incomplete input", () => {
  assert.throws(() => losslessWoff2(Buffer.alloc(0)), /Missing sfnt header/);
  assert.throws(() => losslessWoff2(Buffer.from("ttcf00000000")), /Only single TrueType/);
  const truncated = Buffer.alloc(12); truncated.writeUInt32BE(0x00010000); truncated.writeUInt16BE(16, 4);
  assert.throws(() => losslessWoff2(truncated), /Invalid sfnt directory/);
});

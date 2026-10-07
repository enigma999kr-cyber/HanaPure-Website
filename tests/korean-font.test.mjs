import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";
import ts from "typescript";

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
    { path: "../fonts/gowun-batang/GowunBatang-Regular.ttf", weight: "400", style: "normal" },
    { path: "../fonts/gowun-batang/GowunBatang-Bold.ttf", weight: "700", style: "normal" },
  ]);
  assert.equal(font.options.display, "swap");
  assert.equal(font.options.preload, false);
  for (const face of font.options.src) {
    const bytes = readFileSync(join(repo, "app/[locale]", face.path));
    assert.equal(bytes.readUInt32BE(0), 0x00010000); // TrueType sfnt header.
    assert.ok(bytes.length > 0);
  }
  const license = readFileSync(join(repo, "app/fonts/gowun-batang/OFL.txt"), "utf8");
  assert.ok(license.includes("Copyright 2021 The Gowun Batang Project Authors"));
  assert.ok(license.includes("SIL OPEN FONT LICENSE Version 1.1"));
});

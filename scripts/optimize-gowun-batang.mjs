import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { brotliCompressSync, constants } from "node:zlib";
import { fileURLToPath, pathToFileURL } from "node:url";

// Offline asset generation only; no dependency or runtime conversion.
// W3C WOFF2 sections 3.2/4.1: null transforms preserve every original table.
// https://www.w3.org/TR/WOFF2/
const tags = ["cmap", "head", "hhea", "hmtx", "maxp", "name", "OS/2", "post",
  "cvt ", "fpgm", "glyf", "loca", "prep", "CFF ", "VORG", "EBDT", "EBLC",
  "gasp", "hdmx", "kern", "LTSH", "PCLT", "VDMX", "vhea", "vmtx", "BASE",
  "GDEF", "GPOS", "GSUB", "EBSC", "JSTF", "MATH", "CBDT", "CBLC", "COLR",
  "CPAL", "SVG ", "sbix", "acnt", "avar", "bdat", "bloc", "bsln", "cvar",
  "fdsc", "feat", "fmtx", "fvar", "gvar", "hsty", "just", "lcar", "mort",
  "morx", "opbd", "prop", "trak", "Zapf", "Silf", "Glat", "Gloc", "Feat", "Sill"];

function base128(value) {
  const bytes = [value & 127];
  while ((value = Math.floor(value / 128)) > 0) bytes.unshift((value & 127) | 128);
  return Buffer.from(bytes);
}

export function losslessWoff2(source) {
  assert.ok(source.length >= 12, "Missing sfnt header");
  assert.equal(source.readUInt32BE(0), 0x00010000, "Only single TrueType fonts are supported");
  const count = source.readUInt16BE(4);
  assert.ok(count > 0 && 12 + count * 16 <= source.length, "Invalid sfnt directory");
  const tables = [];
  const directory = [];
  let sfntSize = 12 + count * 16;
  let head;
  const seen = new Set();
  for (let i = 0; i < count; i++) {
    const entry = 12 + i * 16;
    const tag = source.toString("ascii", entry, entry + 4);
    const offset = source.readUInt32BE(entry + 8);
    const length = source.readUInt32BE(entry + 12);
    assert.ok(!seen.has(tag) && offset + length <= source.length, "Invalid sfnt table");
    seen.add(tag);
    const table = source.subarray(offset, offset + length);
    tables.push(table);
    sfntSize += Math.ceil(length / 4) * 4;
    if (tag === "head") head = table;
    const index = tags.indexOf(tag);
    // glyf/loca null transform uses version 3; all other tables use version 0.
    const flags = (index < 0 ? 63 : index) | (["glyf", "loca"].includes(tag) ? 192 : 0);
    directory.push(Buffer.from([flags]));
    if (index < 0) directory.push(Buffer.from(tag, "ascii"));
    directory.push(base128(length));
  }
  assert.ok(head && head.length >= 54 && seen.has("glyf") && seen.has("loca"), "Missing TrueType tables");
  assert.ok(!seen.has("DSIG"), "Signed fonts require a separate review");
  const compressed = brotliCompressSync(Buffer.concat(tables), { params: {
    [constants.BROTLI_PARAM_QUALITY]: 11,
    [constants.BROTLI_PARAM_MODE]: constants.BROTLI_MODE_FONT,
  } });
  const entries = Buffer.concat(directory);
  const header = Buffer.alloc(48);
  header.write("wOF2", 0, "ascii");
  header.writeUInt32BE(source.readUInt32BE(0), 4);
  header.writeUInt32BE(48 + entries.length + compressed.length, 8);
  header.writeUInt16BE(count, 12);
  header.writeUInt32BE(sfntSize, 16);
  header.writeUInt32BE(compressed.length, 20);
  header.writeUInt16BE(head.readUInt16BE(4), 24);
  header.writeUInt16BE(head.readUInt16BE(6), 26);
  return Buffer.concat([header, entries, compressed]);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  for (const weight of ["Regular", "Bold"]) {
    const base = new URL(`../app/fonts/gowun-batang/GowunBatang-${weight}`, import.meta.url);
    const source = readFileSync(fileURLToPath(base) + ".ttf");
    const output = losslessWoff2(source);
    assert.ok(output.length < source.length, "Conversion did not reduce payload");
    writeFileSync(fileURLToPath(base) + ".woff2", output);
    console.log(`${weight}: ${source.length} -> ${output.length} bytes`);
  }
}

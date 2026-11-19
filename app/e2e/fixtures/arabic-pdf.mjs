// Builds arabic.pdf for the e2e tests without a font-shaping dependency: an Arabic font from @fontsource is embedded
// as a CID TrueType font and each line is written glyph by glyph, the way many Arabic PDF generators do it:
//   - page 1: text is written as Arabic PRESENTATION FORMS (U+FE70-FEFF), in VISUAL (left-to-right) order;
//   - page 2: the same kind of text with a ToUnicode map that gives the BASE letters, still in visual glyph order;
//   - page 3: the base letters with diacritics (tashkeel) and Arabic-Indic digits;
//   - page 4: every word is its own positioned text run, left to right, so a reader sees the words in visual order.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { inflateSync } from 'node:zlib';
import { PDFDocument, PDFName, PDFNumber, PDFString } from 'pdf-lib';

const require = createRequire(import.meta.url);

/** WOFF 1 -> plain sfnt (TrueType), so it can be embedded as FontFile2. */
function woffToSfnt(woff) {
  const flavor = woff.readUInt32BE(4);
  const n = woff.readUInt16BE(12);
  const tables = [];
  for (let i = 0; i < n; i++) {
    const o = 44 + i * 20;
    const off = woff.readUInt32BE(o + 4);
    const clen = woff.readUInt32BE(o + 8);
    const olen = woff.readUInt32BE(o + 12);
    const raw = woff.subarray(off, off + clen);
    tables.push({ tag: woff.subarray(o, o + 4), checksum: woff.readUInt32BE(o + 16), data: clen < olen ? inflateSync(raw) : raw });
  }
  const headerLen = 12 + n * 16;
  let total = headerLen;
  const offsets = tables.map((t) => {
    const at = total;
    total += (t.data.length + 3) & ~3;
    return at;
  });
  const out = Buffer.alloc(total);
  out.writeUInt32BE(flavor, 0);
  out.writeUInt16BE(n, 4);
  const pow = 2 ** Math.floor(Math.log2(n));
  out.writeUInt16BE(pow * 16, 6);
  out.writeUInt16BE(Math.floor(Math.log2(n)), 8);
  out.writeUInt16BE(n * 16 - pow * 16, 10);
  tables.forEach((t, i) => {
    const o = 12 + i * 16;
    t.tag.copy(out, o);
    out.writeUInt32BE(t.checksum, o + 4);
    out.writeUInt32BE(offsets[i], o + 8);
    out.writeUInt32BE(t.data.length, o + 12);
    t.data.copy(out, offsets[i]);
  });
  return out;
}

function table(sfnt, tag) {
  const n = sfnt.readUInt16BE(4);
  for (let i = 0; i < n; i++) {
    const o = 12 + i * 16;
    if (sfnt.toString('latin1', o, o + 4) === tag) return sfnt.subarray(sfnt.readUInt32BE(o + 8), sfnt.readUInt32BE(o + 8) + sfnt.readUInt32BE(o + 12));
  }
  throw new Error(`no ${tag} table`);
}

/** code point -> glyph id, from a format 4 or 12 Unicode cmap subtable. */
function readCmap(sfnt) {
  const cmap = table(sfnt, 'cmap');
  const count = cmap.readUInt16BE(2);
  const map = new Map();
  for (let i = 0; i < count; i++) {
    const off = cmap.readUInt32BE(4 + i * 8 + 4);
    const format = cmap.readUInt16BE(off);
    if (format === 4) {
      const segX2 = cmap.readUInt16BE(off + 6);
      const seg = segX2 / 2;
      const ends = off + 14;
      const starts = ends + segX2 + 2;
      const deltas = starts + segX2;
      const ranges = deltas + segX2;
      for (let s = 0; s < seg; s++) {
        const end = cmap.readUInt16BE(ends + s * 2);
        const start = cmap.readUInt16BE(starts + s * 2);
        const delta = cmap.readInt16BE(deltas + s * 2);
        const range = cmap.readUInt16BE(ranges + s * 2);
        for (let c = start; c <= end && c !== 0xffff; c++) {
          let g;
          if (range === 0) g = (c + delta) & 0xffff;
          else {
            const at = ranges + s * 2 + range + (c - start) * 2;
            g = cmap.readUInt16BE(at);
            if (g !== 0) g = (g + delta) & 0xffff;
          }
          if (g !== 0 && !map.has(c)) map.set(c, g);
        }
      }
    } else if (format === 12) {
      const groups = cmap.readUInt32BE(off + 12);
      for (let g = 0; g < groups; g++) {
        const o = off + 16 + g * 12;
        const start = cmap.readUInt32BE(o);
        const end = cmap.readUInt32BE(o + 4);
        const gid = cmap.readUInt32BE(o + 8);
        for (let c = start; c <= end; c++) if (!map.has(c)) map.set(c, gid + c - start);
      }
    }
  }
  return map;
}

function readMetrics(sfnt) {
  const head = table(sfnt, 'head');
  const hhea = table(sfnt, 'hhea');
  const hmtx = table(sfnt, 'hmtx');
  const upem = head.readUInt16BE(18);
  const nH = hhea.readUInt16BE(34);
  return {
    upem,
    bbox: [head.readInt16BE(36), head.readInt16BE(38), head.readInt16BE(40), head.readInt16BE(42)].map((v) => Math.round((v * 1000) / upem)),
    ascent: Math.round((hhea.readInt16BE(4) * 1000) / upem),
    descent: Math.round((hhea.readInt16BE(6) * 1000) / upem),
    width: (gid) => Math.round(((gid < nH ? hmtx.readUInt16BE(gid * 4) : hmtx.readUInt16BE((nH - 1) * 4)) * 1000) / upem),
  };
}

// [isolated, final, initial, medial] presentation forms; right-joining letters have only the first two.
const FORMS = {
  'ء': [0xfe80], 'آ': [0xfe81, 0xfe82], 'أ': [0xfe83, 0xfe84], 'ؤ': [0xfe85, 0xfe86],
  'إ': [0xfe87, 0xfe88], 'ئ': [0xfe89, 0xfe8a, 0xfe8b, 0xfe8c], 'ا': [0xfe8d, 0xfe8e],
  'ب': [0xfe8f, 0xfe90, 0xfe91, 0xfe92], 'ة': [0xfe93, 0xfe94], 'ت': [0xfe95, 0xfe96, 0xfe97, 0xfe98],
  'ث': [0xfe99, 0xfe9a, 0xfe9b, 0xfe9c], 'ج': [0xfe9d, 0xfe9e, 0xfe9f, 0xfea0], 'ح': [0xfea1, 0xfea2, 0xfea3, 0xfea4],
  'خ': [0xfea5, 0xfea6, 0xfea7, 0xfea8], 'د': [0xfea9, 0xfeaa], 'ذ': [0xfeab, 0xfeac], 'ر': [0xfead, 0xfeae],
  'ز': [0xfeaf, 0xfeb0], 'س': [0xfeb1, 0xfeb2, 0xfeb3, 0xfeb4], 'ش': [0xfeb5, 0xfeb6, 0xfeb7, 0xfeb8],
  'ص': [0xfeb9, 0xfeba, 0xfebb, 0xfebc], 'ض': [0xfebd, 0xfebe, 0xfebf, 0xfec0], 'ط': [0xfec1, 0xfec2, 0xfec3, 0xfec4],
  'ظ': [0xfec5, 0xfec6, 0xfec7, 0xfec8], 'ع': [0xfec9, 0xfeca, 0xfecb, 0xfecc], 'غ': [0xfecd, 0xfece, 0xfecf, 0xfed0],
  'ف': [0xfed1, 0xfed2, 0xfed3, 0xfed4], 'ق': [0xfed5, 0xfed6, 0xfed7, 0xfed8], 'ك': [0xfed9, 0xfeda, 0xfedb, 0xfedc],
  'ل': [0xfedd, 0xfede, 0xfedf, 0xfee0], 'م': [0xfee1, 0xfee2, 0xfee3, 0xfee4], 'ن': [0xfee5, 0xfee6, 0xfee7, 0xfee8],
  'ه': [0xfee9, 0xfeea, 0xfeeb, 0xfeec], 'و': [0xfeed, 0xfeee], 'ى': [0xfeef, 0xfef0], 'ي': [0xfef1, 0xfef2, 0xfef3, 0xfef4],
};
const MARK = /[ً-ٰٟ]/;
const joinsNext = (ch) => (FORMS[ch]?.length ?? 0) === 4;

/** Logical Arabic word -> glyph descriptors [{ glyphChar, base }] in LOGICAL order, using presentation forms. */
function shape(word) {
  const letters = [...word];
  const out = [];
  let prevJoins = false;
  for (let i = 0; i < letters.length; i++) {
    const ch = letters[i];
    if (MARK.test(ch)) {
      out.push({ code: ch.codePointAt(0), base: ch });
      continue;
    }
    const forms = FORMS[ch];
    if (!forms) {
      out.push({ code: ch.codePointAt(0), base: ch });
      prevJoins = false;
      continue;
    }
    let next = i + 1;
    while (next < letters.length && MARK.test(letters[next])) next++;
    const nextJoined = joinsNext(ch) && next < letters.length && FORMS[letters[next]] !== undefined;
    let form;
    if (forms.length === 1) form = forms[0];
    else if (prevJoins && nextJoined) form = forms[3];
    else if (prevJoins) form = forms[1];
    else if (nextJoined) form = forms[2];
    else form = forms[0];
    out.push({ code: form, base: ch });
    prevJoins = joinsNext(ch) || false;
  }
  return out;
}

/**
 * A logical line -> its words as glyph lists in VISUAL left-to-right order: words reversed, the clusters (a letter and its marks)
 * of an Arabic word reversed, digit runs kept. Marks stay after their letter, as most generators write them.
 */
function visualWords(line) {
  const words = [];
  for (const tok of line.split(' ').reverse()) {
    if (/^[\u0660-\u0669\d]+$/.test(tok)) {
      words.push([...tok].map((ch) => ({ code: ch.codePointAt(0), base: ch })));
      continue;
    }
    const g = shape(tok); // always the shaped glyphs; `presentation` only decides what ToUnicode says each one is
    const clusters = [];
    for (const x of g) {
      if (MARK.test(x.base) && clusters.length > 0) clusters.at(-1).push(x);
      else clusters.push([x]);
    }
    words.push(clusters.reverse().flat());
  }
  return words;
}

const DEFAULT_GAP = 7;

/** An Arabic PDF with the pages described at the top. Returns the bytes. */
export async function buildArabicPdf(pages) {
  const woff = readFileSync(require.resolve('@fontsource/ibm-plex-sans-arabic/files/ibm-plex-sans-arabic-arabic-400-normal.woff'));
  const sfnt = woffToSfnt(woff);
  const cmap = readCmap(sfnt);
  const metrics = readMetrics(sfnt);

  const doc = await PDFDocument.create();
  const { context } = doc;
  const fontFile = context.register(context.flateStream(sfnt, { Length1: sfnt.length }));
  const descriptor = context.register(
    context.obj({
      Type: 'FontDescriptor', FontName: 'ABCDEF+PlexArabic', Flags: 4, FontBBox: metrics.bbox, ItalicAngle: 0,
      Ascent: metrics.ascent, Descent: metrics.descent, CapHeight: metrics.ascent, StemV: 80, FontFile2: fontFile,
    }),
  );

  const widths = new Map();
  const toUni = (hexOf) => {
    const rows = [...widths.keys()].map((gid) => `<${gid.toString(16).padStart(4, '0')}> <${hexOf(gid)}>`);
    return `/CIDInit /ProcSet findresource begin 12 dict begin begincmap /CMapName /Adobe-Identity-UCS def /CMapType 2 def 1 begincodespacerange <0000> <FFFF> endcodespacerange ${rows.length} beginbfchar\n${rows.join('\n')}\nendbfchar endcmap CMapName currentdict /CMap defineresource pop end end`;
  };

  // Pass 1: lay out every page so the width and ToUnicode tables know the glyphs used.
  const laid = pages.map((p) =>
    p.lines.map((line) => {
      const words = visualWords(line).map((w) =>
        w.map((g) => {
          const gid = cmap.get(g.code);
          if (gid === undefined) throw new Error(`font has no glyph for U+${g.code.toString(16)}`);
          widths.set(gid, metrics.width(gid));
          return { ...g, gid };
        }),
      );
      const space = cmap.get(0x20);
      widths.set(space, metrics.width(space));
      // One text run per line, or (split) one positioned run per word.
      if (p.split) return words;
      const run = words.flatMap((w, k) => (k === 0 ? w : [{ code: 0x20, base: ' ', gid: space }, ...w]));
      return [run];
    }),
  );

  const uniByGid = { presentation: new Map(), base: new Map() };
  laid.forEach((lines, i) => {
    const kind = pages[i].mode === 'presentation' ? 'presentation' : 'base';
    for (const runs of lines) for (const glyphs of runs) for (const g of glyphs) uniByGid[kind].set(g.gid, kind === 'presentation' ? g.code : g.base.codePointAt(0));
  });

  const wArray = [...widths.entries()].flatMap(([gid, w]) => [PDFNumber.of(gid), context.obj([PDFNumber.of(w)])]);
  const cid = context.register(
    context.obj({
      Type: 'Font', Subtype: 'CIDFontType2', BaseFont: 'ABCDEF+PlexArabic',
      CIDSystemInfo: { Registry: PDFString.of('Adobe'), Ordering: PDFString.of('Identity'), Supplement: 0 },
      FontDescriptor: descriptor, DW: 1000, W: context.obj(wArray), CIDToGIDMap: 'Identity',
    }),
  );
  const type0 = (kind) => {
    const hexOf = (gid) => (uniByGid[kind].get(gid) ?? 0x20).toString(16).padStart(4, '0');
    const tu = context.register(context.flateStream(Buffer.from(toUni(hexOf))));
    return context.register(
      context.obj({ Type: 'Font', Subtype: 'Type0', BaseFont: 'ABCDEF+PlexArabic', Encoding: 'Identity-H', DescendantFonts: [cid], ToUnicode: tu }),
    );
  };
  const fonts = { presentation: type0('presentation'), base: type0('base') };

  pages.forEach((p, i) => {
    const page = doc.addPage([420, 595]);
    const kind = p.mode === 'presentation' ? 'presentation' : 'base';
    page.node.setFontDictionary(PDFName.of('F1'), fonts[kind]);
    const size = 22;
    const gap = p.gap ?? DEFAULT_GAP;
    let y = 520;
    let content = 'BT\n';
    const advance = (glyphs) => glyphs.reduce((sum, g) => sum + widths.get(g.gid), 0) * (size / 1000);
    for (const runs of laid[i]) {
      // Right-aligned at x = 380: Arabic starts at the right margin. A split line puts each word's run where it belongs.
      const total = runs.reduce((sum, r, k) => sum + advance(r) + (k > 0 ? gap : 0), 0);
      let x = 380 - total;
      for (const glyphs of runs) {
        const hex = glyphs.map((g) => g.gid.toString(16).padStart(4, '0')).join('');
        content += `/F1 ${size} Tf 1 0 0 1 ${x.toFixed(2)} ${y} Tm <${hex}> Tj\n`;
        x += advance(glyphs) + gap;
      }
      y -= 40;
    }
    content += 'ET';
    page.node.set(PDFName.of('Contents'), context.register(context.flateStream(Buffer.from(content))));
  });
  doc.setTitle('Arabic Book');
  doc.setAuthor('Test Author');
  return doc.save();
}

// Writes a many-page Arabic PDF for performance tests: node heavy-arabic.mjs <out> [pages] [fontPerPage] [dense]
// With fontPerPage=1 every page embeds its own copy of the font, the way many scanned/typeset Arabic books do
// (one subset per page): pdf.js then holds one decoded font and one FontFace per page.
import { writeFileSync } from 'node:fs';
import { PDFDocument } from 'pdf-lib';
import { buildArabicPdf } from './arabic-pdf.mjs';

const [out, count = '160', fontPerPage = '0', dense = '0'] = process.argv.slice(2);
const lines = [
  'العلم نور والجهل ظلام', 'خير جليس في الزمان كتاب', 'نقرأ كتابا جديدا كل أسبوع في الحياة', 'الجميلة والهادئة',
  'طلب العلم فريضة على كل مسلم', 'الكتاب صديق وفي', 'القراءة غذاء العقل والروح', 'من جد وجد ومن زرع حصد',
  'العلم في الصغر كالنقش على الحجر', 'اطلبوا العلم من المهد إلى اللحد', 'الوقت كالسيف إن لم تقطعه قطعك',
  'لا تؤجل عمل اليوم إلى الغد', 'الصديق وقت الضيق', 'خير الكلام ما قل ودل',
];
// dense: a typeset book page, small type, ~28 words a line and every word its own text item (about 1 000 a page), like the
// Arabic books that carry 1 500+ text items a page.
const pageOf = (i) =>
  dense === '1'
    ? { mode: 'presentation', split: true, size: 9, leading: 14, top: 560, gap: 6, lines: Array.from({ length: 38 }, (_, k) => [0, 1, 2].map((j) => lines[(i + k + j) % lines.length]).join(' ')) }
    : { mode: 'base', lines: Array.from({ length: 13 }, (_, k) => lines[(i + k) % lines.length]) };
const n = Number(count);

if (fontPerPage === '1') {
  const merged = await PDFDocument.create();
  for (let i = 0; i < n; i++) {
    const one = await PDFDocument.load(await buildArabicPdf([pageOf(i)]));
    const [p] = await merged.copyPages(one, [0]);
    merged.addPage(p);
  }
  writeFileSync(out, await merged.save());
} else {
  writeFileSync(out, await buildArabicPdf(Array.from({ length: n }, (_, i) => pageOf(i))));
}

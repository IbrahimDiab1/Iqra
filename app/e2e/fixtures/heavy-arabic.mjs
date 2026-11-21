// Writes a many-page Arabic PDF for performance tests: node heavy-arabic.mjs <out> [pages] [fontPerPage]
// With fontPerPage=1 every page embeds its own copy of the font, the way many scanned/typeset Arabic books do
// (one subset per page): pdf.js then holds one decoded font and one FontFace per page.
import { writeFileSync } from 'node:fs';
import { PDFDocument } from 'pdf-lib';
import { buildArabicPdf } from './arabic-pdf.mjs';

const [out, count = '160', fontPerPage = '0'] = process.argv.slice(2);
const lines = [
  'العلم نور والجهل ظلام', 'خير جليس في الزمان كتاب', 'نقرأ كتابا جديدا كل أسبوع في الحياة', 'الجميلة والهادئة',
  'طلب العلم فريضة على كل مسلم', 'الكتاب صديق وفي', 'القراءة غذاء العقل والروح', 'من جد وجد ومن زرع حصد',
  'العلم في الصغر كالنقش على الحجر', 'اطلبوا العلم من المهد إلى اللحد', 'الوقت كالسيف إن لم تقطعه قطعك',
  'لا تؤجل عمل اليوم إلى الغد', 'الصديق وقت الضيق', 'خير الكلام ما قل ودل',
];
const pageOf = (i) => ({ mode: 'base', lines: Array.from({ length: 13 }, (_, k) => lines[(i + k) % lines.length]) });
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

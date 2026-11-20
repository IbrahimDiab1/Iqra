// Writes the PDFs the e2e tests upload. Run: node e2e/fixtures/make-fixtures.mjs
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PDFDocument, PDFHexString, PDFName, StandardFonts } from 'pdf-lib';

const here = dirname(fileURLToPath(import.meta.url));

const doc = await PDFDocument.create();
const font = await doc.embedFont(StandardFonts.Helvetica);
for (let n = 1; n <= 5; n++) {
  const page = doc.addPage([420, 595]);
  page.drawText(`Page ${n}`, { x: 40, y: 520, size: 36, font });
}
doc.setTitle('Sample Book');
doc.setAuthor('Test Author');
writeFileSync(join(here, 'sample.pdf'), await doc.save());

writeFileSync(join(here, 'broken.pdf'), 'not a pdf');

// outline.pdf: 12 pages, "Chapter N, page P" (chapter 1 = pages 1-4, 2 = 5-8, 3 = 9-12), with a real /Outlines tree.
{
  const outlineDoc = await PDFDocument.create();
  const outlineFont = await outlineDoc.embedFont(StandardFonts.Helvetica);
  for (let p = 1; p <= 12; p++) {
    const page = outlineDoc.addPage([420, 595]);
    page.drawText(`Chapter ${Math.ceil(p / 4)}, page ${p}`, { x: 40, y: 520, size: 28, font: outlineFont });
  }
  outlineDoc.setTitle('Outline Book');
  outlineDoc.setAuthor('Test Author');

  const { context } = outlineDoc;
  const chapters = [1, 5, 9];
  const rootRef = context.nextRef();
  const itemRefs = chapters.map(() => context.nextRef());
  chapters.forEach((pageNo, i) => {
    const item = context.obj({
      Title: PDFHexString.fromText(`Chapter ${i + 1}`),
      Parent: rootRef,
      Dest: [outlineDoc.getPage(pageNo - 1).ref, PDFName.of('Fit')],
    });
    if (i > 0) item.set(PDFName.of('Prev'), itemRefs[i - 1]);
    if (i < chapters.length - 1) item.set(PDFName.of('Next'), itemRefs[i + 1]);
    context.assign(itemRefs[i], item);
  });
  context.assign(
    rootRef,
    context.obj({ Type: 'Outlines', First: itemRefs[0], Last: itemRefs[itemRefs.length - 1], Count: chapters.length }),
  );
  outlineDoc.catalog.set(PDFName.of('Outlines'), rootRef);
  writeFileSync(join(here, 'outline.pdf'), await outlineDoc.save());
}

// arabic.pdf: 4 pages of Arabic, written glyph by glyph (see arabic-pdf.mjs for what each page exercises).
{
  const { buildArabicPdf } = await import('./arabic-pdf.mjs');
  writeFileSync(
    join(here, 'arabic.pdf'),
    await buildArabicPdf([
      { mode: 'presentation', lines: ['العلم نور والجهل ظلام', 'خير جليس في الزمان كتاب', 'نقرأ كتابا جديدا كل أسبوع في الحياة', 'الجميلة والهادئة'] },
      { mode: 'base', lines: ['طلب العلم فريضة على كل مسلم', 'الكتاب صديق وفي'] },
      { mode: 'base', lines: ['الْكِتَابُ نُورٌ ١٢٣ صفحة', 'بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ'] },
      { mode: 'base', split: true, gap: 30, lines: ['القراءة غذاء العقل والروح', 'من جد وجد ومن زرع حصد'] },
    ]),
  );
}

// ccitt.pdf: a scanned-style page (see ccitt-pdf.mjs).
writeFileSync(join(here, 'ccitt.pdf'), await (await import('./ccitt-pdf.mjs')).buildCcittPdf());

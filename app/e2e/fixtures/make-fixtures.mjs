// Writes the PDFs the e2e tests upload. Run: node e2e/fixtures/make-fixtures.mjs
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PDFDocument, StandardFonts } from 'pdf-lib';

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

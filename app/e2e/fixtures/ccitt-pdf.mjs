// ccitt.pdf: 2 pages. Page 2 is scanner-style: one 1-bit DeviceGray image with /CCITTFaxDecode (Group 4), the way
// iLovePDF/scanner output stores a page. pdf.js 6.x decodes those through its JBIG2 wasm, so it needs `wasmUrl`
// (without it the page rendered blank). A tiny text line sits on top, like the owner's file has.
//
// The bitmap is a black right triangle, 64 px wide and 21 rows. In G4 every row is "VL3, V0": the black run
// starts 3 px further left than in the row above, and ends at the edge of the line.
import {
  PDFDocument,
  PDFRawStream,
  StandardFonts,
  concatTransformationMatrix,
  drawObject,
  popGraphicsState,
  pushGraphicsState,
} from 'pdf-lib';

const W = 64;
const H = 21;

function g4Bytes() {
  let bits = '';
  for (let r = 0; r < H; r++) bits += '00000101';
  bits += '000000000001000000000001'; // end of facsimile block
  const bytes = new Uint8Array(Math.ceil(bits.length / 8));
  for (let i = 0; i < bits.length; i++) if (bits[i] === '1') bytes[i >> 3] |= 0x80 >> (i & 7);
  return bytes;
}

export async function buildCcittPdf() {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  doc.addPage([420, 595]).drawText('Cover', { x: 40, y: 520, size: 36, font });

  const scan = doc.addPage([420, 595]);
  const { context } = doc;
  const imageRef = context.register(
    PDFRawStream.of(
      context.obj({
        Type: 'XObject',
        Subtype: 'Image',
        Width: W,
        Height: H,
        ColorSpace: 'DeviceGray',
        BitsPerComponent: 1,
        Filter: 'CCITTFaxDecode',
        DecodeParms: { K: -1, Columns: W, Rows: H },
      }),
      g4Bytes(),
    ),
  );
  const name = scan.node.newXObject('Scan', imageRef);
  scan.pushOperators(pushGraphicsState(), concatTransformationMatrix(420, 0, 0, 595, 0, 0), drawObject(name), popGraphicsState());
  scan.drawText('http://scan.example/', { x: 20, y: 10, size: 6, font });
  doc.setTitle('Scan Book');
  doc.setAuthor('Test Author');
  return doc.save();
}

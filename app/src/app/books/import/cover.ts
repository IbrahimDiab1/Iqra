import { openPdf } from './pdf-meta';

const COVER_WIDTH_PX = 240;

/** Renders page 1 as a JPEG cover, 240 px wide. */
export async function renderCover(blob: Blob): Promise<Blob> {
  const task = await openPdf(blob);
  try {
    const doc = await task.promise;
    const page = await doc.getPage(1);
    const natural = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: COVER_WIDTH_PX / natural.width });

    const canvas = document.createElement('canvas');
    canvas.width = Math.round(viewport.width);
    canvas.height = Math.round(viewport.height);
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Canvas 2D context is unavailable');
    await page.render({ canvas, canvasContext: context, viewport }).promise;
    page.cleanup();

    const jpeg = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.8));
    if (!jpeg) throw new Error('Cover could not be encoded');
    return jpeg;
  } finally {
    await task.destroy();
  }
}

export interface Segment {
  label: 'books' | 'other' | 'free' | 'downloads' | 'data' | 'app';
  bytes: number;
  fraction: number;
}

/** A finite, non-negative byte count; anything else counts as zero. */
function clean(n: number | undefined): number {
  return typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : 0;
}

function segment(label: Segment['label'], bytes: number, total: number): Segment {
  return { label, bytes, fraction: total > 0 ? bytes / total : 0 };
}

/**
 * Splits Drive usage into the books Iqra holds, everything else, and free space.
 * A limit that is missing or not finite (unlimited storage) has no free segment and the
 * fractions are shares of the usage. Over-quota usage still adds up to at most 100 %.
 */
export function driveSegments(q: { limit: number; usage: number }, booksBytes: number): Segment[] {
  const usage = clean(q.usage);
  const books = Math.min(clean(booksBytes), usage);
  const other = usage - books;
  const unlimited = !Number.isFinite(q.limit);
  const limit = unlimited ? 0 : clean(q.limit);
  const free = unlimited ? 0 : Math.max(0, limit - usage);
  const total = unlimited ? usage : Math.max(limit, usage);
  if (total <= 0) return [];
  const segs = [segment('books', books, total), segment('other', other, total)];
  if (!unlimited) segs.push(segment('free', free, total));
  return segs;
}

/**
 * Splits what this device stores into downloaded PDFs and everything else Iqra keeps
 * (the database, caches and app files). Fractions are shares of the browser quota when
 * it is known, otherwise of the usage. Without an estimate only downloads are shown.
 */
export function deviceSegments(est: { usage?: number; quota?: number } | null, downloadedBytes: number): Segment[] {
  const downloaded = clean(downloadedBytes);
  if (!est || !Number.isFinite(est.usage ?? NaN)) {
    return downloaded > 0 ? [segment('downloads', downloaded, downloaded)] : [];
  }
  const usage = clean(est.usage);
  const downloads = Math.min(downloaded, usage);
  const data = usage - downloads;
  const quota = clean(est.quota);
  const total = quota > 0 ? Math.max(quota, usage) : usage;
  if (total <= 0) return [];
  return [segment('downloads', downloads, total), segment('data', data, total)];
}

const UNITS = ['B', 'KB', 'MB', 'GB', 'TB'] as const;

/** '0 B', '1.4 MB', '12 GB'. Negative, NaN or infinite counts as '0 B'. */
export function formatBytes(n: number): string {
  let value = clean(n);
  let unit = 0;
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024;
    unit++;
  }
  let text = unit === 0 || value >= 10 ? Math.round(value).toString() : (Math.round(value * 10) / 10).toString();
  if (Number(text) >= 1024 && unit < UNITS.length - 1) {
    text = '1';
    unit++;
  }
  return `${text} ${UNITS[unit]}`;
}

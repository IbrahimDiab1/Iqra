import { describe, expect, it } from 'vitest';
import { crc32, zipFiles } from './zip';

const utf8 = (s: string) => new TextEncoder().encode(s);

/** A tiny reader for store-only zips: walks the local headers. */
function unzip(zip: Uint8Array): { name: string; data: Uint8Array; flags: number; method: number; crc: number }[] {
  const v = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  const out = [];
  let p = 0;
  while (v.getUint32(p, true) === 0x04034b50) {
    const flags = v.getUint16(p + 6, true);
    const method = v.getUint16(p + 8, true);
    const crc = v.getUint32(p + 14, true);
    const size = v.getUint32(p + 18, true);
    const nameLen = v.getUint16(p + 26, true);
    const extraLen = v.getUint16(p + 28, true);
    const name = new TextDecoder().decode(zip.subarray(p + 30, p + 30 + nameLen));
    const start = p + 30 + nameLen + extraLen;
    out.push({ name, data: zip.slice(start, start + size), flags, method, crc });
    p = start + size;
  }
  return out;
}

describe('crc32', () => {
  it('matches the standard check value', () => {
    expect(crc32(utf8('123456789'))).toBe(0xcbf43926);
  });
  it('is 0 for empty data', () => {
    expect(crc32(new Uint8Array())).toBe(0);
  });
});

describe('zipFiles', () => {
  it('round-trips two files with names and bytes intact, including Arabic names', () => {
    const files = [
      { name: 'Dune.md', data: utf8('# Dune\n') },
      { name: 'كتاب.md', data: utf8('# كتاب\n\nنص عربي') },
    ];
    const zip = zipFiles(files, new Date(2026, 10, 19, 13, 30, 10));
    const back = unzip(zip);
    expect(back.map((f) => f.name)).toEqual(['Dune.md', 'كتاب.md']);
    expect(back.map((f) => Array.from(f.data))).toEqual(files.map((f) => Array.from(f.data)));
    for (const f of back) {
      expect(f.method).toBe(0);
      expect(f.flags & 0x0800).toBe(0x0800);
      expect(f.crc).toBe(crc32(f.data));
    }
  });

  it('writes a central directory and end record that count the files', () => {
    const zip = zipFiles([{ name: 'a.md', data: utf8('a') }, { name: 'b.md', data: utf8('b') }]);
    const v = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
    const end = zip.length - 22;
    expect(v.getUint32(end, true)).toBe(0x06054b50);
    expect(v.getUint16(end + 8, true)).toBe(2);
    expect(v.getUint16(end + 10, true)).toBe(2);
    const cdOffset = v.getUint32(end + 16, true);
    expect(v.getUint32(cdOffset, true)).toBe(0x02014b50);
  });

  it('encodes the date and time in DOS format', () => {
    const zip = zipFiles([{ name: 'a.md', data: utf8('a') }], new Date(2026, 10, 19, 13, 30, 10));
    const v = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
    expect(v.getUint16(10, true)).toBe((13 << 11) | (30 << 5) | 5);
    expect(v.getUint16(12, true)).toBe(((2026 - 1980) << 9) | (11 << 5) | 19);
  });

  it('makes an empty but valid archive', () => {
    const zip = zipFiles([]);
    expect(zip.length).toBe(22);
  });
});

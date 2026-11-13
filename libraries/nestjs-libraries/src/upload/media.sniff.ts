// Server-side content sniffing for uploads. The client-supplied mimetype and
// file name are never trusted: the type comes from the file's own leading
// bytes, and the stored extension comes from this fixed mapping, so a payload
// such as an HTML file sent as image/png is rejected instead of being served.

export interface DetectedMedia {
  mime: string;
  ext: string;
}

const startsWith = (buffer: Buffer, bytes: number[], offset = 0) =>
  buffer.length >= offset + bytes.length &&
  bytes.every((byte, i) => buffer[offset + i] === byte);

const ascii = (buffer: Buffer, start: number, end: number) =>
  buffer.length >= end ? buffer.subarray(start, end).toString('latin1') : '';

const ftypBrand = (buffer: Buffer) =>
  ascii(buffer, 4, 8) === 'ftyp' ? ascii(buffer, 8, 12) : '';

const SIGNATURES: Array<{
  mime: string;
  ext: string;
  test: (buffer: Buffer) => boolean;
}> = [
  {
    mime: 'image/jpeg',
    ext: 'jpg',
    test: (b) => startsWith(b, [0xff, 0xd8, 0xff]),
  },
  {
    mime: 'image/png',
    ext: 'png',
    test: (b) =>
      startsWith(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  },
  {
    mime: 'image/gif',
    ext: 'gif',
    test: (b) => ascii(b, 0, 4) === 'GIF8',
  },
  {
    mime: 'image/webp',
    ext: 'webp',
    test: (b) => ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 12) === 'WEBP',
  },
  {
    mime: 'image/bmp',
    ext: 'bmp',
    test: (b) => ascii(b, 0, 2) === 'BM',
  },
  {
    mime: 'image/tiff',
    ext: 'tiff',
    test: (b) =>
      startsWith(b, [0x49, 0x49, 0x2a, 0x00]) ||
      startsWith(b, [0x4d, 0x4d, 0x00, 0x2a]),
  },
  {
    mime: 'image/avif',
    ext: 'avif',
    test: (b) => ['avif', 'avis'].includes(ftypBrand(b)),
  },
  {
    mime: 'video/mp4',
    ext: 'mp4',
    test: (b) =>
      ['isom', 'iso2', 'iso5', 'mp41', 'mp42', 'M4V ', 'avc1'].includes(
        ftypBrand(b)
      ),
  },
];

export const detectMedia = (
  buffer: Buffer | undefined
): DetectedMedia | null => {
  if (!buffer || !Buffer.isBuffer(buffer) || buffer.length === 0) {
    return null;
  }
  const match = SIGNATURES.find((signature) => signature.test(buffer));
  return match ? { mime: match.mime, ext: match.ext } : null;
};

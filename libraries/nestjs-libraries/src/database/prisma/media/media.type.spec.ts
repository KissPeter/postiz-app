import { mediaTypeFor } from './media.type';

describe('mediaTypeFor', () => {
  it('uses the mime type first', () => {
    expect(mediaTypeFor('video/mp4', 'x.bin')).toBe('video');
    expect(mediaTypeFor('image/jpeg', 'x.mp4')).toBe('image');
    expect(mediaTypeFor('VIDEO/QuickTime')).toBe('video');
  });

  it('falls back to the extension when the mime type is missing or generic', () => {
    expect(mediaTypeFor(undefined, 'https://d.example/abc.mp4')).toBe('video');
    expect(mediaTypeFor('application/octet-stream', 'a/b.MOV?x=1')).toBe('video');
    expect(mediaTypeFor('', 'a/b.jpeg')).toBe('image');
  });

  it('defaults to image', () => {
    expect(mediaTypeFor()).toBe('image');
    expect(mediaTypeFor(null, null)).toBe('image');
  });
});

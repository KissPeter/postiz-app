// Display name for an uploaded file. The storage key stays random (collision
// and path safety); this is only what the media library shows.
export const cleanOriginalName = (name?: string | null): string | undefined => {
  if (!name || typeof name !== 'string') {
    return undefined;
  }

  let value = name;
  // multer/busboy hand over multipart filenames decoded as latin1; if the
  // bytes are really UTF-8 (accents, emoji) restore them.
  try {
    // only when every char fits in one byte; anything wider is already decoded
    if (/[^\u0000-ÿ]/.test(value)) {
      throw new Error('already decoded');
    }
    const decoded = Buffer.from(value, 'latin1').toString('utf8');
    if (!decoded.includes('\\uFFFD')) {
      value = decoded;
    }
  } catch (err) {
    // keep the value as is
  }

  value = value
    .split(/[\\/]/)
    .pop()!
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim();

  if (!value || value === '.' || value === '..') {
    return undefined;
  }

  return value.length > 180 ? value.slice(0, 180) : value;
};

const VIDEO_EXTENSIONS = new Set(['mp4', 'mov', 'm4v', 'webm', 'mkv', 'avi']);

/**
 * The `Media.type` for an upload: `video` when the mime type says so (or, with
 * no usable mime type, the file extension), else `image`.
 */
export function mediaTypeFor(
  mimetype?: string | null,
  path?: string | null
): 'image' | 'video' {
  const mime = (mimetype || '').toLowerCase();
  if (mime.startsWith('video/')) {
    return 'video';
  }
  if (mime.startsWith('image/')) {
    return 'image';
  }
  const ext = (path || '').split('?')[0].split('.').pop()?.toLowerCase() || '';
  return VIDEO_EXTENSIONS.has(ext) ? 'video' : 'image';
}

// Collapses repeated slashes in the path of an absolute http(s) media URL, so a
// stored `https://host//key.jpeg` renders as `https://host/key.jpeg`.
// The scheme separator, the query string and the fragment are never touched.
// data:, blob: and relative URLs are returned unchanged.
export const normaliseMediaUrl = <T extends string | null | undefined>(
  url: T
): T => {
  if (typeof url !== 'string') {
    return url;
  }
  const match = /^(https?:\/\/[^/?#]+)([^?#]*)([\s\S]*)$/i.exec(url);
  if (!match) {
    return url;
  }
  const [, origin, path, rest] = match;
  return `${origin}${path.replace(/\/{2,}/g, '/')}${rest}` as T;
};

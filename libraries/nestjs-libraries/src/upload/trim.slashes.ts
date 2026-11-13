// Strips trailing slashes from a storage base URL so that `${base}/${key}`
// never produces a double slash (`https://host//key`), which the CDN 404s.
export const trimTrailingSlashes = (url?: string | null): string =>
  (url || '').replace(/\/+$/, '');

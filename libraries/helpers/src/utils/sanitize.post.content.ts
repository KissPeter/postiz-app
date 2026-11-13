import sanitizeHtml from 'sanitize-html';

const ALLOWED_TAGS = [
  'p',
  'br',
  'strong',
  'u',
  'a',
  'ul',
  'li',
  'h1',
  'h2',
  'h3',
  'span',
];

const ALLOWED_ATTR = [
  'href',
  'target',
  'rel',
  'class',
  'data-mention-id',
  'data-mention-label',
];

// sanitize-html is pure JS (no jsdom), so it bundles cleanly into the Next.js
// server build and runs synchronously in the DTO transform.
export const sanitizePostContent = (value: unknown): string => {
  if (typeof value !== 'string' || !value) {
    return '';
  }

  return sanitizeHtml(value, {
    allowedTags: ALLOWED_TAGS,
    allowedAttributes: { '*': ALLOWED_ATTR },
    // same scheme rule as the previous ALLOWED_URI_REGEXP: http(s), mailto,
    // and scheme-less relative / fragment URLs; javascript: and data: are dropped
    allowedSchemes: ['http', 'https', 'mailto'],
    allowedSchemesAppliedToAttributes: ['href'],
    allowProtocolRelative: true,
  });
};

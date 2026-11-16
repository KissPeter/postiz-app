export const MAX_THREADS_TOPIC_TAG_LENGTH = 50;

// Normalizes a Threads topic tag. Returns undefined when the value is not a
// usable tag: non-string, empty, longer than 50 characters, or containing '.' or '&'.
export function normalizeTopicTag(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  let tag = value.trim();
  if (tag.startsWith('#')) {
    tag = tag.slice(1).trim();
  }

  if (!tag || tag.length > MAX_THREADS_TOPIC_TAG_LENGTH) {
    return undefined;
  }

  if (tag.includes('.') || tag.includes('&')) {
    return undefined;
  }

  return tag;
}

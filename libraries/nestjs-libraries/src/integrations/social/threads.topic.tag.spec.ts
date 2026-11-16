import { normalizeTopicTag } from './threads.topic.tag';

describe('threads topic tag', () => {
  it('keeps a valid tag', () => {
    expect(normalizeTopicTag('plotterart')).toBe('plotterart');
  });

  it('removes one leading #', () => {
    expect(normalizeTopicTag('#plotterart')).toBe('plotterart');
  });

  it('trims surrounding whitespace', () => {
    expect(normalizeTopicTag('  plotter art  ')).toBe('plotter art');
    expect(normalizeTopicTag('  #plotterart ')).toBe('plotterart');
  });

  it('returns undefined for empty values', () => {
    expect(normalizeTopicTag('')).toBeUndefined();
    expect(normalizeTopicTag('   ')).toBeUndefined();
    expect(normalizeTopicTag('#')).toBeUndefined();
  });

  it('returns undefined for non-string values', () => {
    expect(normalizeTopicTag(undefined)).toBeUndefined();
    expect(normalizeTopicTag(null)).toBeUndefined();
    expect(normalizeTopicTag(42)).toBeUndefined();
    expect(normalizeTopicTag({ tag: 'plotterart' })).toBeUndefined();
  });

  it('accepts exactly 50 characters and rejects 51', () => {
    const fifty = 'a'.repeat(50);
    expect(normalizeTopicTag(fifty)).toBe(fifty);
    expect(normalizeTopicTag('a'.repeat(51))).toBeUndefined();
  });

  it('returns undefined when the tag contains a period', () => {
    expect(normalizeTopicTag('plotter.art')).toBeUndefined();
  });

  it('returns undefined when the tag contains an ampersand', () => {
    expect(normalizeTopicTag('plotter&art')).toBeUndefined();
  });
});

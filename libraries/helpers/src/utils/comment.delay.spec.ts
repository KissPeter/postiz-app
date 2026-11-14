import {
  clampCommentDelay,
  MAX_COMMENT_DELAY_MINUTES,
} from './comment.delay';

describe('comment delay', () => {
  it('clamps to 0..max and floors', () => {
    expect(clampCommentDelay(undefined)).toBe(0);
    expect(clampCommentDelay(null)).toBe(0);
    expect(clampCommentDelay(-5)).toBe(0);
    expect(clampCommentDelay(NaN)).toBe(0);
    expect(clampCommentDelay(1.9)).toBe(1);
    expect(clampCommentDelay(30)).toBe(30);
    expect(clampCommentDelay(10080)).toBe(10080);
    expect(clampCommentDelay(99999)).toBe(MAX_COMMENT_DELAY_MINUTES);
  });
});

import {
  clampCommentDelay,
  MAX_COMMENT_DELAY_MINUTES,
  waitCommentDelay,
} from './comment.delay';

describe('comment delay', () => {
  it('clamps to 0..max and floors', () => {
    expect(clampCommentDelay(undefined)).toBe(0);
    expect(clampCommentDelay(null)).toBe(0);
    expect(clampCommentDelay(-5)).toBe(0);
    expect(clampCommentDelay(NaN)).toBe(0);
    expect(clampCommentDelay(1.9)).toBe(1);
    expect(clampCommentDelay(30)).toBe(30);
    expect(clampCommentDelay(9999)).toBe(MAX_COMMENT_DELAY_MINUTES);
  });

  it('waits the clamped number of minutes', async () => {
    jest.useFakeTimers();
    let done = false;
    const p = waitCommentDelay(2).then(() => (done = true));
    await jest.advanceTimersByTimeAsync(119999);
    expect(done).toBe(false);
    await jest.advanceTimersByTimeAsync(1);
    await p;
    expect(done).toBe(true);
    jest.useRealTimers();
  });

  it('does not wait for zero', async () => {
    await waitCommentDelay(0);
  });
});

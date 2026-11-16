import {
  CONTAINER_POLL_MAX,
  containerFailureMessage,
  isContainerFailure,
} from './threads.container.status';

describe('threads container status', () => {
  it('treats ERROR and EXPIRED as failures only', () => {
    expect(isContainerFailure('ERROR')).toBe(true);
    expect(isContainerFailure('EXPIRED')).toBe(true);
    expect(isContainerFailure('FINISHED')).toBe(false);
    expect(isContainerFailure('IN_PROGRESS')).toBe(false);
    expect(isContainerFailure(undefined)).toBe(false);
    expect(isContainerFailure(null)).toBe(false);
  });

  it("uses Threads' own error_message when it is useful", () => {
    expect(containerFailureMessage('ERROR', 'Video duration is too long')).toBe(
      'Video duration is too long'
    );
    expect(containerFailureMessage('ERROR', '  Bad aspect ratio  ')).toBe(
      'Bad aspect ratio'
    );
  });

  it('explains plainly when the message is empty or UNKNOWN', () => {
    const generic =
      'Threads could not process the media, please check the media format and try again';
    expect(containerFailureMessage('ERROR', '')).toBe(generic);
    expect(containerFailureMessage('ERROR', null)).toBe(generic);
    expect(containerFailureMessage('ERROR', 'unknown')).toBe(generic);
    expect(containerFailureMessage('ERROR', 'UNKNOWN')).toBe(generic);
    expect(containerFailureMessage('EXPIRED', undefined)).toBe(
      'The Threads media container expired before it could be published, please try again'
    );
  });

  it('polls for a bounded time', () => {
    expect(CONTAINER_POLL_MAX).toBeGreaterThan(0);
    expect(CONTAINER_POLL_MAX).toBeLessThanOrEqual(300);
  });
});

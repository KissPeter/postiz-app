import {
  buildNextCommentJob,
  cancelPostJobs,
  segmentThread,
} from './comment.delay';

const thread = (...delays: number[]) =>
  delays.map((delay, i) => ({ id: `p${i}`, delay }));

describe('segmentThread', () => {
  it('keeps the root and the immediate comments together', () => {
    const t = thread(0, 0, 0);
    expect(segmentThread(t, 0).map((p) => p.id)).toEqual(['p0', 'p1', 'p2']);
  });

  it('stops before the first delayed comment', () => {
    const t = thread(0, 0, 60, 0, 1440);
    expect(segmentThread(t, 0).map((p) => p.id)).toEqual(['p0', 'p1']);
  });

  it('resumes at a delayed comment and runs until the next delay', () => {
    const t = thread(0, 0, 60, 0, 1440);
    expect(segmentThread(t, 2).map((p) => p.id)).toEqual(['p2', 'p3']);
    expect(segmentThread(t, 4).map((p) => p.id)).toEqual(['p4']);
  });

  it('treats a missing delay as no delay', () => {
    expect(
      segmentThread([{ id: 'a' }, { id: 'b', delay: null }], 0)
    ).toHaveLength(2);
  });
});

describe('buildNextCommentJob', () => {
  it('returns nothing when there is no next comment', () => {
    expect(buildNextCommentJob('root', undefined)).toBeUndefined();
  });

  it('schedules the comment with its delay in ms, keyed by its own id', () => {
    expect(buildNextCommentJob('root', { id: 'c1', delay: 60 })).toEqual({
      id: 'c1',
      options: { delay: 3600000 },
      payload: { id: 'root', resumeFrom: 'c1' },
    });
  });

  it('clamps the delay to one week', () => {
    expect(
      buildNextCommentJob('root', { id: 'c1', delay: 99999 })!.options.delay
    ).toBe(10080 * 60000);
  });
});

describe('cancelPostJobs', () => {
  it('removes the job of every post in the thread', async () => {
    const del = jest.fn().mockResolvedValue(1);
    await cancelPostJobs({ delete: del }, ['root', 'c1', 'c2']);
    expect(del.mock.calls).toEqual([
      ['post', 'root'],
      ['post', 'c1'],
      ['post', 'c2'],
    ]);
  });

  it('keeps going when a job is locked or missing', async () => {
    const del = jest
      .fn()
      .mockRejectedValueOnce(new Error('Job is locked'))
      .mockResolvedValue(0);
    await expect(
      cancelPostJobs({ delete: del }, ['root', 'c1'])
    ).resolves.toBeUndefined();
    expect(del).toHaveBeenCalledTimes(2);
  });
});

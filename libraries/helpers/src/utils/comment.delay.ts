// Comments (thread items after the first) can be published later than the root
// post. Each delayed comment is scheduled as its own queue job (see
// PostsService.post), so long delays are safe.
export const MAX_COMMENT_DELAY_MINUTES = 10080; // 1 week

// minutes: 1, 2, 5, 10, 15, 30 min, 1 hour, 1 day, 1 week
export const COMMENT_DELAY_OPTIONS = [1, 2, 5, 10, 15, 30, 60, 1440, 10080];

export const clampCommentDelay = (minutes?: number | null) => {
  const value = Math.floor(Number(minutes) || 0);
  return Math.min(Math.max(value, 0), MAX_COMMENT_DELAY_MINUTES);
};

type ThreadItem = { id: string; delay?: number | null };

// A thread is published in segments: the first item (or the item we resume
// from) plus the items after it that have no delay. Every delayed item starts a
// new segment, which runs later as its own scheduled job.
export const segmentThread = <T extends ThreadItem>(
  posts: T[],
  start: number
): T[] => {
  let end = start + 1;
  while (end < posts.length && !((posts[end].delay || 0) > 0)) {
    end++;
  }
  return posts.slice(start, end);
};

// Queue job (BullMQ jobId = next.id) that resumes the thread at `next`.
export const buildNextCommentJob = (rootId: string, next?: ThreadItem) =>
  next
    ? {
        id: next.id,
        options: { delay: clampCommentDelay(next.delay) * 60000 },
        payload: { id: rootId, resumeFrom: next.id },
      }
    : undefined;

// Removes the queued jobs (the root's and every delayed comment's) of the given
// post ids. Jobs that no longer exist or are currently running are ignored: a
// running comment job re-checks the thread and exits on its own.
export const cancelPostJobs = async (
  producer: { delete: (pattern: string, jobId: string) => Promise<any> | any },
  ids: string[]
) => {
  for (const id of ids) {
    try {
      await producer.delete('post', id);
    } catch (err) {}
  }
};

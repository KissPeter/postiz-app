export type ReplyResult = {
  id: string;
  postId: string;
  releaseURL: string;
  status: string;
};

/**
 * Publishes `comments` one after the other as replies on Threads. The first
 * replies to `startReplyToId`, each next one to the reply before it.
 * `publishOne` creates and publishes a single reply and returns its Threads id
 * and permalink.
 */
export async function publishReplyChain<T extends { id: string }>(
  startReplyToId: string,
  comments: T[],
  publishOne: (
    comment: T,
    replyToId: string
  ) => Promise<{ threadId: string; permalink: string }>
): Promise<ReplyResult[]> {
  const results: ReplyResult[] = [];
  let replyToId = startReplyToId;

  for (const comment of comments) {
    const { threadId, permalink } = await publishOne(comment, replyToId);
    results.push({
      id: comment.id,
      postId: threadId,
      releaseURL: permalink,
      status: 'success',
    });
    replyToId = threadId;
  }

  return results;
}

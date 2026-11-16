import { publishReplyChain } from './threads.reply.chain';

describe('publishReplyChain', () => {
  it('replies to the start id, then chains each reply to the one before', async () => {
    const calls: Array<[string, string]> = [];
    const publishOne = async (c: { id: string }, replyToId: string) => {
      calls.push([c.id, replyToId]);
      return { threadId: `t-${c.id}`, permalink: `https://threads.example/${c.id}` };
    };

    const out = await publishReplyChain(
      'root-1',
      [{ id: 'a' }, { id: 'b' }],
      publishOne
    );

    expect(calls).toEqual([
      ['a', 'root-1'],
      ['b', 't-a'],
    ]);
    expect(out).toEqual([
      { id: 'a', postId: 't-a', releaseURL: 'https://threads.example/a', status: 'success' },
      { id: 'b', postId: 't-b', releaseURL: 'https://threads.example/b', status: 'success' },
    ]);
  });

  it('does nothing without comments', async () => {
    const publishOne = jest.fn();
    expect(await publishReplyChain('root-1', [], publishOne)).toEqual([]);
    expect(publishOne).not.toHaveBeenCalled();
  });

  it('stops at the first failure and returns nothing for later comments', async () => {
    const publishOne = jest
      .fn()
      .mockResolvedValueOnce({ threadId: 't-a', permalink: 'u-a' })
      .mockRejectedValueOnce(new Error('boom'));

    await expect(
      publishReplyChain('root-1', [{ id: 'a' }, { id: 'b' }, { id: 'c' }], publishOne)
    ).rejects.toThrow('boom');
    expect(publishOne).toHaveBeenCalledTimes(2);
  });
});

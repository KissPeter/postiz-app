jest.mock('@gitroom/helpers/utils/concurrency.service', () => ({
  concurrency: async (
    _identifier: string,
    _maxConcurrent: number,
    func: () => Promise<unknown>
  ) => func(),
}));

import {
  BadBody,
  RefreshToken,
  SocialAbstract,
} from '@gitroom/nestjs-libraries/integrations/social.abstract';

class TestProvider extends SocialAbstract {
  identifier = 'test';

  constructor(
    private readonly handled:
      | { type: 'refresh-token' | 'bad-body' | 'retry'; value: string }
      | undefined = undefined
  ) {
    super();
  }

  handleErrors():
    | { type: 'refresh-token' | 'bad-body' | 'retry'; value: string }
    | undefined {
    return this.handled;
  }
}

describe('social runInConcurrent', () => {
  it('raises RefreshToken for mapped auth errors', async () => {
    const provider = new TestProvider({
      type: 'refresh-token',
      value: 'Token expired',
    });

    await expect(
      provider.runInConcurrent(
        async () => {
          throw new Error('401 Unauthorized');
        },
        true
      )
    ).rejects.toBeInstanceOf(RefreshToken);
  });

  it('raises BadBody with a message for unmapped failures', async () => {
    const provider = new TestProvider();

    const error = await provider
      .runInConcurrent(
        async () => {
          throw new Error('boom');
        },
        true
      )
      .catch((err) => err);

    expect(error).toBeInstanceOf(BadBody);
    expect(error.message).toBe('Unknown Error');
  });
});

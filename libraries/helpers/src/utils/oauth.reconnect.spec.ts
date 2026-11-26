import { keepRefreshedAuthTokens } from './oauth.reconnect';

describe('oauth reconnect', () => {
  it('keeps tokens from the new authentication', () => {
    expect(
      keepRefreshedAuthTokens(
        { id: 'channel', accessToken: 'new-access' },
        { refreshToken: 'new-refresh', expiresIn: 3600 }
      )
    ).toEqual({
      id: 'channel',
      accessToken: 'new-access',
      refreshToken: 'new-refresh',
      expiresIn: 3600,
    });
  });
});

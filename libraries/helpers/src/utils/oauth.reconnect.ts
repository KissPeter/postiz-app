export function keepRefreshedAuthTokens<T extends object>(
  newAuth: T,
  auth: { refreshToken?: string; expiresIn?: number }
) {
  return {
    ...newAuth,
    refreshToken: auth.refreshToken,
    expiresIn: auth.expiresIn,
  };
}

// NOT cryptographically secure (Math.random). Use only for non-security ids
// such as UI keys and cosmetic ids. For API keys, invite ids, OAuth state and
// PKCE verifiers use makeSecureId (make.secure.id.ts).
export const makeId = (length: number) => {
  let text = '';
  const possible =
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

  for (let i = 0; i < length; i += 1) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
};

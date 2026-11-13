import { randomInt } from 'crypto';

// Same alphabet as makeId (make.is.ts), so the output format is unchanged.
const ALPHABET =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

// Cryptographically secure id for secrets: API keys, invite ids, OAuth state
// and PKCE code verifiers. Server-only: it imports node:crypto, and make.is.ts
// is bundled into the frontend, so this lives in its own module.
export const makeSecureId = (length: number) => {
  let text = '';
  for (let i = 0; i < length; i += 1) {
    text += ALPHABET.charAt(randomInt(ALPHABET.length));
  }
  return text;
};

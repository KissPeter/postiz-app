export type YoutubeHandledError = {
  type: 'refresh-token' | 'bad-body';
  value: string;
};

export function youtubeAuthError(body: string): YoutubeHandledError | undefined {
  if (body.includes('Unauthorized')) {
    return {
      type: 'refresh-token',
      value: 'Token expired or invalid, please reconnect your YouTube account.',
    };
  }

  if (body.includes('UNAUTHENTICATED') || body.includes('invalid_grant')) {
    return {
      type: 'refresh-token',
      value: 'Please re-authenticate your YouTube account',
    };
  }

  return undefined;
}

export function youtubeUploadedVideoId(result: unknown): string | undefined {
  if (!result || typeof result !== 'object') {
    return undefined;
  }

  const upload = result as { err?: unknown; data?: { id?: unknown } };
  if (upload.err) {
    return undefined;
  }

  const id = upload.data?.id;
  return typeof id === 'string' && id.length > 0 ? id : undefined;
}

export function youtubeHandledErrorMessage(
  result: unknown,
  fallback: string
): string {
  if (!result || typeof result !== 'object') {
    return fallback;
  }

  const value = (result as { value?: unknown }).value;
  return typeof value === 'string' && value.length > 0 ? value : fallback;
}

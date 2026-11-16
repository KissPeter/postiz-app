// A Threads media container is polled until it is FINISHED. 150 polls of
// about 2.2 s is roughly 5.5 minutes; after that the post fails with a clear
// message instead of waiting forever.
export const CONTAINER_POLL_MAX = 150;

export function isContainerFailure(status?: string | null): boolean {
  return status === 'ERROR' || status === 'EXPIRED';
}

/**
 * The message for a failed container: Threads' own `error_message` when it
 * gave a useful one, else a plain explanation. Threads often answers with
 * nothing or "UNKNOWN".
 */
export function containerFailureMessage(
  status?: string | null,
  errorMessage?: string | null
): string {
  const own = (errorMessage || '').trim();
  if (own && own.toUpperCase() !== 'UNKNOWN') {
    return own;
  }
  if (status === 'EXPIRED') {
    return 'The Threads media container expired before it could be published, please try again';
  }
  return 'Threads could not process the media, please check the media format and try again';
}

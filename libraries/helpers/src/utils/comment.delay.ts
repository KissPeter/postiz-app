import { timer } from './timer';

// Comments (thread items after the first) can be published later than the root
// post. The wait happens inside the publishing job, so the cap is kept short:
// a worker restart during the wait replays the job and publishes the root
// again (see KissPeter/postiz-app#8, option 1).
export const MAX_COMMENT_DELAY_MINUTES = 30;

export const COMMENT_DELAY_OPTIONS = [1, 2, 5, 10, 15, 30];

export const clampCommentDelay = (minutes?: number | null) => {
  const value = Math.floor(Number(minutes) || 0);
  return Math.min(Math.max(value, 0), MAX_COMMENT_DELAY_MINUTES);
};

export const waitCommentDelay = async (minutes?: number | null) => {
  const value = clampCommentDelay(minutes);
  if (value > 0) {
    await timer(value * 60000);
  }
};

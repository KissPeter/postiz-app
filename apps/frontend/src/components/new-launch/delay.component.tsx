'use client';

import React, { FC } from 'react';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import {
  COMMENT_DELAY_OPTIONS,
  clampCommentDelay,
} from '@gitroom/helpers/utils/comment.delay';

// Providers whose post() publishes thread items as comments after the root.
export const DELAYED_COMMENT_PROVIDERS = [
  'facebook',
  'instagram',
  'instagram-standalone',
];

export const DelayComponent: FC<{
  value?: number;
  onChange: (minutes: number) => void;
}> = ({ value, onChange }) => {
  const t = useT();
  const current = clampCommentDelay(value);
  const label = (m: number) => {
    if (m % 10080 === 0) {
      return `${m / 10080} ${t('comment_delay_week', 'week')}`;
    }
    if (m % 1440 === 0) {
      return `${m / 1440} ${t('comment_delay_day', 'day')}`;
    }
    if (m % 60 === 0) {
      return `${m / 60} ${t('comment_delay_hour', 'hour')}`;
    }
    return `${m} ${t('comment_delay_minutes', 'min')}`;
  };
  return (
    <div className="flex flex-wrap items-center gap-[8px] text-[13px] ps-[12px] pb-[8px]">
      <div>{t('comment_delay', 'Publish this comment after')}</div>
      <select
        className="h-[30px] rounded-[6px] bg-newBgColorInner px-[8px] outline-none"
        value={current}
        onChange={(e) => onChange(clampCommentDelay(+e.target.value))}
      >
        <option value={0}>{t('comment_delay_none', 'right away')}</option>
        {COMMENT_DELAY_OPTIONS.map((m) => (
          <option key={m} value={m}>
            {label(m)}
          </option>
        ))}
      </select>
    </div>
  );
};

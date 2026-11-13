import { useCallback } from 'react';
import { normaliseMediaUrl } from '@gitroom/react/helpers/normalise.media.url';
export const useMediaDirectory = () => {
  const set = useCallback((path: string) => {
    return normaliseMediaUrl(path);
  }, []);
  return {
    set,
  };
};

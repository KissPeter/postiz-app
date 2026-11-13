import { readFileSync } from 'fs';
import axios from 'axios';
import { resolve, sep } from 'path';

// Local media paths come from stored post media and are user-influenced. Only a
// file inside UPLOAD_DIRECTORY may ever be opened: resolve() collapses any `..`
// segments before the comparison. Fails closed when UPLOAD_DIRECTORY is unset.
export const resolveUploadPath = (path: string): string => {
  const base = process.env.UPLOAD_DIRECTORY
    ? resolve(process.env.UPLOAD_DIRECTORY)
    : '';
  const filePath = resolve(path);
  if (!base || !filePath.startsWith(base + sep)) {
    throw new Error('Media file is outside the upload directory');
  }
  return filePath;
};

export const readOrFetch = async (path: string) => {
  if (path.indexOf('http') === 0) {
    return (
      await axios({
        url: path,
        method: 'GET',
        responseType: 'arraybuffer',
      })
    ).data;
  }

  return readFileSync(resolveUploadPath(path));
};

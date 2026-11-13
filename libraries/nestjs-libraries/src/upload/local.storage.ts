import { IUploadProvider } from './upload.interface';
import { mkdirSync, unlink, writeFileSync } from 'fs';
import { resolve, sep } from 'path';
import axios from 'axios';
import { BadRequestException } from '@nestjs/common';
import { detectMedia } from './media.sniff';

export class LocalStorage implements IUploadProvider {
  constructor(private uploadDirectory: string) {}

  async uploadSimple(path: string) {
    const loadImage = await axios.get(path, { responseType: 'arraybuffer' });
    // the extension comes from the bytes, never from the remote content-type
    const detected = detectMedia(Buffer.from(loadImage.data));
    if (!detected) {
      throw new BadRequestException('Unsupported file type.');
    }
    const findExtension = detected.ext;

    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');

    const innerPath = `/${year}/${month}/${day}`;
    const dir = `${this.uploadDirectory}${innerPath}`;
    mkdirSync(dir, { recursive: true });

    const randomName = Array(32)
      .fill(null)
      .map(() => Math.round(Math.random() * 16).toString(16))
      .join('');

    const filePath = `${dir}/${randomName}.${findExtension}`;
    const publicPath = `${innerPath}/${randomName}.${findExtension}`;
    // Logic to save the file to the filesystem goes here
    writeFileSync(filePath, loadImage.data);

    return process.env.FRONTEND_URL + '/uploads' + publicPath;
  }

  async uploadFile(file: Express.Multer.File): Promise<any> {
    try {
      // type and extension are derived from the file's bytes via a fixed
      // mapping; the client's mimetype and originalname are not used on disk
      const detected = detectMedia(file.buffer);
      if (!detected) {
        throw new BadRequestException('Unsupported file type.');
      }
      const safeExt = `.${detected.ext}`;

      const now = new Date();
      const year = now.getFullYear();
      const month = String(now.getMonth() + 1).padStart(2, '0');
      const day = String(now.getDate()).padStart(2, '0');

      const innerPath = `/${year}/${month}/${day}`;
      const dir = `${this.uploadDirectory}${innerPath}`;
      mkdirSync(dir, { recursive: true });

      const randomName = Array(32)
        .fill(null)
        .map(() => Math.round(Math.random() * 16).toString(16))
        .join('');

      const filePath = `${dir}/${randomName}${safeExt}`;
      const publicPath = `${innerPath}/${randomName}${safeExt}`;

      // Logic to save the file to the filesystem goes here
      writeFileSync(filePath, file.buffer);

      return {
        filename: `${randomName}${safeExt}`,
        path: process.env.FRONTEND_URL + '/uploads' + publicPath,
        mimetype: detected.mime,
        originalname: `${randomName}${safeExt}`,
      };
    } catch (err) {
      console.error('Error uploading file to Local Storage:', err);
      throw err;
    }
  }

  async removeFile(filePath: string): Promise<void> {
    // only a file inside the upload directory is ever deleted; resolve()
    // collapses any `..` segments before the comparison
    const base = resolve(String(this.uploadDirectory));
    const localPath = resolve(filePath);
    if (!localPath.startsWith(base + sep)) {
      throw new Error('Unsafe file path');
    }
    // Logic to remove the file from the filesystem goes here
    return new Promise((resolvePromise, reject) => {
      unlink(localPath, (err) => {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      });
    });
  }
}

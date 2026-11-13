import { BadRequestException, Injectable, PipeTransform } from '@nestjs/common';
import { detectMedia } from './media.sniff';

@Injectable()
export class CustomFileValidationPipe implements PipeTransform {
  async transform(value: any) {
    if (!value) {
      throw new BadRequestException('No file provided.');
    }

    // Only multer file objects are validated; other parameters pass through.
    // The presence of the buffer is checked, not the client's mimetype, so a
    // file sent without a mimetype cannot skip validation.
    if (
      typeof value !== 'object' ||
      !('buffer' in value || 'fieldname' in value || 'originalname' in value)
    ) {
      return value;
    }

    if (!Buffer.isBuffer(value.buffer)) {
      throw new BadRequestException('Invalid file upload.');
    }

    const detected = detectMedia(value.buffer);
    if (!detected) {
      throw new BadRequestException('Unsupported file type.');
    }

    const maxSize = this.getMaxSize(detected.mime);
    if (value.size > maxSize) {
      throw new BadRequestException(
        `File size exceeds the maximum allowed size of ${maxSize} bytes.`
      );
    }

    value.mimetype = detected.mime;
    return value;
  }

  private getMaxSize(mimeType: string): number {
    if (mimeType.startsWith('image/')) {
      return 10 * 1024 * 1024; // 10 MB
    } else if (mimeType.startsWith('video/')) {
      return 1024 * 1024 * 1024; // 1 GB
    } else {
      throw new BadRequestException('Unsupported file type.');
    }
  }
}

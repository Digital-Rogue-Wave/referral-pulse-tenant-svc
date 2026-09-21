import { BadRequestException } from '@nestjs/common';
import type { MulterOptions } from '@nestjs/platform-express/multer/interfaces/multer-options.interface';

/**
 * The one upload policy for every path that accepts a file (multipart and presigned).
 * SVG is deliberately excluded: it can carry script, and uploads are served back to browsers.
 */
export const ALLOWED_UPLOAD_TYPES: Readonly<Record<string, string>> = {
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/webp': 'webp',
    'image/gif': 'gif',
    'application/pdf': 'pdf'
};

export const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB

export const FILE_UPLOAD_OPTIONS: MulterOptions = {
    limits: { fileSize: MAX_FILE_SIZE_BYTES, files: 10 },
    fileFilter: (_req, file, cb) => {
        if (!(file.mimetype in ALLOWED_UPLOAD_TYPES)) {
            cb(new BadRequestException(`Unsupported file type: ${file.mimetype}`), false);
            return;
        }
        cb(null, true);
    }
};

/** Maps a requested extension to its content type, or undefined when the type is not allowed. */
export function contentTypeForExtension(extension: string): string | undefined {
    const normalized = extension.toLowerCase() === 'jpeg' ? 'jpg' : extension.toLowerCase();
    return Object.entries(ALLOWED_UPLOAD_TYPES).find(([, ext]) => ext === normalized)?.[0];
}

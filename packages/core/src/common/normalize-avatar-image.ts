import sharp from 'sharp';

import { UserInputError } from './error/errors';

/** Decode a bounded raster image and produce a small, metadata-free avatar. */
export async function normalizeAvatarImage(bytes: Buffer): Promise<Buffer> {
    try {
        const image = sharp(bytes, { failOn: 'warning', limitInputPixels: 16_000_000 });
        const metadata = await image.metadata();
        if (!['jpeg', 'png', 'webp'].includes(metadata.format ?? '') || (metadata.pages ?? 1) > 1) {
            throw new Error('Unsupported image');
        }
        return await image
            .rotate()
            .resize({ width: 512, height: 512, fit: 'inside', withoutEnlargement: true })
            .webp({ quality: 85 })
            .toBuffer();
    } catch {
        throw new UserInputError('头像文件损坏、格式不支持或超过 1600 万像素');
    }
}

import sharp from 'sharp';

export type CustomerImageKind = 'avatar' | 'reference' | 'output';
export const CUSTOMER_IMAGE_LIMITS = {
    avatar: { bytes: 5 * 1024 * 1024, pixels: 16_000_000 },
    reference: { bytes: 10 * 1024 * 1024, pixels: 40_000_000 },
    output: { bytes: 25 * 1024 * 1024, pixels: 40_000_000 },
} as const;

/** Called in the restricted decoder process in production. Never retains input metadata. */
export async function normalizeCustomerImage(bytes: Buffer, kind: CustomerImageKind): Promise<Buffer> {
    const limit = CUSTOMER_IMAGE_LIMITS[kind];
    if (!limit || !bytes.length || bytes.length > limit.bytes) throw new Error('IMAGE_SIZE');
    // Reject non-raster formats before handing any bytes to native decoders.
    const jpeg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
    const png = bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    const webp =
        bytes.subarray(0, 4).toString('ascii') === 'RIFF' &&
        bytes.subarray(8, 12).toString('ascii') === 'WEBP';
    if (!jpeg && !png && !webp) throw new Error('IMAGE_FORMAT');
    const image = sharp(bytes, { failOn: 'warning', limitInputPixels: limit.pixels });
    const metadata = await image.metadata();
    if (
        !['jpeg', 'png', 'webp'].includes(metadata.format ?? '') ||
        (metadata.pages ?? 1) !== 1 ||
        !metadata.width ||
        !metadata.height ||
        metadata.width * metadata.height > limit.pixels
    ) {
        throw new Error('IMAGE_FORMAT');
    }
    image.rotate();
    if (kind === 'avatar') {
        image
            .resize({ width: 512, height: 512, fit: 'inside', withoutEnlargement: true })
            .webp({ quality: 85 });
    } else if (jpeg) image.jpeg({ quality: 95 });
    else if (webp) image.webp({ quality: 95 });
    else image.png({ compressionLevel: 9 });
    const result = await image.toBuffer();
    if (result.length > limit.bytes) throw new Error('IMAGE_SIZE');
    return result;
}

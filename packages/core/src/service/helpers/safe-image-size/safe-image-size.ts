import sharp from 'sharp';

const MAX_INPUT_PIXELS = 100_000_000;

export async function safeImageSize(input: Uint8Array) {
    return sharp(input, {
        failOn: 'error',
        limitInputPixels: MAX_INPUT_PIXELS,
        sequentialRead: true,
    }).metadata();
}

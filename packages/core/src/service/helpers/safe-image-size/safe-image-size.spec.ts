import { describe, expect, it } from 'vitest';

import { safeImageSize } from './safe-image-size';

describe('safeImageSize', () => {
    it.each([
        ['HEIF', createHeifHeader()],
        ['ICNS', createIcnsHeader()],
        ['JXL stream', Buffer.from([0xff, 0x0a])],
    ])('rejects malformed %s input without using the vulnerable parser', async (_format, input) => {
        await expect(safeImageSize(input)).rejects.toThrow();
    });

    it('continues to calculate dimensions for supported image formats', async () => {
        const png = Buffer.from(
            'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
            'base64',
        );

        await expect(safeImageSize(png)).resolves.toMatchObject({ format: 'png', height: 1, width: 1 });
    });
});

function createHeifHeader(): Buffer {
    const buffer = Buffer.alloc(16);
    buffer.writeUInt32BE(buffer.length, 0);
    buffer.write('ftyp', 4, 'ascii');
    buffer.write('avif', 8, 'ascii');
    return buffer;
}

function createIcnsHeader(): Buffer {
    const buffer = Buffer.alloc(8);
    buffer.write('icns', 0, 'ascii');
    buffer.writeUInt32BE(buffer.length, 4);
    return buffer;
}

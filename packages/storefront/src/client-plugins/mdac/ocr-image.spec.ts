import { expect, it } from 'vitest';

import { enhanceMrzContrast, imageContentBounds } from './ocr-image';

function image(width: number, height: number, gray = 10) {
    const data = new Uint8ClampedArray(width * height * 4).fill(gray);
    for (let index = 3; index < data.length; index += 4) data[index] = 255;
    return { data, width, height } as ImageData;
}
function paint(pixels: ImageData, x: number, y: number, width: number, height: number, gray: number) {
    for (let row = y; row < y + height; row++) {
        for (let column = x; column < x + width; column++) {
            const index = (row * pixels.width + column) * 4;
            pixels.data[index] = pixels.data[index + 1] = pixels.data[index + 2] = gray;
        }
    }
}

it('removes dark screenshot margins and excludes a detached phone home indicator', () => {
    const pixels = image(100, 200);
    paint(pixels, 5, 35, 90, 130, 180);
    paint(pixels, 25, 195, 50, 2, 220);
    expect(imageContentBounds(pixels)).toEqual({ x: 5, y: 35, width: 90, height: 130 });
});

it('keeps an already cropped document and falls back safely for a dark image', () => {
    expect(imageContentBounds(image(100, 80, 200))).toEqual({ x: 0, y: 0, width: 100, height: 80 });
    expect(imageContentBounds(image(100, 80, 0))).toEqual({ x: 0, y: 0, width: 100, height: 80 });
});

it('increases contrast without changing pixel positions or retaining transparency', () => {
    const pixels = image(20, 10, 120);
    paint(pixels, 0, 0, 10, 10, 80);
    enhanceMrzContrast(pixels);
    expect([...pixels.data.slice(0, 4)]).toEqual([0, 0, 0, 255]);
    expect([...pixels.data.slice(40, 44)]).toEqual([255, 255, 255, 255]);
});

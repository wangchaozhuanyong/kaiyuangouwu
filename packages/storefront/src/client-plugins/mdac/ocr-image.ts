export interface ImageBounds {
    x: number;
    y: number;
    width: number;
    height: number;
}

function longestRun(values: number[], threshold: number): [number, number] {
    let start = 0;
    let best: [number, number] = [0, values.length];
    let length = 0;
    for (let index = 0; index <= values.length; index++) {
        if (index < values.length && values[index] > threshold) continue;
        if (index - start > length) {
            best = [start, index];
            length = index - start;
        }
        start = index + 1;
    }
    return best;
}

/** Remove dark screen/camera margins, not individual characters or document fields. */
export function imageContentBounds(image: Pick<ImageData, 'data' | 'width' | 'height'>): ImageBounds {
    const { data, width, height } = image;
    const rows = Array<number>(height).fill(0);
    const light = (x: number, y: number) => {
        const index = (y * width + x) * 4;
        return (data[index] + data[index + 1] + data[index + 2]) / 3 > 65;
    };
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) if (light(x, y)) rows[y]++;
    }
    let [top, bottom] = longestRun(rows, width * 0.4);
    if (bottom - top < height * 0.25) [top, bottom] = [0, height];
    const columns = Array<number>(width).fill(0);
    for (let y = top; y < bottom; y++) {
        for (let x = 0; x < width; x++) if (light(x, y)) columns[x]++;
    }
    let [left, right] = longestRun(columns, (bottom - top) * 0.4);
    if (right - left < width * 0.4) [left, right] = [0, width];
    return { x: left, y: top, width: right - left, height: bottom - top };
}

/** Normalize contrast on the cropped pixels only. Never persist the canvas or source image. */
export function enhanceMrzContrast(image: ImageData): void {
    const histogram = new Uint32Array(256);
    const { data } = image;
    for (let index = 0; index < data.length; index += 4) {
        const gray = Math.round((data[index] + data[index + 1] + data[index + 2]) / 3);
        histogram[gray]++;
        data[index] = data[index + 1] = data[index + 2] = gray;
    }
    const tail = data.length / 4 / 100;
    let low = 0;
    let high = 255;
    let count = 0;
    while (low < 254 && count + histogram[low] < tail) count += histogram[low++];
    count = 0;
    while (high > low + 1 && count + histogram[high] < tail) count += histogram[high--];
    for (let index = 0; index < data.length; index += 4) {
        const gray = Math.max(0, Math.min(255, Math.round(((data[index] - low) * 255) / (high - low))));
        data[index] = data[index + 1] = data[index + 2] = gray;
        data[index + 3] = 255;
    }
}

export function drawMrzCandidate(
    source: HTMLCanvasElement,
    target: HTMLCanvasElement,
    bounds: ImageBounds,
    fraction: number,
    maxWidth = 1600,
    maxScale = 3,
): void {
    const height = Math.max(1, Math.round(bounds.height * fraction));
    const width = Math.min(maxWidth, bounds.width * maxScale);
    const scaledHeight = Math.round((height * width) / bounds.width);
    const padding = 12;
    target.width = width + padding * 2;
    target.height = scaledHeight + padding * 2;
    const context = target.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('canvas');
    context.fillStyle = 'white';
    context.fillRect(0, 0, target.width, target.height);
    context.imageSmoothingQuality = 'high';
    context.drawImage(
        source,
        bounds.x,
        bounds.y + bounds.height - height,
        bounds.width,
        height,
        padding,
        padding,
        width,
        scaledHeight,
    );
    const pixels = context.getImageData(padding, padding, width, scaledHeight);
    enhanceMrzContrast(pixels);
    context.putImageData(pixels, padding, padding);
}

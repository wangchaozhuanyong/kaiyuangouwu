type ImageDimensions = {
    width?: number | null;
    height?: number | null;
};

export type ImageDimensionSummary = {
    measuredCount: number;
    mismatchCount: number;
    distinctSizeCount: number;
    sharedDimensions: string | null;
};

const aspectRatioMismatchTolerance = 0.08;

export function formatImageDimensions(dimensions: ImageDimensions): string | null {
    const size = normalizedImageDimensions(dimensions);
    return size ? `${size.width} × ${size.height}` : null;
}

export function imageAspectRatioMismatch(targetAspectRatio: string, dimensions: ImageDimensions): boolean {
    const target = parseAspectRatio(targetAspectRatio);
    const actual = normalizedImageDimensions(dimensions);
    if (!target || !actual) return false;
    const targetRatio = target.width / target.height;
    const actualRatio = actual.width / actual.height;
    return Math.abs(actualRatio / targetRatio - 1) > aspectRatioMismatchTolerance;
}

export function generationOutputAspectRatio(
    targetAspectRatio: string,
    dimensions?: ImageDimensions | null,
): string {
    const actual = dimensions ? normalizedImageDimensions(dimensions) : null;
    if (actual) return `${actual.width} / ${actual.height}`;
    const target = parseAspectRatio(targetAspectRatio);
    return target ? `${target.width} / ${target.height}` : '1 / 1';
}

export function summarizeImageOutputDimensions(
    outputs: ImageDimensions[],
    targetAspectRatio: string,
): ImageDimensionSummary {
    const measured = outputs.flatMap(output => {
        const dimensions = normalizedImageDimensions(output);
        return dimensions
            ? [{ ...dimensions, mismatch: imageAspectRatioMismatch(targetAspectRatio, dimensions) }]
            : [];
    });
    const distinctSizes = new Set(measured.map(item => `${item.width} × ${item.height}`));
    return {
        measuredCount: measured.length,
        mismatchCount: measured.filter(item => item.mismatch).length,
        distinctSizeCount: distinctSizes.size,
        sharedDimensions: distinctSizes.size === 1 ? [...distinctSizes][0] : null,
    };
}

function normalizedImageDimensions(dimensions: ImageDimensions): { width: number; height: number } | null {
    const width = Math.round(Number(dimensions.width));
    const height = Math.round(Number(dimensions.height));
    return Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0
        ? { width, height }
        : null;
}

function parseAspectRatio(value: string): { width: number; height: number } | null {
    const match = /^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/u.exec(value.trim());
    if (!match) return null;
    const width = Number(match[1]);
    const height = Number(match[2]);
    return Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0
        ? { width, height }
        : null;
}

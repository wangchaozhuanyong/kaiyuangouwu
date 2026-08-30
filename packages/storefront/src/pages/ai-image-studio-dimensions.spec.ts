import { describe, expect, it } from 'vitest';

import {
    formatImageDimensions,
    generationOutputAspectRatio,
    imageAspectRatioMismatch,
    summarizeImageOutputDimensions,
} from './ai-image-studio-dimensions';

describe('AI image output dimensions', () => {
    it('formats valid stored dimensions and ignores missing values', () => {
        expect(formatImageDimensions({ width: 1024, height: 768 })).toBe('1024 × 768');
        expect(formatImageDimensions({ width: null, height: 768 })).toBeNull();
        expect(formatImageDimensions({ width: 0, height: 768 })).toBeNull();
    });

    it('accepts small provider rounding differences', () => {
        expect(imageAspectRatioMismatch('16:9', { width: 1792, height: 1024 })).toBe(false);
        expect(imageAspectRatioMismatch('1:1', { width: 1024, height: 1024 })).toBe(false);
    });

    it('detects a clearly different output ratio', () => {
        expect(imageAspectRatioMismatch('1:1', { width: 380, height: 218 })).toBe(true);
        expect(imageAspectRatioMismatch('9:16', { width: 1024, height: 1024 })).toBe(true);
    });

    it('uses actual dimensions for detail layout with a safe target fallback', () => {
        expect(generationOutputAspectRatio('1:1', { width: 380, height: 218 })).toBe('380 / 218');
        expect(generationOutputAspectRatio('3:4', null)).toBe('3 / 4');
        expect(generationOutputAspectRatio('invalid', null)).toBe('1 / 1');
    });

    it('summarizes shared, mixed, and missing output sizes', () => {
        expect(
            summarizeImageOutputDimensions(
                [
                    { width: 1024, height: 1024 },
                    { width: 1024, height: 1024 },
                    { width: null, height: null },
                ],
                '1:1',
            ),
        ).toEqual({
            measuredCount: 2,
            mismatchCount: 0,
            distinctSizeCount: 1,
            sharedDimensions: '1024 × 1024',
        });
        expect(
            summarizeImageOutputDimensions(
                [
                    { width: 1024, height: 1024 },
                    { width: 380, height: 218 },
                ],
                '1:1',
            ),
        ).toEqual({
            measuredCount: 2,
            mismatchCount: 1,
            distinctSizeCount: 2,
            sharedDimensions: null,
        });
    });
});

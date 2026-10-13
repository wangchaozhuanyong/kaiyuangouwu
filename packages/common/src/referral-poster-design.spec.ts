import { describe, expect, it } from 'vitest';

import { DEFAULT_ARTWORK_POSTER_DESIGN, validateArtworkPosterDesign } from './referral-poster-design';

describe('artwork poster geometry', () => {
    it('accepts the default and square canvases with a contained circular slot', () => {
        expect(validateArtworkPosterDesign(DEFAULT_ARTWORK_POSTER_DESIGN)).toBe('');
        expect(
            validateArtworkPosterDesign({
                ...DEFAULT_ARTWORK_POSTER_DESIGN,
                canvas: { width: 1080, height: 1080 },
                qr: { ...DEFAULT_ARTWORK_POSTER_DESIGN.qr, centerY: 700 },
            }),
        ).toBe('');
    });
    it('rejects invalid versions, excessive canvases, unsupported styles and partial circles', () => {
        for (const value of [
            null,
            {},
            { version: 4 },
            { ...DEFAULT_ARTWORK_POSTER_DESIGN, canvas: { width: 4096, height: 4096 } },
            { ...DEFAULT_ARTWORK_POSTER_DESIGN, canvas: { width: NaN, height: 1080 } },
            ...[{ centerX: 10 }, { diameter: 100 }, { style: 'unknown' }, { centerY: Infinity }].map(qr => ({
                ...DEFAULT_ARTWORK_POSTER_DESIGN,
                qr: { ...DEFAULT_ARTWORK_POSTER_DESIGN.qr, ...qr },
            })),
        ])
            expect(validateArtworkPosterDesign(value)).not.toBe('');
    });
});

import { describe, expect, it } from 'vitest';

import { centeredHorizontalScrollLeft } from './category-navigation';

describe('category navigation scrolling', () => {
    const container = { clientWidth: 320, scrollWidth: 720 };

    it('centers a category without changing any vertical position', () => {
        expect(centeredHorizontalScrollLeft(container, { offsetLeft: 280, offsetWidth: 70 })).toBe(155);
    });

    it('clamps the first and last categories to the horizontal scroll range', () => {
        expect(centeredHorizontalScrollLeft(container, { offsetLeft: 0, offsetWidth: 70 })).toBe(0);
        expect(centeredHorizontalScrollLeft(container, { offsetLeft: 680, offsetWidth: 70 })).toBe(400);
    });

    it('does not scroll when all categories already fit', () => {
        expect(
            centeredHorizontalScrollLeft(
                { clientWidth: 430, scrollWidth: 390 },
                { offsetLeft: 160, offsetWidth: 70 },
            ),
        ).toBe(0);
    });
});

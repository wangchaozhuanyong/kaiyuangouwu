import { describe, expect, it } from 'vitest';

import {
    STOREFRONT_LOGO_IMAGE,
    STOREFRONT_SOCIAL_IMAGE,
    STOREFRONT_WORDMARK_IMAGE,
} from './storefront-images';
import { DEFAULT_STOREFRONT_NAMES } from './storefront-utils';

describe('MOYAO AI default brand', () => {
    it('keeps the public fallback name and optimized artwork aligned', () => {
        expect(DEFAULT_STOREFRONT_NAMES).toEqual({ zh: 'MOYAO AI｜模钥', en: 'MOYAO AI' });
        expect(STOREFRONT_LOGO_IMAGE).toMatch(/app-icon(?:-[a-zA-Z0-9_-]+)?\.webp$/u);
        expect(STOREFRONT_WORDMARK_IMAGE).toMatch(/logo-on-light(?:-[a-zA-Z0-9_-]+)?\.webp$/u);
        expect(STOREFRONT_SOCIAL_IMAGE).toBe('/storefront/moyao-ai/social-card.jpg');
    });
});

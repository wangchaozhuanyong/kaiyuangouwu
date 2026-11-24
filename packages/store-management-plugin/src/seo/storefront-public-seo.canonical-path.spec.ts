import { describe, expect, it } from 'vitest';

import { entityCanonicalPath } from './storefront-public-seo.service';

describe('entity canonical path', () => {
    it('maps each entity kind onto its keyword prefix', () => {
        expect(entityCanonicalPath('product', 'codex-go-1month')).toBe('/p/codex-go-1month');
        expect(entityCanonicalPath('collection', 'claude-subscription')).toBe('/c/claude-subscription');
    });

    it('keeps a non-latin slug reachable by encoding it', () => {
        expect(entityCanonicalPath('product', '中转')).toBe('/p/%E4%B8%AD%E8%BD%AC');
        expect(entityCanonicalPath('product', 'a b')).toBe('/p/a%20b');
    });

    it('returns nothing so callers keep the identity route', () => {
        expect(entityCanonicalPath('product', '')).toBeUndefined();
        expect(entityCanonicalPath('product', '   ')).toBeUndefined();
        expect(entityCanonicalPath('product', null)).toBeUndefined();
        expect(entityCanonicalPath('collection', undefined)).toBeUndefined();
    });
});

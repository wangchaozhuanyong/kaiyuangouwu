import { describe, expect, it } from 'vitest';

import { performanceMetricPayload, performancePageType } from './storefront-performance';

describe('anonymous performance records', () => {
    it('retains only numeric metric fields, never DOM, URL or attribution target', () => {
        const result = performanceMetricPayload({
            name: 'LCP',
            value: 1500,
            id: 'secret-id',
            entries: [],
            attribution: {
                target: 'input#password',
                url: 'https://store.test/order?id=secret',
                timeToFirstByte: 200,
                resourceLoadDelay: 300,
                resourceLoadDuration: 500,
                elementRenderDelay: 500,
            },
        } as never);
        expect(result).toEqual({
            name: 'LCP',
            value: 1500,
            phases: { ttfb: 200, resourceLoadDelay: 300, resourceLoadDuration: 500, elementRenderDelay: 500 },
        });
        expect(JSON.stringify(result)).not.toContain('secret');
    });
    it('rejects invalid measurements and coarsens private routes', () => {
        expect(performanceMetricPayload({ name: 'CLS', value: NaN } as never)).toBeUndefined();
        expect(performancePageType('/order-detail')).toBe('other');
        expect(performancePageType('/category')).toBe('catalog');
    });
});

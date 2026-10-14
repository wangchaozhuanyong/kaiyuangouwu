// @vitest-environment jsdom
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { ListSkeleton } from '../../storefront-ui/page-shell';

describe('responsive category pending structure', () => {
    it('keeps the media, name, description, delivery and price slots used by responsive cards', () => {
        const host = document.createElement('div');
        host.innerHTML = renderToStaticMarkup(
            <ListSkeleton layout="products" responsiveRow count={12} label="Loading category" />,
        );
        const cards = host.querySelectorAll('.product-card.is-responsive-row');
        expect(cards).toHaveLength(12);
        for (const card of cards) {
            for (const selector of [
                '.product-card-media',
                '.product-card-name',
                '.product-card-subtitle',
                '.product-card-meta',
                '.product-card-price',
                '.product-card-stock',
            ])
                expect(card.querySelector(selector)).not.toBeNull();
        }
        expect(host.querySelector('[role="status"]')?.getAttribute('aria-label')).toBe('Loading category');
        expect(host.querySelector('a,button')).toBeNull();
        expect(host.querySelector('.product-row-skeleton')).toBeNull();
    });
});

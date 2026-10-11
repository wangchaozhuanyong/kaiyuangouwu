// @vitest-environment jsdom
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';

import { EmbeddedSearchLoading } from './search-loading';

it('shows the discover layout without enabling navigation or history actions before the module loads', () => {
    const host = document.createElement('div');
    host.innerHTML = renderToStaticMarkup(<EmbeddedSearchLoading isZh categoryCount={9} />);
    expect(host.querySelector('[data-page-pending="module"][aria-busy="true"]')).not.toBeNull();
    expect(host.querySelector('.search-recent .search-history-actions')).not.toBeNull();
    expect(host.querySelectorAll('.search-loading-category')).toHaveLength(9);
    expect(host.querySelectorAll('.product-row-skeleton')).toHaveLength(10);
    expect(host.querySelector('a, button, input')).toBeNull();
    expect(host.querySelector('.search-recommendation-list .product-row-bottom')).not.toBeNull();
});

it('keeps discovery areas out of a submitted-search module wait', () => {
    const html = renderToStaticMarkup(<EmbeddedSearchLoading isZh={false} categoryCount={9} results />);
    expect(html).toContain('search-results');
    expect(html).not.toContain('search-recent');
    expect(html).not.toContain('search-category-links');
    expect(html.match(/product-row-skeleton/g)).toHaveLength(12);
});

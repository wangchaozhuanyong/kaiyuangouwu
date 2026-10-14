import { createElement } from 'react';

import commerceStyles from './styles/commerce-surfaces.css?inline';
import homeStyles from './styles/home-showcase.css?inline';

// Category sorting and responsive product rows also depend on commerce surfaces.
// Keep one identical resource on the server and client, before common overrides.
const sharedCommerceStyles = `${homeStyles}\n${commerceStyles}`;

// This module is imported only by lazy commerce routes. Inserting before the
// common stylesheet preserves the cascade without an extra CSS request or an
// unstyled first render when navigating from an authentication page.
if (
    typeof document !== 'undefined' &&
    !document.querySelector('style[data-href="storefront-home-showcase"]')
) {
    const commonStyle = document.head.querySelector('link[rel="stylesheet"], style[data-vite-dev-id]');
    const style = document.createElement('style');
    style.setAttribute('data-storefront-commerce', '');
    style.dataset.href = 'storefront-home-showcase';
    style.dataset.precedence = 'commerce';
    style.textContent = sharedCommerceStyles;
    document.head.insertBefore(style, commonStyle);
}

/** Emit the same resource during SSR so the first frame has its category/media layout. */
export function CommercePageStyles() {
    return createElement(
        'style',
        { href: 'storefront-home-showcase', precedence: 'commerce' },
        sharedCommerceStyles,
    );
}

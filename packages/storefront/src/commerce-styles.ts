import { createElement } from 'react';

import commerceStyles from './styles/commerce-surfaces.css?inline';
import homeStyles from './styles/home-showcase.css?inline';

// This module is imported only by lazy commerce routes. Inserting before the
// common stylesheet preserves the cascade without an extra CSS request or an
// unstyled first render when navigating from an authentication page.
if (typeof document !== 'undefined' && !document.querySelector('style[data-storefront-commerce]')) {
    const commonStyle = document.head.querySelector('link[rel="stylesheet"], style[data-vite-dev-id]');
    // Some commerce routes share home/service surfaces. Keep direct entry styled,
    // while reusing the resource already emitted by a server-rendered homepage.
    if (!document.querySelector('style[data-href="storefront-home-showcase"]')) {
        const homeStyle = document.createElement('style');
        homeStyle.dataset.href = 'storefront-home-showcase';
        homeStyle.dataset.precedence = 'commerce';
        homeStyle.textContent = homeStyles;
        document.head.insertBefore(homeStyle, commonStyle);
    }
    const style = document.createElement('style');
    style.setAttribute('data-storefront-commerce', '');
    style.textContent = commerceStyles;
    document.head.insertBefore(style, commonStyle);
}

/** Emit the same resource during SSR so the first frame has its category/media layout. */
export function CommercePageStyles() {
    return createElement('style', { href: 'storefront-home-showcase', precedence: 'commerce' }, homeStyles);
}

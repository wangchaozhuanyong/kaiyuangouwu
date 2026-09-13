import commerceStyles from './styles/commerce-surfaces.css?inline';

// This module is imported only by lazy commerce routes. Inserting before the
// common stylesheet preserves the cascade without an extra CSS request or an
// unstyled first render when navigating from an authentication page.
if (typeof document !== 'undefined' && !document.querySelector('style[data-storefront-commerce]')) {
    const style = document.createElement('style');
    style.setAttribute('data-storefront-commerce', '');
    style.textContent = commerceStyles;
    const commonStyle = document.head.querySelector('link[rel="stylesheet"], style[data-vite-dev-id]');
    document.head.insertBefore(style, commonStyle);
}

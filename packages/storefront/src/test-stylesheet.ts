import { readFileSync } from 'node:fs';

function inlineStylesheet(url: URL, ancestors = new Set<string>()): string {
    if (ancestors.has(url.href)) throw new Error(`Circular stylesheet import: ${url.pathname}`);
    const nextAncestors = new Set([...ancestors, url.href]);
    return readFileSync(url, 'utf8').replace(
        /@import\s+["'](\.{1,2}\/[^"']+)["'];/g,
        (_, relativePath: string) => inlineStylesheet(new URL(relativePath, url), nextAncestors),
    );
}

export function readStorefrontStylesheet(additionalStylePaths: string[] = []): string {
    const paths = [
        './styles/commerce-surfaces.css',
        './styles.css',
        './styles/desktop-layout.css',
        './styles/account-catalog-surfaces.css',
        './styles/account-security.css',
        './styles/subpage-content.css',
        './styles/product-detail-surfaces.css',
        './styles/search-surfaces.css',
        './styles/checkout-payment-surfaces.css',
        ...additionalStylePaths,
    ];
    return paths.map(relativePath => inlineStylesheet(new URL(relativePath, import.meta.url))).join('\n');
}

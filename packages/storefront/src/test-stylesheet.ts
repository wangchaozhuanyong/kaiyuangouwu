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
    const paths = ['./styles.css', './styles/desktop-layout.css', ...additionalStylePaths];
    return paths.map(relativePath => inlineStylesheet(new URL(relativePath, import.meta.url))).join('\n');
}

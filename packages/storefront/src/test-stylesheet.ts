import { readFileSync } from 'node:fs';

export function readStorefrontStylesheet(additionalStylePaths: string[] = []): string {
    const mainUrl = new URL('./styles.css', import.meta.url);
    const mainCss = readFileSync(mainUrl, 'utf8');
    const inlined = mainCss.replace(/@import\s+["'](\.\/styles\/[^"']+)["'];/g, (_, relativePath) => {
        return readFileSync(new URL(relativePath, mainUrl), 'utf8');
    });
    const desktopUrl = new URL('./styles/desktop-layout.css', import.meta.url);
    const additionalStyles = additionalStylePaths.map(relativePath => {
        return readFileSync(new URL(relativePath, mainUrl), 'utf8');
    });
    return [inlined, readFileSync(desktopUrl, 'utf8'), ...additionalStyles].join('\n');
}

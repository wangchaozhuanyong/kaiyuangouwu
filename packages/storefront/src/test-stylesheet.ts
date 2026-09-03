import { readFileSync } from 'node:fs';

export function readStorefrontStylesheet(): string {
    const mainUrl = new URL('./styles.css', import.meta.url);
    const mainCss = readFileSync(mainUrl, 'utf8');
    const inlined = mainCss.replace(/@import\s+["'](\.\/styles\/[^"']+)["'];/g, (_, relativePath) => {
        return readFileSync(new URL(relativePath, mainUrl), 'utf8');
    });
    const desktopUrl = new URL('./styles/desktop-layout.css', import.meta.url);
    return `${inlined}\n${readFileSync(desktopUrl, 'utf8')}`;
}

import { load } from 'cheerio';

export function promotionAssetPaths(html: string, origin: string): Set<string> {
    const paths = new Set<string>();
    const add = (value: string | undefined) => {
        if (!value) return;
        try {
            const url = new URL(value, origin);
            if (url.origin === origin && url.pathname.startsWith('/assets/')) {
                paths.add(decodeURIComponent(url.pathname).slice('/assets/'.length));
            }
        } catch {
            /* Invalid URLs do not grant access. */
        }
    };
    const $ = load(html);
    $('[src]').each((_i, element) => {
        add($(element).attr('src'));
    });
    $('[srcset]').each((_i, element) => {
        for (const candidate of ($(element).attr('srcset') ?? '').split(',')) {
            add(candidate.trim().split(/\s+/)[0]);
        }
    });
    $('meta[property="og:image"]').each((_i, element) => {
        add($(element).attr('content'));
    });
    const styles =
        $('style').text() +
        $('[style]')
            .toArray()
            .map(e => $(e).attr('style'))
            .join(' ');
    for (const match of styles.matchAll(/url\(\s*['"]?([^'")]+)['"]?\s*\)/g)) add(match[1]);
    return paths;
}

import { BlogSourceImage } from '@vendure/storefront-content-plugin';
import { load } from 'cheerio';

import { citationUrl, hash } from './content';
import { sourceAllows } from './sources';
/** Each publisher owns its image origins; do not admit an arbitrary URL from HTML. */
export function imageAllowed(code: string, raw: string, page: string) {
    try {
        const u = new URL(raw);
        if (u.protocol !== 'https:' || u.port || u.username || u.password) return false;
        if (code === 'skill') {
            const p = new URL(page);
            const parts = p.pathname.split('/').filter(Boolean);
            return (
                p.hostname === 'github.com' &&
                /^[a-f0-9]{40}$/u.test(parts[3] ?? '') &&
                ((u.hostname === 'raw.githubusercontent.com' &&
                    u.pathname.startsWith(`/${parts[0]}/${parts[1]}/${parts[3]}/`)) ||
                    (u.hostname === 'github.com' &&
                        u.pathname.startsWith(`/${parts[0]}/${parts[1]}/raw/${parts[3]}/`)))
            );
        }
        if (!sourceAllows(code, page)) return false;
        if (sourceAllows(code, raw)) return true;
        if (code === 'anthropic')
            return u.hostname === 'www-cdn.anthropic.com' && u.pathname.startsWith('/images/');
        if (code === 'gemini-blog')
            return (
                u.hostname === 'storage.googleapis.com' &&
                u.pathname.startsWith('/gweb-uniblog-publish-prod/images/')
            );
        return (
            code === 'openai' && (u.hostname === 'images.ctfassets.net' || u.hostname === 'images.openai.com')
        );
    } catch {
        return false;
    }
}
export function extractSourceImages(code: string, html: string, page: string): BlogSourceImage[] {
    const $ = load(html);
    const images: BlogSourceImage[] = [];
    const add = (raw: string | undefined, alt = '', caption = '', credit = '') => {
        if (!raw || images.length >= 6) return;
        try {
            let u = new URL(raw, page);
            // Publisher image proxy: retain the underlying original, still subject to its origin policy.
            if (u.pathname === '/_next/image' && u.searchParams.get('url'))
                u = new URL(u.searchParams.get('url') ?? '', page);
            const url = citationUrl(u.href);
            if (!imageAllowed(code, url, page) || images.some(x => x.url === url)) return;
            images.push({
                key: hash(`${page}:${url}`),
                sourceCode: code,
                sourcePageUrl: page,
                url,
                alt: alt.slice(0, 250),
                caption: caption.slice(0, 500),
                credit: credit.slice(0, 250),
            });
        } catch {
            /* Ignore malformed candidates, never broaden the origin policy. */
        }
    };
    // Metadata identifies this story; broad main img selectors often pick related-story thumbnails.
    add($('meta[property="og:image"]').attr('content'), $('meta[property="og:image:alt"]').attr('content'));
    $('script[type="application/ld+json"]').each((_, el) => {
        try {
            const visit = (x: any) => {
                if (Array.isArray(x)) return x.forEach(visit);
                if (!x || typeof x !== 'object') return;
                if (x['@graph']) visit(x['@graph']);
                if (String(x['@type']).match(/Article|BlogPosting/u))
                    for (const im of [x.image].flat())
                        add(typeof im === 'string' ? im : im?.url, im?.caption);
            };
            visit(JSON.parse($(el).text()));
        } catch {
            /* Invalid JSON-LD cannot become an image URL. */
        }
    });
    $('article figure img,article [class*="body"] img,main figure img').each((_, el) => {
        const image = $(el);
        const figure = image.closest('figure');
        if (image.closest('aside,nav,[class*="related"],[class*="recommend"],a[href]').length) return;
        if (Number(image.attr('width') || 1000) < 300) return;
        add(
            image.attr('src') ||
                image.attr('data-src') ||
                image.attr('srcset')?.split(',').at(-1)?.trim().split(/\s/u)[0],
            image.attr('alt'),
            figure.find('figcaption').text(),
            figure.find('[class*="credit"]').text(),
        );
    });
    add($('meta[name="twitter:image"]').attr('content'));
    return images.slice(0, 3);
}

export function extractSkillImages(e: {
    repository: string;
    commit: string;
    directory: string;
    body: string;
}): BlogSourceImage[] {
    const page = `https://github.com/${e.repository}/blob/${e.commit}/${e.directory ? `${e.directory}/` : ''}SKILL.md`;
    const base = `https://raw.githubusercontent.com/${e.repository}/${e.commit}/${e.directory ? `${e.directory}/` : ''}`;
    const images: BlogSourceImage[] = [];
    for (const match of e.body.matchAll(/!\[([^\]]*)\]\(([^\s)]+)(?:\s+"[^"]*")?\)/gu)) {
        try {
            const url = new URL(match[2], base).href;
            if (imageAllowed('skill', url, page) && !images.some(x => x.url === url))
                images.push({
                    key: hash(page + url),
                    sourceCode: 'skill',
                    sourcePageUrl: page,
                    url,
                    alt: match[1].slice(0, 250),
                    caption: match[1].slice(0, 500),
                    credit: e.repository,
                });
        } catch {
            /* Ignore unconfigured or malformed remote media. */
        }
    }
    return images.slice(0, 3);
}

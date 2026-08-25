import { filterXSS, IFilterXSSOptions, IWhiteList } from 'xss';

import { storefrontWebpUrl } from './responsive-image';

const PRODUCT_DESCRIPTION_ALLOW_LIST: IWhiteList = {
    a: ['href', 'title'],
    b: [],
    blockquote: [],
    br: [],
    code: [],
    em: [],
    figcaption: [],
    figure: [],
    h2: [],
    h3: [],
    h4: [],
    h5: [],
    h6: [],
    hr: [],
    i: [],
    img: ['src', 'alt', 'title', 'width', 'height', 'loading'],
    li: [],
    ol: [],
    p: [],
    pre: [],
    s: [],
    span: [],
    strong: [],
    sub: [],
    sup: [],
    table: [],
    tbody: [],
    td: ['colspan', 'rowspan'],
    tfoot: [],
    th: ['colspan', 'rowspan', 'scope'],
    thead: [],
    tr: [],
    u: [],
    ul: [],
};

const STRIP_UNSAFE_CONTENT_TAGS = ['script', 'style', 'iframe', 'object', 'embed', 'template', 'svg', 'math'];

const PRODUCT_DESCRIPTION_OPTIONS: IFilterXSSOptions = {
    allowList: PRODUCT_DESCRIPTION_ALLOW_LIST,
    stripIgnoreTag: true,
    stripIgnoreTagBody: STRIP_UNSAFE_CONTENT_TAGS,
};

const PLAIN_TEXT_OPTIONS: IFilterXSSOptions = {
    allowList: {},
    stripIgnoreTag: true,
    stripIgnoreTagBody: STRIP_UNSAFE_CONTENT_TAGS,
};

const BLOCK_BOUNDARY_PATTERN =
    /<(?:br\s*\/?>|\/(?:blockquote|figcaption|figure|h[1-6]|li|p|pre|t[dh]|tr))>/gi;
const IMAGE_TAG_PATTERN = /<img\b[^>]*>/gi;
const IMAGE_SOURCE_PATTERN = /(\bsrc=)(["'])(.*?)\2/i;

export function sanitizeProductDescription(value: string | null | undefined): string {
    if (!value?.trim()) return '';
    const sanitized = filterXSS(value.trim(), PRODUCT_DESCRIPTION_OPTIONS);
    return sanitized.replace(IMAGE_TAG_PATTERN, imageTag => {
        const sourceMatch = imageTag.match(IMAGE_SOURCE_PATTERN);
        if (!sourceMatch) return '';
        const [, prefix, quote, source] = sourceMatch;
        const decodedSource = source.replace(/&amp;/gi, '&');
        const webpSource = safeRichTextImageUrl(decodedSource);
        if (!webpSource) return '';
        const escapedSource = webpSource
            .replace(/&/g, '&amp;')
            .replace(quote === '"' ? /"/g : /'/g, quote === '"' ? '&quot;' : '&#39;');
        return imageTag.replace(IMAGE_SOURCE_PATTERN, `${prefix}${quote}${escapedSource}${quote}`);
    });
}

function safeRichTextImageUrl(source: string): string | null {
    if (/^(?:https?:)?\/\//i.test(source)) return null;
    const webpSource = storefrontWebpUrl(source, 'detail');
    if (webpSource !== source) return webpSource;
    try {
        const url = new URL(source, 'https://storefront.invalid');
        return /\.(?:svg|webp)$/i.test(url.pathname) ? `${url.pathname}${url.search}${url.hash}` : null;
    } catch {
        return null;
    }
}

export function productDescriptionText(value: string | null | undefined): string {
    const sanitized = sanitizeProductDescription(value);
    if (!sanitized) return '';

    const textWithBoundaries = sanitized.replace(BLOCK_BOUNDARY_PATTERN, ' ');
    const encodedText = filterXSS(textWithBoundaries, PLAIN_TEXT_OPTIONS);
    return decodeHtmlEntities(encodedText).replace(/\s+/g, ' ').trim();
}

function decodeHtmlEntities(value: string): string {
    if (typeof DOMParser !== 'undefined') {
        return new DOMParser().parseFromString(value, 'text/html').documentElement.textContent ?? '';
    }

    return value.replace(/&(#x[\da-f]+|#\d+|amp|apos|gt|lt|nbsp|quot);/gi, (entity, code: string) => {
        const normalizedCode = code.toLowerCase();
        const namedEntities: Record<string, string> = {
            amp: '&',
            apos: "'",
            gt: '>',
            lt: '<',
            nbsp: ' ',
            quot: '"',
        };
        if (namedEntities[normalizedCode]) return namedEntities[normalizedCode];

        const codePoint = normalizedCode.startsWith('#x')
            ? Number.parseInt(normalizedCode.slice(2), 16)
            : Number.parseInt(normalizedCode.slice(1), 10);
        return Number.isFinite(codePoint) && codePoint > 0 && codePoint <= 0x10ffff
            ? String.fromCodePoint(codePoint)
            : entity;
    });
}

import { filterXSS, IFilterXSSOptions, IWhiteList } from 'xss';

import { type SanitizedContentHtml } from '../../storefront-content-plugin/src/shared/content-text';

import { storefrontWebpUrl } from './responsive-image';

const PRODUCT_DESCRIPTION_ALLOW_LIST: IWhiteList = {
    a: ['href', 'title'],
    b: [],
    blockquote: [],
    br: [],
    code: [],
    div: [],
    em: [],
    figcaption: [],
    figure: [],
    h1: [],
    h2: [],
    h3: [],
    h4: [],
    h5: [],
    h6: [],
    hr: [],
    i: [],
    img: ['src', 'alt', 'title', 'width', 'height', 'loading'],
    li: ['value'],
    ol: ['start', 'reversed'],
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

const PRODUCT_DESCRIPTION_TEXT_OPTIONS: IFilterXSSOptions = {
    ...PRODUCT_DESCRIPTION_OPTIONS,
    allowList: Object.fromEntries(
        Object.entries(PRODUCT_DESCRIPTION_ALLOW_LIST).filter(([tag]) => tag !== 'img'),
    ),
    stripIgnoreTagBody: [...STRIP_UNSAFE_CONTENT_TAGS, 'video', 'audio', 'picture'],
};

const PLAIN_TEXT_OPTIONS: IFilterXSSOptions = {
    allowList: {},
    stripIgnoreTag: true,
    stripIgnoreTagBody: STRIP_UNSAFE_CONTENT_TAGS,
};

const BLOCK_BOUNDARY_PATTERN =
    /<(?:br\s*\/?>|\/(?:blockquote|div|figcaption|figure|h[1-6]|li|p|pre|t[dh]|tr))>/gi;
const IMAGE_TAG_PATTERN = /<img\b[^>]*>/gi;
const IMAGE_SOURCE_PATTERN = /(\bsrc=)(["'])(.*?)\2/i;

const CONTENT_HTML_PATTERN = new RegExp(
    `<\\/?(?:${[...Object.keys(PRODUCT_DESCRIPTION_ALLOW_LIST), ...STRIP_UNSAFE_CONTENT_TAGS].join('|')})\\b[^>]*>`,
    'i',
);

export function sanitizeProductDescription(
    value: string | null | undefined,
    { textOnly = false }: { textOnly?: boolean } = {},
): SanitizedContentHtml {
    if (!value?.trim()) return '' as SanitizedContentHtml;
    const normalized = value.trim().replace(/\r\n?/g, '\n');
    if (!CONTENT_HTML_PATTERN.test(normalized)) {
        return normalized
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/\n/g, '<br>') as SanitizedContentHtml;
    }
    const contentSource = textOnly
        ? normalized.replace(/<(p|figure)\b[^>]*>([\s\S]*?)<\/\1>/gi, (block, _tag, body: string) =>
              /<(?:img|video|audio|picture)\b/i.test(body) &&
              !filterXSS(body, PRODUCT_DESCRIPTION_TEXT_OPTIONS).trim()
                  ? ''
                  : block,
          )
        : normalized;
    const sanitized = filterXSS(
        contentSource,
        textOnly ? PRODUCT_DESCRIPTION_TEXT_OPTIONS : PRODUCT_DESCRIPTION_OPTIONS,
    );
    if (textOnly) return sanitized.trim() as SanitizedContentHtml;
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
    }) as SanitizedContentHtml;
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

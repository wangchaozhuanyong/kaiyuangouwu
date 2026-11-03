/** Public, server-resolved metadata. No drafts, platform records, credentials or private data. */
export interface PublicSeoDocument {
    schemaVersion: 1;
    published: boolean;
    indexable: boolean;
    host: string;
    channelCode: string;
    languageCode: 'zh_Hans' | 'en';
    requestKey: string;
    title: string;
    siteName?: string;
    description: string;
    shareTitle?: string;
    shareDescription?: string;
    canonical: string;
    robots: string;
    image: string | null;
    alternates: Array<{ language: 'zh-CN' | 'en' | 'x-default'; href: string }>;
    structuredData: Array<Record<string, unknown>>;
    reasons: string[];
    version: number;
    documentVersion?: number;
}

export interface PublicGuideContent {
    id: string;
    title: string;
    body: string;
    summary: string;
    authorName: string;
    reviewerName: string;
    reviewedAt: string;
    publishedAt: string;
    sources: Array<{ label: string; url: string; accessedAt: string | null }>;
    relatedProducts: Array<{ id: string; name: string }>;
}

export function escapePublicHtml(value: string): string {
    return value.replace(
        /[&<>"']/gu,
        character =>
            ({
                '&': '&amp;',
                '<': '&lt;',
                '>': '&gt;',
                '"': '&quot;',
                "'": '&#39;',
            })[character] ?? character,
    );
}

export function serializePublicJson(value: unknown): string {
    return JSON.stringify(value).replace(
        /[<>&\u2028\u2029]/gu,
        character => `\\u${character.charCodeAt(0).toString(16).padStart(4, '0')}`,
    );
}

/** Public tool copy is shared by the first HTML response and client navigation. */
export function storefrontToolShareMetadata(pathname: string, languageCode: 'zh_Hans' | 'en') {
    if (pathname !== '/two-factor' && pathname !== '/two-factor/') return;
    const isZh = languageCode === 'zh_Hans';
    return {
        title: isZh ? '2FA 动态验证码工具' : '2FA authenticator tool',
        description: isZh
            ? '快速查询 6 位动态验证码，支持多账号管理与批量导入。动态码在浏览器本地生成。'
            : 'Generate 6-digit verification codes locally in your browser. Manage multiple accounts and import them in bulk.',
        image: '/storefront/two-factor-social-v1.png',
        imageWidth: 1731,
        imageHeight: 909,
        imageAlt: isZh
            ? '2FA 动态验证码：本地生成、多账号管理、批量导入'
            : '2FA: local codes, multiple accounts and bulk import',
    };
}

/** Share tags only: SSI must not change indexing or duplicate the document title. */
export function renderPublicShareHead(document: {
    title: string;
    description: string;
    canonical: string;
    image: string | null;
    languageCode: 'zh_Hans' | 'en';
    siteName?: string;
    imageAlt?: string;
    imageWidth?: number;
    imageHeight?: number;
}): string {
    const meta = (name: string, value: string, property = false) =>
        `<meta ${property ? 'property' : 'name'}="${escapePublicHtml(name)}" content="${escapePublicHtml(value)}">`;
    return [
        meta('og:title', document.title, true),
        meta('og:description', document.description, true),
        meta('og:url', document.canonical, true),
        meta('og:type', 'website', true),
        meta('og:locale', document.languageCode === 'zh_Hans' ? 'zh_CN' : 'en', true),
        ...(document.siteName ? [meta('og:site_name', document.siteName, true)] : []),
        meta('twitter:card', document.image ? 'summary_large_image' : 'summary'),
        meta('twitter:title', document.title),
        meta('twitter:description', document.description),
        ...(document.image
            ? [
                  meta('og:image', document.image, true),
                  meta('twitter:image', document.image),
                  ...(document.imageWidth && document.imageHeight
                      ? [
                            meta('og:image:width', String(document.imageWidth), true),
                            meta('og:image:height', String(document.imageHeight), true),
                        ]
                      : []),
                  ...(document.imageAlt
                      ? [
                            meta('og:image:alt', document.imageAlt, true),
                            meta('twitter:image:alt', document.imageAlt),
                        ]
                      : []),
              ]
            : []),
    ].join('\n');
}

/** Controlled output only; merchants never supply an executable head fragment. */
export function renderPublicSeoHead(document: PublicSeoDocument): string {
    const escape = escapePublicHtml;
    const meta = (name: string, value: string, property = false) =>
        `<meta ${property ? 'property' : 'name'}="${escape(name)}" content="${escape(value)}">`;
    return [
        `<title>${escape(document.title)}</title>`,
        meta('description', document.description),
        meta('robots', document.robots),
        `<link rel="canonical" href="${escape(document.canonical)}">`,
        ...document.alternates.map(
            alternate =>
                `<link rel="alternate" hreflang="${alternate.language}" href="${escape(alternate.href)}">`,
        ),
        renderPublicShareHead({
            ...document,
            title: document.shareTitle || document.title,
            description: document.shareDescription || document.description,
        }),
        ...document.structuredData.map(
            data =>
                `<script type="application/ld+json" data-storefront-seo>${serializePublicJson(data)}</script>`,
        ),
    ].join('\n');
}

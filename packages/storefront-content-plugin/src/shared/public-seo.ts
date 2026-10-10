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
        meta('og:title', document.shareTitle || document.title, true),
        meta('og:description', document.shareDescription || document.description, true),
        meta('og:url', document.canonical, true),
        meta('og:type', 'website', true),
        meta('og:locale', document.languageCode === 'zh_Hans' ? 'zh_CN' : 'en', true),
        meta('twitter:card', document.image ? 'summary_large_image' : 'summary'),
        meta('twitter:title', document.shareTitle || document.title),
        meta('twitter:description', document.shareDescription || document.description),
        ...(document.image
            ? [meta('og:image', document.image, true), meta('twitter:image', document.image)]
            : []),
        ...document.structuredData.map(
            data =>
                `<script type="application/ld+json" data-storefront-seo>${serializePublicJson(data)}</script>`,
        ),
    ].join('\n');
}

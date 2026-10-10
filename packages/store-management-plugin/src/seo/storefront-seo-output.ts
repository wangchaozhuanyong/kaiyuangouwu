import {
    escapePublicHtml,
    publicPageRequestKey,
    publicPageRouteHref,
    type PublicPageRequest,
    type PublicSeoDocument,
} from '@vendure/storefront-content-plugin';

import {
    type StorefrontSeoDocument,
    type StorefrontSeoLanguage,
    type StorefrontSeoPublicSettings,
} from './storefront-seo.contract';

export interface PublicSeoFacts {
    host: string;
    primaryHost: string | null;
    channelCode: string;
    languageCode: StorefrontSeoLanguage;
    mode: string;
    title: string;
    storeName: string;
    description: string;
    image: string | null;
    completeLanguages: StorefrontSeoLanguage[];
    structuredData: Array<Record<string, unknown>>;
}

function localized(path: string, language: StorefrontSeoLanguage) {
    return `/${language === 'zh_Hans' ? 'zh' : 'en'}${path}`;
}

/** Same rule for HTML, client metadata and discovery. An override cannot bypass publication/access. */
export function buildPublicSeoDocument(
    request: PublicPageRequest,
    facts: PublicSeoFacts,
    settings: StorefrontSeoPublicSettings | null,
    document: StorefrontSeoDocument | null,
    version: number,
    documentVersion = 0,
): PublicSeoDocument {
    const reasons: string[] = [];
    if (!settings) reasons.push('SEO_NOT_PUBLISHED');
    if (!settings?.indexingEnabled) reasons.push('INDEXING_DISABLED');
    if (facts.mode !== 'LIVE') reasons.push('STORE_NOT_LIVE');
    if (!facts.primaryHost) reasons.push('PRIMARY_DOMAIN_NOT_VERIFIED');
    if (!facts.completeLanguages.includes(facts.languageCode)) reasons.push('LANGUAGE_CONTENT_INCOMPLETE');
    if (!settings?.enabledLanguages.includes(facts.languageCode)) reasons.push('LANGUAGE_DISABLED');
    if (document?.indexMode === 'NOINDEX') reasons.push('PAGE_NOINDEX');
    const filtered =
        request.kind === 'catalog' &&
        (request.path === '/search' ||
            Boolean(request.input.term) ||
            Boolean(request.input.fulfillmentType) ||
            Boolean(request.input.inStockOnly) ||
            request.input.minPriceWithTax != null ||
            request.input.maxPriceWithTax != null ||
            (request.input.sort ?? 'RECOMMENDED') !== 'RECOMMENDED');
    if (filtered) reasons.push('SEARCH_OR_FILTER');
    if (
        request.kind === 'catalog' &&
        ((request.input.take ?? 12) !== 12 || (request.input.skip ?? 0) % 12 !== 0)
    )
        reasons.push('NONSTANDARD_PAGINATION');
    const path = publicPageRouteHref(request);
    const baseHost = facts.primaryHost ?? facts.host;
    const canonical = `https://${baseHost}${localized(path, facts.languageCode)}`;
    const title =
        document?.title.trim() ||
        (settings?.titleTemplates[facts.languageCode] ?? '{title} | {store}')
            .replace(/\{title\}/gu, facts.title || facts.storeName)
            .replace(/\{store\}/gu, facts.storeName)
            .replace(/^\s*\|\s*|\s*\|\s*$/gu, '')
            .trim();
    const description =
        document?.description.trim() ||
        facts.description ||
        settings?.defaultDescriptions[facts.languageCode] ||
        '';
    const indexable = reasons.length === 0;
    return {
        schemaVersion: 1,
        published: settings !== null,
        indexable,
        host: facts.host,
        channelCode: facts.channelCode,
        languageCode: facts.languageCode,
        requestKey: publicPageRequestKey(request),
        title,
        description,
        canonical,
        shareTitle: document?.shareTitle.trim() || title,
        shareDescription: document?.shareDescription.trim() || description,
        robots: indexable ? 'index, follow, max-image-preview:large' : 'noindex, follow',
        image: document?.shareImageUrl || facts.image || settings?.shareImageUrl || null,
        alternates: indexable
            ? facts.completeLanguages
                  .filter(language => settings?.enabledLanguages.includes(language))
                  .map(language => ({
                      language: language === 'zh_Hans' ? ('zh-CN' as const) : ('en' as const),
                      href: `https://${baseHost}${localized(path, language)}`,
                  }))
            : [],
        structuredData: facts.structuredData,
        reasons,
        version,
        documentVersion,
    };
}

/** Do not block public noindex pages: crawlers must retrieve their index directive. */
export function publicRobots(
    settings: StorefrontSeoPublicSettings | null,
    primaryHost: string | null,
    live: boolean,
) {
    const exclusions = [
        'Disallow: /shop-api',
        'Disallow: /admin-api',
        'Disallow: /_storefront/',
        'Disallow: /promo/enter',
        'Disallow: /promo/access',
        'Disallow: /promo/account-entry',
    ];
    const base = ['User-agent: *', 'Allow: /', ...exclusions];
    // Specific user-agent groups do not inherit exclusions from the wildcard group.
    const agent = (name: string, allowed: boolean) =>
        `\nUser-agent: ${name}\n${allowed ? ['Allow: /', ...exclusions].join('\n') : 'Disallow: /'}\n`;
    const allow = live && Boolean(primaryHost);
    return (
        base.join('\n') +
        '\n' +
        agent('Googlebot', settings?.searchCrawlers.google !== false) +
        agent('Bingbot', settings?.searchCrawlers.bing !== false) +
        agent('OAI-SearchBot', settings?.searchCrawlers.openai !== false) +
        agent('PerplexityBot', settings?.searchCrawlers.perplexity !== false) +
        agent('GPTBot', allow && settings?.trainingCrawlers.openai === true) +
        agent('Google-Extended', allow && settings?.trainingCrawlers.google === true) +
        agent('ClaudeBot', allow && settings?.trainingCrawlers.anthropic === true) +
        (primaryHost ? `\nSitemap: https://${primaryHost}/sitemap.xml\n` : '')
    );
}

export function sitemapXml(entries: Array<{ url: string; lastmod?: string }>, index = false): string {
    if (entries.length > 50_000) throw new Error('Sitemap shard exceeds 50000 URLs');
    const root = index ? 'sitemapindex' : 'urlset';
    const tag = index ? 'sitemap' : 'url';
    const xml =
        `<?xml version="1.0" encoding="UTF-8"?>\n<${root} xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
        entries
            .map(
                entry =>
                    `<${tag}><loc>${escapePublicHtml(entry.url)}</loc>${entry.lastmod ? `<lastmod>${escapePublicHtml(entry.lastmod)}</lastmod>` : ''}</${tag}>`,
            )
            .join('\n') +
        `\n</${root}>\n`;
    if (Buffer.byteLength(xml, 'utf8') > 50 * 1024 * 1024) throw new Error('Sitemap shard exceeds 50MB');
    return xml;
}

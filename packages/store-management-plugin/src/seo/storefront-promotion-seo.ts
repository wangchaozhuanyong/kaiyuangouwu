import { renderPublicSeoHead, type PublicSeoDocument } from '@vendure/storefront-content-plugin';
import { load } from 'cheerio';

import {
    type StorefrontSeoDocument,
    type StorefrontSeoLanguage,
    type StorefrontSeoPublicSettings,
} from './storefront-seo.contract';

export interface PromotionSeoInput {
    html: string;
    host: string;
    primaryHost: string | null;
    channelCode: string;
    languageCode: StorefrontSeoLanguage;
    mode: string;
    settings: StorefrontSeoPublicSettings | null;
    document: StorefrontSeoDocument | null;
    settingsVersion: number;
    documentVersion: number;
    languageContentComplete: boolean;
    legacyEntry?: boolean;
}

/** Only consumes already sanitized promotion HTML; the visual script and entry form remain untouched. */
export function resolvePromotionSeo(input: PromotionSeoInput): { seo: PublicSeoDocument; html: string } {
    const dom = load(input.html);
    const renderedTitle = dom('title').first().text().trim();
    const renderedDescription = (
        dom('meta[name="description"]').first().attr('content') ||
        dom('meta[property="og:description"]').first().attr('content') ||
        ''
    ).trim();
    const body = dom('body').clone();
    body.find('script,style,form,[hidden],[aria-hidden="true"]').remove();
    const renderedBody = body.text().replace(/\s+/gu, ' ').trim();
    const htmlLanguage = dom('html').attr('lang') ?? '';
    const localeMatches =
        input.languageCode === 'zh_Hans'
            ? /^zh(?:[-_]|$)/iu.test(htmlLanguage)
            : /^en(?:[-_]|$)/iu.test(htmlLanguage);
    const canonical = `https://${input.primaryHost ?? input.host}/${input.languageCode === 'zh_Hans' ? 'zh' : 'en'}/promo`;
    const reasons: string[] = [];
    if (!input.settings) reasons.push('SEO_NOT_PUBLISHED');
    if (!input.document) reasons.push('PROMO_SEO_NOT_PUBLISHED');
    if (!input.settings?.indexingEnabled) reasons.push('INDEXING_DISABLED');
    if (input.mode !== 'LIVE') reasons.push('STORE_NOT_LIVE');
    if (!input.primaryHost) reasons.push('PRIMARY_DOMAIN_NOT_VERIFIED');
    if (!input.settings?.enabledLanguages.includes(input.languageCode)) reasons.push('LANGUAGE_DISABLED');
    if (
        !input.languageContentComplete ||
        !localeMatches ||
        !renderedBody ||
        !renderedTitle ||
        !renderedDescription
    )
        reasons.push('LANGUAGE_CONTENT_INCOMPLETE');
    if (input.document?.indexMode === 'NOINDEX') reasons.push('PAGE_NOINDEX');
    if (input.legacyEntry) reasons.push('LEGACY_PROMO_ENTRY');
    const title = input.document?.title.trim() || renderedTitle;
    const description = input.document?.description.trim() || renderedDescription;
    const seo: PublicSeoDocument = {
        schemaVersion: 1,
        published: Boolean(input.settings && input.document),
        indexable: reasons.length === 0,
        host: input.host,
        channelCode: input.channelCode,
        languageCode: input.languageCode,
        requestKey: `promo:${input.languageCode}`,
        title,
        description,
        canonical,
        shareTitle:
            input.document?.shareTitle.trim() || dom('meta[property="og:title"]').attr('content') || title,
        shareDescription:
            input.document?.shareDescription.trim() ||
            dom('meta[property="og:description"]').attr('content') ||
            description,
        image:
            input.document?.shareImageUrl ||
            dom('meta[property="og:image"]').attr('content') ||
            input.settings?.shareImageUrl ||
            null,
        robots: reasons.length === 0 ? 'index, follow, max-image-preview:large' : 'noindex, follow',
        alternates: [],
        structuredData: [],
        reasons,
        version: input.settingsVersion,
        documentVersion: input.documentVersion,
    };
    dom(
        'title,meta[name="description"],meta[name="robots"],meta[property^="og:"],meta[name^="twitter:"],link[rel="canonical"],link[rel="alternate"]',
    ).remove();
    dom('head').append(renderPublicSeoHead(seo));
    return { seo, html: dom.html() };
}

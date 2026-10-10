/** Pure shared contract: no Nest, database or browser dependencies. */
export const storefrontSeoTargetTypes = [
    'SETTINGS',
    'HOME',
    'PRODUCT',
    'COLLECTION',
    'PAGE',
    'ARTICLE',
] as const;
export type StorefrontSeoTargetType = (typeof storefrontSeoTargetTypes)[number];
export const storefrontSeoLanguages = ['zh_Hans', 'en'] as const;
export type StorefrontSeoLanguage = (typeof storefrontSeoLanguages)[number];
export const storefrontSeoPageKeys = ['services', 'support', 'terms', 'privacy', 'promo'] as const;
export interface StorefrontSeoIdentity {
    targetType: StorefrontSeoTargetType;
    targetId: string;
    languageCode: StorefrontSeoLanguage | 'und';
}
export interface StorefrontSeoRedirect {
    from: string;
    to: string;
    status: 301 | 308;
}
export interface StorefrontSeoPlatformBinding {
    platform: 'GSC' | 'BING' | 'GA4' | 'MERCHANT_CENTER';
    property: string;
    status: 'UNVERIFIED' | 'VERIFIED';
    verifiedAt: string | null;
    note: string;
}
export interface StorefrontSeoMetric {
    id: string;
    source: 'GSC' | 'GOOGLE_AI' | 'GA4' | 'BING' | 'MANUAL';
    property: string;
    dateFrom: string;
    dateTo: string;
    url: string;
    languageCode: string;
    country: string;
    device: string;
    status: 'MEASURED' | 'NO_ACCESS' | 'DATA_MISSING' | 'NOT_MEASURED';
    impressions: number | null;
    clicks: number | null;
    sessions: number | null;
    orders: number | null;
    revenue: number | null;
    currencyCode: string;
    importedAt: string;
    evidenceUrl: string;
}
export interface StorefrontSeoAiCitation {
    id: string;
    platform: string;
    prompt: string;
    url: string;
    observedAt: string;
    languageCode: string;
    region: string;
    kind: 'CITATION' | 'MENTION';
    evidenceUrl: string;
    notes: string;
}
export interface StorefrontSeoSettings {
    indexingEnabled: boolean;
    enabledLanguages: StorefrontSeoLanguage[];
    titleTemplates: Record<StorefrontSeoLanguage, string>;
    defaultDescriptions: Record<StorefrontSeoLanguage, string>;
    shareImageUrl: string;
    searchCrawlers: { google: boolean; bing: boolean; openai: boolean; perplexity: boolean };
    trainingCrawlers: { openai: boolean; google: boolean; anthropic: boolean };
    llmsEnabled: boolean;
    organization: {
        businessType: 'Organization' | 'LocalBusiness';
        sameAs: string[];
        publicAddress: string;
        serviceAreas: string[];
        evidenceUrl: string;
        reviewedAt: string | null;
    };
    redirects: StorefrontSeoRedirect[];
    /** Admin-only evidence. Never include in publicConfiguration or anonymous HTML. */
    platformBindings: StorefrontSeoPlatformBinding[];
    metrics: StorefrontSeoMetric[];
    aiCitations: StorefrontSeoAiCitation[];
}
export type StorefrontSeoPublicSettings = Omit<
    StorefrontSeoSettings,
    'platformBindings' | 'metrics' | 'aiCitations'
>;
export interface StorefrontSeoArticle {
    body: string;
    summary: string;
    authorName: string;
    reviewerName: string;
    reviewedAt: string | null;
    sources: Array<{ label: string; url: string; accessedAt: string | null }>;
    relatedProductIds: string[];
}
export interface StorefrontSeoDocument {
    title: string;
    description: string;
    shareTitle: string;
    shareDescription: string;
    shareImageUrl: string;
    indexMode: 'INHERIT' | 'INDEX' | 'NOINDEX';
    article: StorefrontSeoArticle | null;
}
export type StorefrontSeoPayload = StorefrontSeoSettings | StorefrontSeoDocument;
export type StorefrontSeoValue = StorefrontSeoPayload;
export interface StorefrontSeoRecordView extends StorefrontSeoIdentity {
    id: string | null;
    channelId: string;
    draft: StorefrontSeoPayload;
    published: StorefrontSeoPayload | null;
    version: number;
    publishedVersion: number;
    publishedAt: Date | string | null;
    updatedAt: Date | string | null;
    canWrite: boolean;
}
export interface StorefrontSeoIssue extends StorefrontSeoIdentity {
    code: string;
    severity: 'ERROR' | 'WARNING' | 'INFO';
    message: string;
}
export const storefrontSeoSettingsIdentity: StorefrontSeoIdentity = {
    targetType: 'SETTINGS',
    targetId: 'store',
    languageCode: 'und',
};
export function defaultStorefrontSeoSettings(): StorefrontSeoSettings {
    return {
        indexingEnabled: false,
        enabledLanguages: ['zh_Hans', 'en'],
        titleTemplates: { zh_Hans: '{title} | {store}', en: '{title} | {store}' },
        defaultDescriptions: { zh_Hans: '', en: '' },
        shareImageUrl: '',
        searchCrawlers: { google: true, bing: true, openai: true, perplexity: true },
        trainingCrawlers: { openai: false, google: false, anthropic: false },
        llmsEnabled: false,
        organization: {
            businessType: 'Organization',
            sameAs: [],
            publicAddress: '',
            serviceAreas: [],
            evidenceUrl: '',
            reviewedAt: null,
        },
        redirects: [],
        platformBindings: [],
        metrics: [],
        aiCitations: [],
    };
}
export function defaultStorefrontSeoDocument(targetType: StorefrontSeoTargetType): StorefrontSeoDocument {
    return {
        title: '',
        description: '',
        shareTitle: '',
        shareDescription: '',
        shareImageUrl: '',
        indexMode: 'INHERIT',
        article:
            targetType === 'ARTICLE'
                ? {
                      body: '',
                      summary: '',
                      authorName: '',
                      reviewerName: '',
                      reviewedAt: null,
                      sources: [],
                      relatedProductIds: [],
                  }
                : null,
    };
}
export function publicStorefrontSeoSettings(settings: StorefrontSeoSettings): StorefrontSeoPublicSettings {
    const {
        platformBindings: _bindings,
        metrics: _metrics,
        aiCitations: _citations,
        ...publicSettings
    } = settings;
    return publicSettings;
}

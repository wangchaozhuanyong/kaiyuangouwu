import { describe, expect, it } from 'vitest';

import {
    defaultStorefrontSeoSettings,
    publicStorefrontSeoSettings,
    type StorefrontSeoIdentity,
} from './storefront-seo.contract';
import { validateSeoEvidence } from './storefront-seo.evidence';
import {
    validateSeoDocument,
    validateSeoIdentity,
    validateSeoPayloadSize,
    validateSeoRedirects,
    validateSeoSettings,
} from './storefront-seo.validation';

const article: StorefrontSeoIdentity = {
    targetType: 'ARTICLE',
    targetId: 'buying-guide',
    languageCode: 'en',
};
const normalize = (raw: Record<string, unknown>) => validateSeoSettings(raw, validateSeoEvidence(raw));

describe('store-local search configuration boundaries', () => {
    it('defaults to no indexing until a published store policy opts in, with independent training flags', () => {
        const settings = normalize({});
        expect(settings.indexingEnabled).toBe(false);
        expect(settings.searchCrawlers.openai).toBe(true);
        expect(settings.trainingCrawlers.openai).toBe(false);
        expect(
            normalize({ searchCrawlers: { openai: false }, trainingCrawlers: { openai: true } }),
        ).toMatchObject({ searchCrawlers: { openai: false }, trainingCrawlers: { openai: true } });
    });
    it('rejects unsupported facts, secret-bearing input keys and invalid identities', () => {
        expect(() => normalize({ clientSecret: 'hidden' })).toThrow('未支持');
        expect(() => normalize({ shareImageUrl: 'https://store.test/image?access_token=hidden' })).toThrow(
            '凭据',
        );
        expect(() =>
            validateSeoDocument({ price: 10 }, { targetType: 'PRODUCT', targetId: '1', languageCode: 'en' }),
        ).toThrow('未支持');
        expect(() =>
            validateSeoIdentity({ targetType: 'SETTINGS', targetId: 'other', languageCode: 'und' }),
        ).toThrow();
        expect(() => validateSeoIdentity({ ...article, targetId: '../account' })).toThrow();
        expect(() =>
            validateSeoIdentity({ targetType: 'PAGE', targetId: 'about', languageCode: 'en' }),
        ).toThrow('固定页面');
        expect(() => normalize({ enabledLanguages: ['en', 'en'] })).toThrow();
    });
    it('keeps all platform records and AI prompts out of the anonymous configuration', () => {
        const settings = defaultStorefrontSeoSettings();
        settings.platformBindings = [
            {
                platform: 'GSC',
                property: 'sc-domain:store.test',
                status: 'UNVERIFIED',
                verifiedAt: null,
                note: 'admin-only',
            },
        ];
        const publicSettings = publicStorefrontSeoSettings(settings);
        expect(publicSettings).not.toHaveProperty('platformBindings');
        expect(publicSettings).not.toHaveProperty('metrics');
        expect(publicSettings).not.toHaveProperty('aiCitations');
        expect(JSON.stringify(publicSettings)).not.toContain('admin-only');
    });
    it('validates redirects as bounded public paths and rejects loops and transaction routes', () => {
        expect(
            validateSeoRedirects([{ from: '/old-guide', to: '/en/guides/guide', status: 301 }]),
        ).toHaveLength(1);
        expect(
            validateSeoRedirects([{ from: '/terms', to: '/en/legal?id=terms', status: 308 }]),
        ).toHaveLength(1);
        for (const from of ['/account', '/en/orders/123', '/shop-api', '//evil.test/a'])
            expect(() => validateSeoRedirects([{ from, to: '/en/', status: 301 }])).toThrow();
        expect(() =>
            validateSeoRedirects([
                { from: '/en/support', to: '/en/services', status: 301 },
                { from: '/en/services', to: '/en/support', status: 301 },
            ]),
        ).toThrow('循环');
        expect(() =>
            validateSeoRedirects([{ from: '/old', to: '/en/product?id=1&token=secret', status: 301 }]),
        ).toThrow('参数');
        for (const to of [
            '/about',
            '/terms',
            '/privacy',
            '/articles/guide',
            '/product-evil',
            '/en/product',
            '/en/product?id=1&id=2',
            '/en/legal?id=other',
            '/en/guides/guide?id=1',
        ])
            expect(() => validateSeoRedirects([{ from: '/old', to, status: 301 }])).toThrow();
    });
    it('allows article drafts but requires concrete review and sources to publish', () => {
        expect(
            validateSeoDocument({ title: 'Guide', article: { body: 'Draft' } }, article).article?.body,
        ).toBe('Draft');
        expect(() =>
            validateSeoDocument({ title: 'Guide', article: { body: 'Draft' } }, article, true),
        ).toThrow('审核');
        expect(
            validateSeoDocument(
                {
                    title: 'Guide',
                    article: {
                        body: 'Actual documented process',
                        authorName: 'Author',
                        reviewerName: 'Reviewer',
                        reviewedAt: '2026-10-10',
                        sources: [
                            { label: 'Manual', url: 'https://vendor.test/manual', accessedAt: '2026-10-09' },
                        ],
                    },
                },
                article,
                true,
            ).article?.sources,
        ).toHaveLength(1);
    });
    it('counts UTF-8 bytes to stay within the existing SQL text storage limit', () => {
        expect(() =>
            validateSeoPayloadSize(validateSeoDocument({ article: { body: '文'.repeat(21000) } }, article)),
        ).toThrow('60 KB');
    });
});

describe('evidence imports keep absent data distinct from zero', () => {
    const measured = {
        id: 'm1',
        source: 'GSC',
        property: 'sc-domain:store.test',
        dateFrom: '2026-10-01',
        dateTo: '2026-10-09',
        status: 'MEASURED',
        impressions: 0,
    };
    it('accepts a measured zero but rejects invented values on inaccessible reports', () => {
        expect(validateSeoEvidence({ metrics: [measured] }).metrics[0].impressions).toBe(0);
        expect(() => validateSeoEvidence({ metrics: [{ ...measured, status: 'NO_ACCESS' }] })).toThrow('空');
        expect(
            validateSeoEvidence({ metrics: [{ ...measured, status: 'NO_ACCESS', impressions: null }] })
                .metrics[0].clicks,
        ).toBeNull();
        expect(() => validateSeoEvidence({ metrics: [{ ...measured, impressions: null }] })).toThrow('至少');
    });
    it('supports Google AI impressions without manufacturing AI clicks or revenue', () => {
        expect(
            validateSeoEvidence({ metrics: [{ ...measured, source: 'GOOGLE_AI', impressions: 10 }] })
                .metrics[0].clicks,
        ).toBeNull();
        expect(() =>
            validateSeoEvidence({ metrics: [{ ...measured, source: 'GOOGLE_AI', clicks: 1 }] }),
        ).toThrow('只导入');
    });
    it('requires traceable actual dates and distinguishes a citation from a mention', () => {
        expect(() => validateSeoEvidence({ metrics: [{ ...measured, dateFrom: '2026-02-31' }] })).toThrow(
            '日期',
        );
        const sample = {
            id: 'a1',
            platform: 'ChatGPT Search',
            prompt: 'What is available?',
            url: '',
            observedAt: '2026-10-09',
            kind: 'MENTION',
            evidenceUrl: 'https://evidence.test/sample',
        };
        expect(validateSeoEvidence({ aiCitations: [sample] }).aiCitations[0].kind).toBe('MENTION');
        expect(() => validateSeoEvidence({ aiCitations: [{ ...sample, kind: 'CITATION' }] })).toThrow(
            '引用地址',
        );
        expect(() => validateSeoEvidence({ aiCitations: [{ ...sample, evidenceUrl: '' }] })).toThrow('证据');
    });
});

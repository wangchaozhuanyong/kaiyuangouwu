import { load } from 'cheerio';
import { describe, expect, it } from 'vitest';

import { resolvePromotionSeo, type PromotionSeoInput } from './storefront-promotion-seo';
import {
    defaultStorefrontSeoDocument,
    defaultStorefrontSeoSettings,
    publicStorefrontSeoSettings,
} from './storefront-seo.contract';

const fixture = (): PromotionSeoInput => ({
    html:
        '<!doctype html><html lang="en"><head><title>Published shop</title>' +
        '<meta property="og:description" content="Published introduction"><meta name="robots" content="index,nofollow"></head>' +
        '<body><main>Actual published promotion body</main><form action="/promo/enter"><input name="ticket" value="fixture-ticket"></form>' +
        '<script data-promo-visual>const visual = "safe";</script></body></html>',
    host: 'shop.test',
    primaryHost: 'shop.test',
    channelCode: 'shop',
    languageCode: 'en',
    mode: 'LIVE',
    settings: { ...publicStorefrontSeoSettings(defaultStorefrontSeoSettings()), indexingEnabled: true },
    document: {
        ...defaultStorefrontSeoDocument('PAGE'),
        title: 'Published promotion SEO',
        description: 'Search description',
    },
    settingsVersion: 2,
    documentVersion: 4,
    languageContentComplete: true,
});

describe('promotion uses the shared publication and content gates', () => {
    it('qualifies only a published language page and preserves the trusted script and entry form', () => {
        const output = resolvePromotionSeo(fixture());
        const dom = load(output.html);
        expect(output.seo).toMatchObject({
            indexable: true,
            canonical: 'https://shop.test/en/promo',
            version: 2,
            documentVersion: 4,
        });
        expect(dom('script[data-promo-visual]').text()).toBe('const visual = "safe";');
        expect(dom('form').attr('action')).toBe('/promo/enter');
        expect(dom('input[name="ticket"]').val()).toBe('fixture-ticket');
        expect(dom('meta[name="robots"]').attr('content')).toBe(output.seo.robots);
    });
    it.each(['settings', 'document'] as const)('keeps a missing published %s out of indexing', missing => {
        const input = fixture();
        input[missing] = null;
        expect(resolvePromotionSeo(input).seo.indexable).toBe(false);
    });
    it.each(['PREVIEW', 'CLOSED'])('does not let INDEX bypass the %s business gate', mode => {
        const input = fixture();
        input.mode = mode;
        input.document = { ...defaultStorefrontSeoDocument('PAGE'), indexMode: 'INDEX' };
        expect(resolvePromotionSeo(input).seo.reasons).toContain('STORE_NOT_LIVE');
    });
    it('requires rendered locale and real body completeness beyond a translated SEO record', () => {
        expect(resolvePromotionSeo({ ...fixture(), languageContentComplete: false }).seo.reasons).toContain(
            'LANGUAGE_CONTENT_INCOMPLETE',
        );
        expect(resolvePromotionSeo({ ...fixture(), languageCode: 'zh_Hans' }).seo.indexable).toBe(false);
        expect(
            resolvePromotionSeo({
                ...fixture(),
                html: '<html lang="en"><head><title>Shop</title></head><body><form>Enter store</form></body></html>',
            }).seo.indexable,
        ).toBe(false);
    });
    it('retains the legacy entry as noindex with a stable language canonical and escapes custom titles', () => {
        const input = fixture();
        input.legacyEntry = true;
        input.document = {
            ...defaultStorefrontSeoDocument('PAGE'),
            title: '</title><script>unsafe()</script>',
        };
        const output = resolvePromotionSeo(input);
        expect(output.seo).toMatchObject({
            canonical: 'https://shop.test/en/promo',
            robots: 'noindex, follow',
        });
        const dom = load(output.html);
        expect(dom('title').text()).toBe(input.document.title);
        expect(dom('script')).toHaveLength(1);
        expect(dom('script[data-promo-visual]')).toHaveLength(1);
    });
});

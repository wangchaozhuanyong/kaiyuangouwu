import { describe, expect, it } from 'vitest';
import { defaultStorefrontSeoSettings } from '../../../../store-management-plugin/src/seo/storefront-seo.contract';
import { parseSeoMetricCsv, seoEvidenceSummary, seoPublicPath } from './storefront-seo-utils';

const header = 'source,property,dateFrom,dateTo,url,status,evidenceUrl,impressions,clicks';
describe('SEO report evidence import', () => {
    it('preserves unknown metrics and provenance instead of manufacturing zero', () => {
        const [metric] = parseSeoMetricCsv(
            `${header}\nGSC,sc-domain:example.com,2026-10-01,2026-10-02,https://example.com/en/,DATA_MISSING,https://example.com/evidence,,`,
            '2026-10-10T00:00:00Z',
        );
        expect(metric.impressions).toBeNull();
        expect(metric.clicks).toBeNull();
        expect(metric.status).toBe('DATA_MISSING');
        expect(metric.importedAt).toBe('2026-10-10T00:00:00Z');
    });
    it('handles quoted commas and explicit measured zero', () => {
        const [metric] = parseSeoMetricCsv(
            `${header}\nGSC,"property, name",2026-10-01,2026-10-02,,MEASURED,https://example.com/evidence,0,0`,
        );
        expect(metric.property).toBe('property, name');
        expect(metric.impressions).toBe(0);
    });
    it.each([
        ['GSC,p,2026-10-01,2026-10-02,,NO_ACCESS,https://example.com/evidence,0,', '未测量状态'],
        ['GOOGLE_AI,p,2026-10-01,2026-10-02,,MEASURED,https://example.com/evidence,9,3', '仅记录实际展示量'],
        ['GSC,p,2026-10-03,2026-10-02,,MEASURED,https://example.com/evidence,1,1', '日期范围'],
        ['GSC,p,2026-10-01,2026-10-02,,MEASURED,javascript:alert(1),1,1', 'HTTPS'],
        ['GSC,p,2026-10-01,2026-10-02,,MEASURED,https://example.com/evidence,-1,1', '非负数字'],
    ])('rejects unsupported or unproven report values', (row, reason) =>
        expect(() => parseSeoMetricCsv(`${header}\n${row}`)).toThrow(reason),
    );
    it('requires explicit platform evidence and keeps source layers separate', () => {
        expect(seoEvidenceSummary(defaultStorefrontSeoSettings())).toEqual({
            indexing: 'NOT_MEASURED',
            search: 'DATA_MISSING',
            platformAccess: 'NO_ACCESS',
            aiCitations: 'NOT_MEASURED',
        });
    });
    it('retains entity identity and stable language paths', () => {
        expect(seoPublicPath({ targetType: 'PRODUCT', targetId: 'a & b', languageCode: 'en' })).toBe(
            '/en/product?id=a%20%26%20b',
        );
        expect(
            seoPublicPath({ targetType: 'ARTICLE', targetId: 'buyer-guide', languageCode: 'zh_Hans' }),
        ).toBe('/zh/guides/buyer-guide');
        expect(seoPublicPath({ targetType: 'PAGE', targetId: 'terms', languageCode: 'en' })).toBe(
            '/en/legal?id=terms',
        );
    });
});

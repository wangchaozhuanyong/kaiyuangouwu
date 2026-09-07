import { describe, expect, it } from 'vitest';

import { provinceCodeForValue, provinceDisplayName, provincesForCountry } from './address-region-options';

const provinces = [
    { code: 'CN-GD', name: '广东省', countryCode: 'CN' },
    { code: 'MY-10', name: 'Selangor', countryCode: 'MY' },
];

describe('address region options', () => {
    it('filters subdivisions by country without mixing storefronts', () => {
        expect(provincesForCountry(provinces, 'cn')).toEqual([provinces[0]]);
        expect(provincesForCountry(provinces, 'MY')).toEqual([provinces[1]]);
    });

    it('normalizes an existing localized name to its stable code and resolves it for display', () => {
        expect(provinceCodeForValue(provinces, 'CN', '广东省')).toBe('CN-GD');
        expect(provinceDisplayName(provinces, 'CN', 'CN-GD')).toBe('广东省');
        expect(provinceDisplayName(provinces, 'CN', '历史自由文本')).toBe('历史自由文本');
    });
});

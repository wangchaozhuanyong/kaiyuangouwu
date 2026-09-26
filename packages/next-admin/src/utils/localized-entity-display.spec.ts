import { describe, expect, it } from 'vitest';

import {
    getLocalizedEntityDescription,
    getLocalizedEntityName,
    getLocalizedEntityTranslation,
} from './localized-entity-display';

const entity = {
    name: '后端回退名称',
    description: '后端回退描述',
    translations: [
        { languageCode: 'zh_Hans', name: '标准快递', description: '普通快递配送' },
        { languageCode: 'en', name: 'Standard shipping', description: 'Standard parcel delivery' },
    ],
};

describe('localized entity display', () => {
    it('selects only the requested language', () => {
        expect(getLocalizedEntityName(entity, 'zh_Hans')).toBe('标准快递');
        expect(getLocalizedEntityDescription(entity, 'zh_Hans')).toBe('普通快递配送');
        expect(getLocalizedEntityName(entity, 'en')).toBe('Standard shipping');
        expect(getLocalizedEntityDescription(entity, 'en')).toBe('Standard parcel delivery');
    });

    it('does not leak the other language when the requested translation is missing', () => {
        const chineseOnly = {
            name: '中文回退名称',
            translations: [{ languageCode: 'zh_Hans', name: '上门自提' }],
        };

        expect(getLocalizedEntityName(chineseOnly, 'en')).toBe('English name not set');
        expect(getLocalizedEntityDescription(chineseOnly, 'en')).toBe('');
    });

    it('requires explicit response-language metadata for lightweight queries', () => {
        expect(getLocalizedEntityName({ name: 'English fallback' }, 'zh_Hans')).toBe('未填写中文名称');
        expect(getLocalizedEntityName({ name: 'English fallback', translations: [] }, 'zh_Hans')).toBe(
            '未填写中文名称',
        );
        expect(getLocalizedEntityName({ name: '上门自提', languageCode: 'zh_Hans' }, 'zh_Hans')).toBe(
            '上门自提',
        );
    });

    it('returns the exact translation for locale-aware editors', () => {
        expect(getLocalizedEntityTranslation(entity.translations, 'en')?.name).toBe('Standard shipping');
    });
});

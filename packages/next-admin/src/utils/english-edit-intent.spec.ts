import { expect, it } from 'vitest';
import { hasChineseSaveInput } from './admin-mutation-feedback';
import { omitUnchangedEnglish } from './english-edit-intent';

it('keeps explicit English changes including clearing and omits untouched automatic values', () => {
    expect(
        omitUnchangedEnglish(
            { titleZh: '新标题', titleEn: 'Previous', bodyEn: '', subtitleEn: 'Reviewed' },
            { titleEn: 'Previous', bodyEn: 'Old body', subtitleEn: 'Old subtitle' },
        ),
    ).toEqual({ titleZh: '新标题', bodyEn: '', subtitleEn: 'Reviewed' });
});
it('applies the shared translation notice to Chinese saves without mislabelling operations', () => {
    expect(
        hasChineseSaveInput('NextAdminUpdateProduct', {
            input: { translations: [{ languageCode: 'zh_Hans', name: '商品' }] },
        }),
    ).toBe(true);
    expect(hasChineseSaveInput('NextAdminUpdateImageModel', { input: { displayNameZh: '模型' } })).toBe(true);
    expect(hasChineseSaveInput('NextAdminDeleteProduct', { input: { titleZh: '商品' } })).toBe(false);
    expect(
        hasChineseSaveInput('NextAdminUpdateProduct', {
            input: { translations: [{ languageCode: 'en', name: 'Product' }] },
        }),
    ).toBe(false);
});

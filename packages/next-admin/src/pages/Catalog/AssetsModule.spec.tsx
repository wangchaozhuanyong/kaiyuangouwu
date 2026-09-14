import { describe, expect, it } from 'vitest';
import { assetTranslationsWithSourceName, countUploadedAssets } from './AssetsModule';

describe('asset source-language name save', () => {
    it('updates the Chinese translation instead of resubmitting the old name', () => {
        const input = [
            { id: 'zh', languageCode: 'zh_Hans', name: '旧素材.png' },
            { id: 'en', languageCode: 'en', name: 'Manually maintained English' },
        ];
        expect(assetTranslationsWithSourceName(input, '新素材.png')).toEqual([
            { id: 'zh', languageCode: 'zh_Hans', name: '新素材.png' },
            input[1],
        ]);
        expect(input[0].name).toBe('旧素材.png');
    });
    it('adds the Chinese translation for an English-only legacy asset', () => {
        const english = { id: 'en', languageCode: 'en', name: 'Original' };
        expect(assetTranslationsWithSourceName([english], '中文素材')).toEqual([
            english,
            { languageCode: 'zh_Hans', name: '中文素材' },
        ]);
    });
    it('supports an asset with no translations without passing output-only properties', () => {
        expect(assetTranslationsWithSourceName([], '新素材')).toEqual([
            { languageCode: 'zh_Hans', name: '新素材' },
        ]);
    });
});

describe('asset upload result count', () => {
    it('counts successful API results once, independently of React state updater replays', () => {
        const results = [{ __typename: 'Asset' as const, id: 'test' }];
        expect(countUploadedAssets(results, 1)).toBe(1);
        expect(countUploadedAssets(results, 1)).toBe(1);
    });
    it('ignores failed, missing and unrequested results', () => {
        expect(
            countUploadedAssets(
                [{ __typename: 'Asset' }, { __typename: 'MimeTypeError' }, { __typename: 'Asset' }],
                2,
            ),
        ).toBe(1);
        expect(countUploadedAssets([], 1)).toBe(0);
    });
});

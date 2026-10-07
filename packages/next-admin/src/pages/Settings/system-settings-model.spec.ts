import { describe, expect, it } from 'vitest';
import type { SettingsStoreFieldRecord } from '../../graphql/management.graphql';

import {
    getSettingsPresentation,
    getSettingsScopeLabel,
    getSettingsValueSummary,
    matchesSettingsSearch,
    settingsEditorValue,
} from './system-settings-model';

function field(
    key: string,
    currentValue: unknown = undefined,
    scopeType: SettingsStoreFieldRecord['scopeType'] = 'CHANNEL',
): SettingsStoreFieldRecord {
    return { key, currentValue, scopeType, readonly: false };
}

describe('system settings search and presentation', () => {
    it('finds business settings by Chinese labels, descriptions and scope', () => {
        const exportSetting = field('storefrontAccount.personalDataExportEnabled');

        expect(matchesSettingsSearch(exportSetting, '  个人数据导出  ')).toBe(true);
        expect(matchesSettingsSearch(exportSetting, '账户设置')).toBe(true);
        expect(matchesSettingsSearch(exportSetting, '当前店铺')).toBe(true);
        expect(matchesSettingsSearch(exportSetting, '商品评价')).toBe(false);
        expect(matchesSettingsSearch(exportSetting, '')).toBe(true);
    });

    it('keeps technical key searches case insensitive', () => {
        expect(
            matchesSettingsSearch(field('storefrontAuth.googleClientId'), 'STOREFRONTAUTH.GOOGLECLIENTID'),
        ).toBe(true);
    });

    it.each([
        ['storefrontAuth.emailPasswordEnabled', 'login'],
        ['storefrontAuth.platformGoogleClientId', 'login'],
        ['storefrontAccount.recommendations', 'account'],
        ['storefrontReview.enabled', 'reviews'],
    ])('gives %s its existing business settings group', (key, group) => {
        expect(getSettingsPresentation(key).group).toBe(group);
    });

    it.each([
        'systemOperations.workerHeartbeat',
        'contentTranslationCache.result',
        'vendure.dashboard.userSettings',
        'vendure.dashboard.globalSavedViews',
        'vendure.dashboard.userSavedViews',
        'ReadonlyTest.buildMeta',
        'customExtension.deliveryOptions',
        'storefrontAuth.newExtensionOption',
    ])('keeps internal or unknown %s in technical diagnostics', key => {
        expect(getSettingsPresentation(key).group).toBe('technical');
    });

    it('does not present a scoped translation cache value as the whole cache', () => {
        const cache = getSettingsPresentation('contentTranslationCache.result');

        expect(cache.description).toContain('当前查询范围');
        expect(cache.description).toContain('不能代表全部缓存');
    });

    it('distinguishes platform configuration from administrator and store scope', () => {
        expect(getSettingsScopeLabel('GLOBAL')).toBe('整个平台');
        expect(getSettingsScopeLabel('CHANNEL')).toBe('当前店铺');
        expect(getSettingsScopeLabel('USER')).toBe('当前管理员');
        expect(getSettingsScopeLabel('USER_AND_CHANNEL')).toBe('当前管理员在本店铺');
        expect(getSettingsScopeLabel('CUSTOM')).toBe('自定义范围');
    });
});

describe('system settings value summaries', () => {
    it.each([
        'storefrontAuth.emailPasswordEnabled',
        'storefrontAuth.googleOverrideEnabled',
        'storefrontAuth.platformGoogleEnabled',
        'storefrontAccount.recommendations',
        'storefrontAccount.personalDataExportEnabled',
        'storefrontReview.enabled',
        'contentTranslationCache.result',
    ])('does not treat an unset %s as disabled or empty', key => {
        expect(getSettingsValueSummary(field(key, null))).toBe('未单独设置');
        expect(getSettingsValueSummary(field(key, undefined))).toBe('未单独设置');
    });

    it('keeps a missing worker heartbeat distinct from a stopped worker', () => {
        expect(getSettingsValueSummary(field('systemOperations.workerHeartbeat', null, 'GLOBAL'))).toBe(
            '未接收到心跳',
        );
    });

    it.each([
        [true, '已开启'],
        [false, '已关闭'],
    ] as const)('reports a stored boolean %s explicitly', (value, summary) => {
        expect(getSettingsValueSummary(field('storefrontReview.enabled', value))).toBe(summary);
    });

    it.each([
        [true, '已开启'],
        [false, '已关闭'],
    ] as const)(
        'summarizes recommendation activation independently of its saved content',
        (enabled, summary) => {
            const recommendations = { enabled, titleZh: '账户推荐', titleEn: 'Recommendations', limit: 8 };

            expect(getSettingsValueSummary(field('storefrontAccount.recommendations', recommendations))).toBe(
                summary,
            );
        },
    );

    it('does not infer a recommendation switch from malformed or absent boolean data', () => {
        expect(
            getSettingsValueSummary(field('storefrontAccount.recommendations', { enabled: 'false' })),
        ).toBe('已保存数据');
        expect(getSettingsValueSummary(field('storefrontAccount.recommendations', {}))).toBe('已保存数据');
    });

    it('shows whether text is filled without exposing its raw value in the summary', () => {
        expect(getSettingsValueSummary(field('storefrontAuth.googleClientId', 'public-client-id'))).toBe(
            '已填写',
        );
        expect(getSettingsValueSummary(field('storefrontAuth.googleClientId', '   '))).toBe('未填写');
    });
});

describe('settings JSON editor serialization', () => {
    it.each([
        { name: 'null', value: null },
        { name: 'enabled boolean', value: true },
        { name: 'disabled boolean', value: false },
        { name: 'zero', value: 0 },
        { name: 'decimal number', value: -2.5 },
        { name: 'string resembling a boolean', value: 'false' },
        { name: 'string resembling a number', value: '8' },
        {
            name: 'nested JSON object',
            value: {
                enabled: false,
                limit: 8,
                title: '推荐内容',
                optional: null,
                levels: [true, 0, 'false'],
            },
        },
        { name: 'array', value: [null, false, 12, { title: '中文' }] },
    ])('preserves $name when the editor text is parsed as JSON', ({ value }) => {
        const serialized = settingsEditorValue(value);

        expect(typeof serialized).toBe('string');
        if (typeof serialized !== 'string') throw new Error('Editor value must be valid JSON text');
        expect(JSON.parse(serialized)).toStrictEqual(value);
    });

    it('opens an unset value as valid JSON null', () => {
        expect(settingsEditorValue(undefined)).toBe('null');
    });
});

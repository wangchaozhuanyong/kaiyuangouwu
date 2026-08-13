import { setupI18n } from '@lingui/core';
import { describe, expect, it } from 'vitest';

import { getSettingsStoreDisplayName } from './settings-store-utils.js';

describe('settings store presentation', () => {
    const i18n = setupI18n({
        locale: 'zh_Hans',
        messages: {
            zh_Hans: {
                'settingsStore.buildVersion': '系统构建版本',
                'settingsStore.custom': '扩展系统配置',
                'settingsStore.plugin.setting': '插件业务配置',
            },
        },
    });

    it('uses Chinese names for known internal settings', () => {
        expect(getSettingsStoreDisplayName(i18n, 'ReadonlyTest.buildVersion')).toBe('系统构建版本');
    });

    it('uses extension translations or a Chinese fallback', () => {
        expect(getSettingsStoreDisplayName(i18n, 'plugin.setting')).toBe('插件业务配置');
        expect(getSettingsStoreDisplayName(i18n, 'plugin.unknownSetting')).toBe('扩展系统配置');
    });
});

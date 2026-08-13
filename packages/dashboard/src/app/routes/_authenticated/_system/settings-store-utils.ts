import type { MessageDescriptor } from '@lingui/core';
import { msg } from '@lingui/core/macro';

interface TranslationRuntime {
    readonly locale: string;
    readonly messages: Record<string, unknown>;
    _(descriptor: MessageDescriptor | string): string;
}

const builtInSettingsStoreLabels: Record<string, MessageDescriptor> = {
    'MyPlugin.globalVal': msg({ id: 'settingsStore.pluginGlobalValue', message: 'Plugin global setting' }),
    'MyPlugin.userVal': msg({ id: 'settingsStore.pluginUserValue', message: 'Plugin user setting' }),
    'ReadonlyTest.buildVersion': msg({ id: 'settingsStore.buildVersion', message: 'System build version' }),
    'ReadonlyTest.buildMeta': msg({ id: 'settingsStore.buildMetadata', message: 'System build information' }),
    'vendure.dashboard.userSettings': msg({
        id: 'settingsStore.dashboardUserSettings',
        message: 'Dashboard user preferences',
    }),
    'vendure.dashboard.globalSavedViews': msg({
        id: 'settingsStore.globalSavedViews',
        message: 'Shared table views',
    }),
    'vendure.dashboard.userSavedViews': msg({
        id: 'settingsStore.userSavedViews',
        message: 'Personal table views',
    }),
};

const customSettingsStoreLabel = msg({
    id: 'settingsStore.custom',
    message: 'Extension configuration',
});

function humanizeFieldKey(fieldKey: string): string {
    const fieldName = fieldKey.split('.').at(-1) ?? fieldKey;
    const words = fieldName
        .replace(/([a-z0-9])([A-Z])/gu, '$1 $2')
        .replace(/[-_]+/gu, ' ')
        .trim();
    return words ? words.charAt(0).toUpperCase() + words.slice(1) : fieldKey;
}

export function getSettingsStoreDisplayName(i18n: TranslationRuntime, fieldKey: string): string {
    const builtInLabel = builtInSettingsStoreLabels[fieldKey];
    if (builtInLabel) {
        return i18n._(builtInLabel);
    }

    const pluginMessageId = `settingsStore.${fieldKey}`;
    if (Object.prototype.hasOwnProperty.call(i18n.messages, pluginMessageId)) {
        return i18n._(pluginMessageId);
    }

    return i18n.locale.startsWith('zh') ? i18n._(customSettingsStoreLabel) : humanizeFieldKey(fieldKey);
}

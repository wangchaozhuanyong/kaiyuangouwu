import { LanguageCode } from '@vendure/common/lib/generated-types';
import cronstrue from 'cronstrue/i18n';

const supportedCronLocales = new Set([
    'af',
    'ar',
    'be',
    'bg',
    'ca',
    'cs',
    'da',
    'de',
    'en',
    'es',
    'fa',
    'fi',
    'fr',
    'he',
    'hr',
    'hu',
    'id',
    'it',
    'ja',
    'ko',
    'my',
    'nb',
    'nl',
    'pl',
    'pt_BR',
    'pt_PT',
    'ro',
    'ru',
    'sk',
    'sl',
    'sr',
    'sv',
    'sw',
    'th',
    'tr',
    'uk',
    'vi',
    'zh_CN',
    'zh_TW',
]);

const cronLocaleAliases: Partial<Record<LanguageCode, string>> = {
    [LanguageCode.zh_Hans]: 'zh_CN',
    [LanguageCode.zh_Hant]: 'zh_TW',
};

function getCronLocale(languageCode: LanguageCode): string {
    const locale = cronLocaleAliases[languageCode] ?? languageCode;
    return supportedCronLocales.has(locale) ? locale : 'en';
}

export function getScheduleDescription(
    pattern: string | undefined,
    languageCode: LanguageCode = LanguageCode.en,
): string {
    if (!pattern) {
        return languageCode === LanguageCode.zh_Hans ? '未知时间表' : 'Unknown schedule';
    }

    const locale = getCronLocale(languageCode);
    return cronstrue.toString(pattern, {
        locale,
        use24HourTimeFormat: locale === 'zh_CN' || locale === 'zh_TW',
    });
}

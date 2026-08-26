export const supportedStorefrontLanguageCodes = ['en', 'zh_Hans'] as const;
export const contentSourceLanguageCode = 'zh_Hans' as const;

const supportedStorefrontLanguageSet = new Set<string>(supportedStorefrontLanguageCodes);

export function supportedStorefrontLanguages<T extends string>(
    languageCodes: readonly T[] | null | undefined,
): T[] {
    return (languageCodes ?? []).filter(languageCode => supportedStorefrontLanguageSet.has(languageCode));
}

export function isSupportedStorefrontLanguage(languageCode: string): boolean {
    return supportedStorefrontLanguageSet.has(languageCode);
}

export function dashboardContentLanguage(
    availableLanguageCodes: readonly string[] | null | undefined,
    fallbackLanguageCode: string,
): string {
    return availableLanguageCodes?.includes(contentSourceLanguageCode)
        ? contentSourceLanguageCode
        : fallbackLanguageCode;
}

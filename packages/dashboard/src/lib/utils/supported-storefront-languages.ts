const unsupportedStorefrontLanguages = new Set(['zh_Hant']);

export function supportedStorefrontLanguages<T extends string>(
    languageCodes: readonly T[] | null | undefined,
): T[] {
    return (languageCodes ?? []).filter(languageCode => !unsupportedStorefrontLanguages.has(languageCode));
}

export function isSupportedStorefrontLanguage(languageCode: string): boolean {
    return !unsupportedStorefrontLanguages.has(languageCode);
}

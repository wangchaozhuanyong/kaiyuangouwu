export interface DashboardLanguageSettings {
    contentLanguage?: string;
    displayLanguage?: string;
}

export function addDashboardLanguageParams(
    url: string,
    settings: DashboardLanguageSettings | undefined,
    displayLanguageOverride?: string | null,
) {
    const contentLanguage = displayLanguageOverride || settings?.contentLanguage;
    const displayLanguage = displayLanguageOverride || settings?.displayLanguage;

    if (!contentLanguage && !displayLanguage) {
        return url;
    }

    const result = new URL(url);
    if (contentLanguage) {
        result.searchParams.set('languageCode', contentLanguage);
    }
    if (displayLanguage) {
        result.searchParams.set('displayLanguageCode', displayLanguage);
    }
    return result.toString();
}

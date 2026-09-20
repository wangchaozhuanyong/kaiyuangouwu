export type AdminDisplayLanguage = 'zh_Hans' | 'en';

const DEFAULT_ADMIN_DISPLAY_LANGUAGE: AdminDisplayLanguage = 'zh_Hans';

export function normalizeAdminDisplayLanguage(value: string | null | undefined): AdminDisplayLanguage | null {
    const normalized = value?.trim().replace(/-/gu, '_').toLowerCase();
    if (!normalized) return null;
    if (normalized === 'zh' || normalized.startsWith('zh_')) return 'zh_Hans';
    if (normalized === 'en' || normalized.startsWith('en_')) return 'en';
    return null;
}

/**
 * Resolves the one language used for Admin API entity translations and server messages.
 *
 * The explicit URL parameter lets an English Admin entry point request English data. The HTML
 * language is the normal browser source. Unknown or absent values deliberately fall back to the
 * Admin's declared default instead of the operator's browser preference.
 */
export function getAdminDisplayLanguage(): AdminDisplayLanguage {
    if (typeof window !== 'undefined') {
        const params = new URLSearchParams(window.location.search);
        const explicit =
            normalizeAdminDisplayLanguage(params.get('displayLanguageCode')) ??
            normalizeAdminDisplayLanguage(params.get('languageCode'));
        if (explicit) return explicit;
    }

    if (typeof document !== 'undefined') {
        const pageLanguage = normalizeAdminDisplayLanguage(document.documentElement.lang);
        if (pageLanguage) return pageLanguage;
    }

    return DEFAULT_ADMIN_DISPLAY_LANGUAGE;
}

export const isChineseAdminLanguage = (languageCode = getAdminDisplayLanguage()) =>
    languageCode === 'zh_Hans';

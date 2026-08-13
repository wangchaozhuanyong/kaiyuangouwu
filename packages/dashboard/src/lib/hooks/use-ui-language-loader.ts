import { toBcp47Locale } from '@/vdb/lib/i18n.js';
import { loadI18nMessages } from '@/vdb/lib/load-i18n-messages.js';
import { useLingui } from '@lingui/react/macro';
import { useCallback } from 'react';

let currentlyLoading: string | null = null;

/**
 * @description
 * Loads the UI translations for the given locale and activates it
 * with the Lingui I18nProvider. Generally this is used internally
 * when the display language is set via the user > language dialog.
 *
 * @docsCategory hooks
 * @docsPage useUiLanguageLoader
 */
export function useUiLanguageLoader() {
    const { i18n } = useLingui();

    const loadAndActivateLocale = useCallback(
        async (locale: string) => {
            const bcp47Locale = toBcp47Locale(locale);
            if (currentlyLoading === bcp47Locale || i18n.locale === bcp47Locale) {
                return;
            }
            currentlyLoading = bcp47Locale;
            try {
                const messages = await loadI18nMessages(locale);
                i18n.load(bcp47Locale, messages);
                i18n.activate(bcp47Locale);
            } finally {
                currentlyLoading = null;
            }
        },
        [i18n],
    );

    return { loadAndActivateLocale };
}

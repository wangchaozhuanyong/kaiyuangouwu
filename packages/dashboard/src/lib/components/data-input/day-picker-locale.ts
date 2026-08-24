import type { Locale } from 'date-fns/locale';

type DatePickerLocaleLoader = () => Promise<object>;

// Keep this list aligned with src/i18n/locales. Static imports allow Vite to
// create one lazy chunk per supported Dashboard language instead of bundling
// every locale exported by react-day-picker.
const datePickerLocaleLoaders: Record<string, DatePickerLocaleLoader> = {
    ar: () => import('react-day-picker/locale/ar'),
    bg: () => import('react-day-picker/locale/bg'),
    cs: () => import('react-day-picker/locale/cs'),
    de: () => import('react-day-picker/locale/de'),
    'en-US': () => import('react-day-picker/locale/en-US'),
    es: () => import('react-day-picker/locale/es'),
    'fa-IR': () => import('react-day-picker/locale/fa-IR'),
    fr: () => import('react-day-picker/locale/fr'),
    he: () => import('react-day-picker/locale/he'),
    hr: () => import('react-day-picker/locale/hr'),
    hu: () => import('react-day-picker/locale/hu'),
    it: () => import('react-day-picker/locale/it'),
    ja: () => import('react-day-picker/locale/ja'),
    ko: () => import('react-day-picker/locale/ko'),
    nb: () => import('react-day-picker/locale/nb'),
    nl: () => import('react-day-picker/locale/nl'),
    pl: () => import('react-day-picker/locale/pl'),
    pt: () => import('react-day-picker/locale/pt'),
    'pt-BR': () => import('react-day-picker/locale/pt-BR'),
    ro: () => import('react-day-picker/locale/ro'),
    ru: () => import('react-day-picker/locale/ru'),
    sv: () => import('react-day-picker/locale/sv'),
    tr: () => import('react-day-picker/locale/tr'),
    uk: () => import('react-day-picker/locale/uk'),
    uz: () => import('react-day-picker/locale/uz'),
    'zh-CN': () => import('react-day-picker/locale/zh-CN'),
    'zh-TW': () => import('react-day-picker/locale/zh-TW'),
};

export async function loadDayPickerLocale(
    tag: string,
    loaders: Record<string, DatePickerLocaleLoader> = datePickerLocaleLoaders,
): Promise<Locale | undefined> {
    for (const candidate of getDayPickerLocaleCandidates(tag)) {
        const loader = loaders[candidate];
        if (loader) {
            const module = await loader();
            return Object.values(module)[0] as Locale;
        }
    }
    return undefined;
}

export function getDayPickerLocaleCandidates(tag: string): string[] {
    const normalizedTag = tag.replace(/_/g, '-');
    const mappedTag =
        normalizedTag === 'zh-Hans'
            ? 'zh-CN'
            : normalizedTag === 'zh-Hant'
              ? 'zh-TW'
              : normalizedTag === 'fa'
                ? 'fa-IR'
                : normalizedTag;
    const language = mappedTag.split('-')[0];
    return language && language !== mappedTag ? [mappedTag, language] : [mappedTag];
}

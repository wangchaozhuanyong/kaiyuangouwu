import {
    isPublicStorefrontPathname,
    publicLanguageFromUrl,
    publicLocalizedHref,
    publicUnlocalizedPathname,
} from '../../storefront-content-plugin/src/shared/public-page-data';

/** Keep one route tree while the browser exposes stable public language URLs. */
export const publicRouteRewrite = {
    input: ({ url }: { url: URL }): URL => {
        const language = publicLanguageFromUrl(url.pathname);
        url.searchParams.delete('__storefrontLanguage');
        if (language) {
            url.pathname = publicUnlocalizedPathname(url.pathname);
            url.searchParams.set('__storefrontLanguage', language === 'zh_Hans' ? 'zh' : 'en');
        }
        return url;
    },
    output: ({ url }: { url: URL }): URL => {
        const selected = url.searchParams.get('__storefrontLanguage');
        const current =
            typeof window === 'undefined' ? undefined : publicLanguageFromUrl(window.location.pathname);
        const language = selected === 'zh' ? 'zh_Hans' : selected === 'en' ? 'en' : current;
        url.searchParams.delete('__storefrontLanguage');
        if (language && isPublicStorefrontPathname(url.pathname)) {
            url.pathname = new URL(publicLocalizedHref(url.pathname, language), url.origin).pathname;
        }
        return url;
    },
};

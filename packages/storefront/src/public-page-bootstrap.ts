import {
    publicLanguageFromUrl,
    publicPageRequestFromUrl,
    STOREFRONT_PAGE_DATA_ELEMENT_ID,
} from '../../storefront-content-plugin/src/shared/public-page-data';

import { applyInitialLoadingBrand, initialLoadingBrandForSnapshot } from './brand-loading-bootstrap';
import { startPublicPageBootstrap } from './public-page-transport';

// This entry intentionally has no React/router/API imports. It runs while those chunks download.
if (
    import.meta.env.VITE_CLIENT_CHANNEL_SWITCHING !== 'true' &&
    new URLSearchParams(location.search).get('storefrontPreviewEmbedded') !== '1'
) {
    try {
        const request = publicPageRequestFromUrl(location.pathname + location.search);
        if (request) {
            const cookie = (name: string) =>
                document.cookie
                    .split('; ')
                    .find(part => part.startsWith(name + '='))
                    ?.slice(name.length + 1);
            const rawLanguage = cookie('storefront_public_language');
            const rawCurrency = cookie('storefront_public_currency');
            const language =
                publicLanguageFromUrl(location.pathname) ??
                (rawLanguage === 'en' || rawLanguage === 'zh_Hans' ? rawLanguage : undefined);
            const currency = rawCurrency && /^[A-Z]{3}$/u.test(rawCurrency) ? rawCurrency : undefined;
            const snapshot = JSON.parse(
                document.getElementById(STOREFRONT_PAGE_DATA_ELEMENT_ID)?.textContent ?? 'null',
            );
            const brand = initialLoadingBrandForSnapshot(snapshot, {
                host: location.host,
                request,
                languageCode: language,
                currencyCode: currency,
            });
            if (brand) applyInitialLoadingBrand(brand);
            else startPublicPageBootstrap(request, language, currency);
        }
    } catch {
        /* Invalid public URLs use the normal route validation and error UI. */
    }
}

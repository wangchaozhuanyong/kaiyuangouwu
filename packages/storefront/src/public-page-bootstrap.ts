import {
    publicLanguageFromUrl,
    publicPageRequestFromUrl,
    STOREFRONT_BOOT_DATA_ELEMENT_ID,
    STOREFRONT_PAGE_DATA_ELEMENT_ID,
} from '../../storefront-content-plugin/src/shared/public-page-data';

import {
    applyInitialLoadingBrand,
    initialLoadingBrandForBootData,
    initialLoadingBrandForSnapshot,
} from './brand-loading-bootstrap';
import { startPublicPageBootstrap } from './public-page-transport';

// This entry intentionally has no React/router/API imports. It runs while those chunks download.
function bootstrapPublicPage() {
    if (
        import.meta.env.VITE_CLIENT_CHANNEL_SWITCHING === 'true' ||
        new URLSearchParams(location.search).get('storefrontPreviewEmbedded') === '1'
    )
        return;
    const root = document.getElementById('root');
    const bootStage = document.getElementById('storefront-boot-loading');
    // The async entry may arrive after React has committed newer scoped branding.
    // Only an actual adoption/handoff signal retires this one-time bootstrap.
    if (root?.dataset.publicAdopted === '1' || bootStage?.getAttribute('aria-hidden') === 'true') return;
    try {
        const request = publicPageRequestFromUrl(location.pathname + location.search);
        {
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
            const scope = {
                host: location.host,
                languageCode: language,
                currencyCode: currency,
            };
            const boot = JSON.parse(
                document.getElementById(STOREFRONT_BOOT_DATA_ELEMENT_ID)?.textContent ?? 'null',
            );
            const brand =
                (request ? initialLoadingBrandForSnapshot(snapshot, { ...scope, request }) : undefined) ??
                initialLoadingBrandForBootData(boot, scope);
            if (brand) applyInitialLoadingBrand(brand);
            else if (request) startPublicPageBootstrap(request, language, currency);
        }
    } catch {
        /* Invalid public URLs use the normal route validation and error UI. */
    }
}

// Public HTML appends its verified snapshot after the rendered root. "interactive"
// means parsing has finished, without waiting for the main module graph to download.
if (document.readyState === 'loading') {
    let started = false;
    const start = () => {
        if (started) return;
        started = true;
        document.removeEventListener('readystatechange', onParsed);
        document.removeEventListener('DOMContentLoaded', start);
        bootstrapPublicPage();
    };
    const onParsed = () => {
        if (document.readyState !== 'loading') start();
    };
    document.addEventListener('readystatechange', onParsed);
    document.addEventListener('DOMContentLoaded', start, { once: true });
} else bootstrapPublicPage();

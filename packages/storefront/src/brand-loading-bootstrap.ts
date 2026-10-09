import {
    isReusablePublicPageData,
    publicPageRequestKey,
    type PublicPageRequest,
} from '../../storefront-content-plugin/src/shared/public-page-data';
import {
    normalizeStorefrontAssetUrl,
    storefrontWebpUrl,
} from '../../storefront-content-plugin/src/shared/responsive-image';

export interface InitialLoadingBrand {
    logoUrl: string;
    storefrontName: string;
    language: 'en' | 'zh_Hans';
    secondaryName?: string;
}

/** The parser-time loader uses only the current host's reusable public snapshot. */
export function initialLoadingBrandForSnapshot(
    value: unknown,
    scope: {
        host: string;
        request: PublicPageRequest;
        languageCode?: string;
        currencyCode?: string;
        now?: number;
    },
): InitialLoadingBrand | undefined {
    const page = value as {
        schemaVersion?: unknown;
        generatedAt?: number;
        requestKey?: unknown;
        scope?: {
            host?: unknown;
            channelCode?: unknown;
            languageCode?: unknown;
            currencyCode?: unknown;
            priceContext?: unknown;
        };
        config?: {
            code?: unknown;
            accessMode?: unknown;
            logoUrl?: unknown;
            customFields?: { storefrontNameZh?: unknown; storefrontNameEn?: unknown };
            availableCountries?: unknown;
        };
        media?: unknown;
        failures?: unknown;
    } | null;
    const now = scope.now ?? Date.now();
    if (
        !page ||
        page.schemaVersion !== 1 ||
        !isReusablePublicPageData(page) ||
        page.scope?.host !== scope.host ||
        page.scope.priceContext !== 'public' ||
        typeof page.scope.channelCode !== 'string' ||
        !page.scope.channelCode ||
        page.config?.code !== page.scope.channelCode ||
        (page.scope.languageCode !== 'en' && page.scope.languageCode !== 'zh_Hans') ||
        typeof page.scope.currencyCode !== 'string' ||
        !page.scope.currencyCode ||
        page.requestKey !== publicPageRequestKey(scope.request) ||
        (scope.languageCode && page.scope.languageCode !== scope.languageCode) ||
        (scope.currencyCode && page.scope.currencyCode !== scope.currencyCode) ||
        typeof page.generatedAt !== 'number' ||
        !Number.isFinite(page.generatedAt) ||
        now - page.generatedAt > 30_000 ||
        page.generatedAt - now > 5_000 ||
        !page.config.customFields ||
        !Array.isArray(page.config.availableCountries) ||
        !Array.isArray(page.media) ||
        !Array.isArray(page.failures)
    )
        return;
    const language = page.scope.languageCode;
    const name =
        language === 'zh_Hans'
            ? page.config.customFields.storefrontNameZh
            : page.config.customFields.storefrontNameEn;
    return {
        language,
        storefrontName: typeof name === 'string' ? name.trim() : '',
        secondaryName:
            language === 'zh_Hans' && typeof page.config.customFields.storefrontNameEn === 'string'
                ? page.config.customFields.storefrontNameEn.trim()
                : '',
        logoUrl:
            typeof page.config.logoUrl === 'string' ? normalizeStorefrontAssetUrl(page.config.logoUrl) : '',
    };
}

let initialBrandGeneration = 0;

/** React replaces this element on mount; late image work may only touch its original owner. */
export function applyInitialLoadingBrand(brand: InitialLoadingBrand): void {
    const generation = ++initialBrandGeneration;
    const boot = document.getElementById('storefront-boot-loading');
    if (!boot) {
        // The early entry is async in <head> and may run before the body has been parsed.
        const root = document.getElementById('root');
        if (document.readyState === 'loading' && (!root || !root.hasChildNodes()))
            document.addEventListener(
                'DOMContentLoaded',
                () => {
                    if (
                        generation === initialBrandGeneration &&
                        document.getElementById('storefront-boot-loading')
                    )
                        applyInitialLoadingBrand(brand);
                },
                { once: true },
            );
        return;
    }
    const content = boot.querySelector('.brand-loading');
    if (!boot || !content) return;
    const ownsBoot = () =>
        generation === initialBrandGeneration &&
        boot.isConnected &&
        document.getElementById('storefront-boot-loading') === boot &&
        document.getElementById('root')?.contains(boot) === true;
    if (!ownsBoot()) return;
    content
        .querySelectorAll('.brand-loading-name, .brand-loading-subtitle, .route-transition-mark')
        .forEach(element => element.remove());
    boot.setAttribute('aria-label', brand.language === 'en' ? 'Loading page' : '正在加载页面');
    const caption = content.querySelector('.brand-loading-caption');
    const label = content.querySelector('.brand-loading-label');
    if (label)
        label.textContent =
            brand.language === 'en'
                ? brand.storefrontName
                    ? 'Loading'
                    : 'Connecting'
                : brand.storefrontName
                  ? '正在加载'
                  : '正在连接';
    if (brand.storefrontName) {
        const name = document.createElement('strong');
        name.className = 'brand-loading-name';
        name.textContent = brand.storefrontName;
        content.insertBefore(name, caption);
        if (brand.secondaryName && brand.secondaryName !== brand.storefrontName) {
            const subtitle = document.createElement('span');
            subtitle.className = 'brand-loading-subtitle';
            subtitle.textContent = brand.secondaryName;
            content.insertBefore(subtitle, caption);
        }
    }
    if (!brand.logoUrl) return;
    const mark = document.createElement('span');
    mark.className = 'route-transition-mark';
    const image = document.createElement('img');
    image.alt = '';
    image.width = 160;
    image.height = 120;
    image.loading = 'eager';
    image.decoding = 'async';
    image.fetchPriority = 'high';
    const firstSource = storefrontWebpUrl(brand.logoUrl, 'thumbnail');
    let originalSource = false;
    const reveal = () => {
        const source = image.getAttribute('src');
        const show = () => {
            if (ownsBoot() && image.getAttribute('src') === source && image.naturalWidth > 0)
                mark.classList.add('is-logo-ready');
        };
        if (typeof image.decode === 'function') {
            void image.decode().then(show, () => {
                if (ownsBoot() && image.getAttribute('src') === source) mark.remove();
            });
        } else {
            show();
        }
    };
    image.onload = reveal;
    image.onerror = () => {
        if (!ownsBoot()) return;
        if (!originalSource && firstSource !== brand.logoUrl) {
            originalSource = true;
            image.src = brand.logoUrl;
        } else {
            mark.remove();
        }
    };
    mark.appendChild(image);
    content.prepend(mark);
    image.src = firstSource;
    if (image.complete && image.naturalWidth > 0) reveal();
}

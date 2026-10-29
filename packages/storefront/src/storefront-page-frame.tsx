import { WifiOff } from 'lucide-react';
import { type ReactNode } from 'react';

import { type MediaDescriptor } from '../../storefront-content-plugin/src/shared/responsive-image';

import { ResponsiveHomeHeaderPlaceholder } from './components/common/responsive-home-header-placeholder';
import { desktopPageFamily } from './desktop-page-contract';
import { ImageLanguageContext, SafeImageMediaProvider } from './safe-image';
import { isBrowsingStorefrontRoute } from './storefront-access';
import { type RouteName } from './storefront-router';
import { type StorefrontContentBlock, type StorefrontLanguage } from './types';

/** The public HTML and interactive application keep the same layout node owners. */
export function StorefrontPageFrame({
    routeName,
    language,
    desktop,
    online = true,
    previewEmbedded = false,
    accessMode,
    storefrontName,
    logoUrl,
    displayCurrencyCode = '',
    navigationBlock,
    accountLayout = false,
    header,
    accountNavigation,
    deferred,
    publicMedia,
    publicMediaScope,
    publicMediaHost,
    children,
}: {
    routeName: RouteName;
    language: StorefrontLanguage;
    desktop: boolean;
    online?: boolean;
    previewEmbedded?: boolean;
    accessMode?: string;
    storefrontName: string;
    logoUrl: string | null;
    displayCurrencyCode?: string;
    navigationBlock?: StorefrontContentBlock;
    accountLayout?: boolean;
    header?: ReactNode;
    accountNavigation?: ReactNode;
    deferred?: ReactNode;
    publicMedia?: readonly MediaDescriptor[];
    publicMediaScope?: string;
    publicMediaHost?: string;
    children: ReactNode;
}) {
    const isZh = language === 'zh';
    // Public commerce uses responsive CSS from the first HTML frame, before viewport subscription.
    const responsiveCommerce = [
        'home',
        'category',
        'product',
        'search',
        'guide',
        'services',
        'support',
        'legal',
    ].includes(routeName);
    const headerClass = `${desktop ? '' : 'responsive-home-header-placeholder '}proto-desktop-header${desktop && routeName === 'search' ? ' is-search-page' : ''}`;
    return (
        <ImageLanguageContext.Provider value={language}>
            <SafeImageMediaProvider media={publicMedia} scope={publicMediaScope} host={publicMediaHost}>
                <div
                    data-route={routeName}
                    data-page-family={desktopPageFamily(routeName)}
                    data-preview-embedded={previewEmbedded ? 'true' : undefined}
                    className={`storefront-app${online ? '' : ' is-offline'}${desktop || responsiveCommerce ? ' desktop-store-layout' : ''}`}
                >
                    <a className="skip-link" href="#storefront-content">
                        {isZh ? '跳到主要内容' : 'Skip to content'}
                    </a>
                    {!online && (
                        <div className="network-banner" role="status">
                            <WifiOff aria-hidden="true" />
                            {isZh
                                ? '当前网络不可用，部分操作可能失败'
                                : 'You are offline. Some actions may fail.'}
                        </div>
                    )}
                    {!previewEmbedded && accessMode === 'PREVIEW' && (
                        <aside className="storefront-preview-notice type-helper" role="status">
                            <strong>{isZh ? '公开预览' : 'Public preview'}</strong>
                            <span>
                                {isZh
                                    ? '店铺尚未正式营业；测试支付只会生成模拟订单。'
                                    : 'This store is not live yet. Test payments create simulated orders only.'}
                            </span>
                        </aside>
                    )}
                    {(desktop ? header : responsiveCommerce && isBrowsingStorefrontRoute(routeName)) && (
                        <header className={headerClass}>
                            {desktop ? (
                                header
                            ) : (
                                <ResponsiveHomeHeaderPlaceholder
                                    name={storefrontName}
                                    logoUrl={logoUrl}
                                    language={language}
                                    currencyCode={displayCurrencyCode}
                                    routeName={routeName}
                                    navigationBlock={navigationBlock}
                                />
                            )}
                        </header>
                    )}
                    {deferred}
                    <div
                        className={
                            desktop || responsiveCommerce
                                ? `desktop-shell-frame${accountLayout ? ' desktop-account-layout' : ''}`
                                : undefined
                        }
                    >
                        {accountNavigation}
                        <div id="storefront-content" tabIndex={-1}>
                            {children}
                        </div>
                    </div>
                </div>
            </SafeImageMediaProvider>
        </ImageLanguageContext.Provider>
    );
}

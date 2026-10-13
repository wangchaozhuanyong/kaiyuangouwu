import { ExternalLink, Puzzle } from 'lucide-react';
import type { CSSProperties, ReactNode } from 'react';

import {
    BusinessServicesHero,
    resolveBusinessServicesHeroLayout,
} from '../../../storefront-content-plugin/src/shared/business-services-hero';
import heroStyles from '../../../storefront-content-plugin/src/shared/business-services-hero.css?inline';
import { heroImageForViewport } from '../../../storefront-content-plugin/src/shared/hero-image';
import {
    ClientPluginSlot,
    isAssistanceClientPlugin,
    resolveClientPlugins,
} from '../client-plugins/client-plugin-registry';
import { resolveBottomNavigationItems } from '../components/common/bottom-navigation';
import { MobilePageHeader } from '../components/common/mobile-page-header';
import { contentTargetHref, interceptContentNavigation } from '../content-target-href';
import { SafeImage } from '../safe-image';
import { BusinessServicesPageContext } from '../storefront-page-contexts';
import { type RouteState } from '../storefront-router';
import { EmptyState } from '../storefront-ui/page-shell';
import serviceStyles from '../styles/service-entries.css?inline';
import {
    type StorefrontContentBlock,
    type StorefrontContentTargetType,
    type StorefrontLanguage,
} from '../types';

import pageStyles from './business-services-page.css?inline';

const CLIENT_PLUGIN_BLOCK_CODE = 'storefront-client-plugins';
const BUSINESS_SERVICES_COPY_VERSION = 1;

export interface BusinessServicesPageProps {
    contentBlocks: StorefrontContentBlock[];
    language: StorefrontLanguage;
    storefrontName: string;
    logoUrl: string | null;
    marketLabel: string;
    displayCurrencyCode: string;
    availableCurrencyCodes: string[];
    currencyLoading: boolean;
    onToggleLanguage: () => void;
    onCurrencyChange: (currencyCode: string) => void | Promise<void>;
    onNotifications: () => void;
    onNavigate: (route: RouteState) => void;
    onContentTarget: (targetType: StorefrontContentTargetType, targetValue: string | null) => void;
}

export function BusinessServicesPage() {
    const {
        contentBlocks,
        language,
        storefrontName,
        logoUrl,
        displayCurrencyCode,
        availableCurrencyCodes,
        currencyLoading,
        onToggleLanguage,
        onCurrencyChange,
        onNotifications,
        onNavigate,
        onContentTarget,
    } = BusinessServicesPageContext.useValue();
    const isZh = language === 'zh';
    const clientPluginBlock = contentBlocks.find(
        block => block.type === 'CLIENT_PLUGINS' && block.code === CLIENT_PLUGIN_BLOCK_CODE,
    );
    const navigationBlock = contentBlocks.find(block => block.type === 'NAVIGATION');
    const pageTitle =
        resolveBottomNavigationItems(navigationBlock, language).find(item => item.routeName === 'services')
            ?.label ?? (isZh ? '智能服务' : 'Intelligent services');
    const hasManagedCopy =
        clientPluginBlock?.settings?.businessServicesCopyVersion === BUSINESS_SERVICES_COPY_VERSION;
    const heroTitle = (hasManagedCopy ? clientPluginBlock?.title.trim() : '') || pageTitle;
    const heroDescription =
        (hasManagedCopy ? clientPluginBlock?.body.trim() : '') ||
        (isZh
            ? '这里展示店铺为你开放的工具、服务和专属权益。'
            : 'Explore tools, services, and benefits enabled by this store.');
    const heroLinkTarget =
        hasManagedCopy && clientPluginBlock?.targetType === 'URL'
            ? clientPluginBlock.targetValue?.trim() || null
            : null;
    const plugins = resolveClientPlugins(clientPluginBlock, 'BUSINESS_SERVICES_MAIN');
    const heroLayout = resolveBusinessServicesHeroLayout(clientPluginBlock?.settings);
    const artwork = clientPluginBlock?.enabled ? clientPluginBlock : undefined;
    const desktopImage = heroImageForViewport(artwork, true);
    const mobileImage = heroLayout === 'shared-banner' ? desktopImage : heroImageForViewport(artwork, false);
    const heroImageUrl = desktopImage.imageUrl || mobileImage.imageUrl;
    const mobileOnlyImage = !desktopImage.imageUrl && Boolean(mobileImage.imageUrl);
    const heroImageStyle = {
        '--services-hero-mobile-image-ratio': imageRatio(mobileImage.imageAsset),
        '--services-hero-desktop-image-ratio': imageRatio(desktopImage.imageAsset),
    } as CSSProperties;

    const showAssistanceSidebar =
        heroLayout === 'shared-banner' && !!heroImageUrl && plugins.some(isAssistanceClientPlugin);
    const renderHero = (image?: ReactNode, className?: string) => (
        <BusinessServicesHero
            title={heroTitle}
            body={heroDescription}
            visual={clientPluginBlock}
            layout={heroLayout}
            className={className}
            image={image}
            decoration={<ServiceArchitectureMotif />}
            action={
                heroLinkTarget ? (
                    <a
                        href={contentTargetHref('URL', heroLinkTarget, language)}
                        className="business-services-heading-link"
                        onClick={event =>
                            interceptContentNavigation(event, () => onContentTarget('URL', heroLinkTarget))
                        }
                    >
                        {clientPluginBlock?.ctaLabel.trim() ||
                            (isZh ? '打开服务网站' : 'Open service website')}
                        <ExternalLink aria-hidden="true" />
                    </a>
                ) : undefined
            }
        />
    );
    const hero = (
        <>
            {renderHero(
                heroImageUrl ? (
                    <SafeImage
                        src={heroImageUrl}
                        alt=""
                        imageKind="hero"
                        loading={mobileOnlyImage ? 'lazy' : undefined}
                        width={desktopImage.imageAsset?.width ?? mobileImage.imageAsset?.width}
                        height={desktopImage.imageAsset?.height ?? mobileImage.imageAsset?.height}
                        mediaSources={
                            mobileImage.imageUrl && mobileImage.imageUrl !== desktopImage.imageUrl
                                ? [
                                      {
                                          media: '(max-width: 1023px)',
                                          src: mobileImage.imageUrl,
                                          width: mobileImage.imageAsset?.width,
                                          height: mobileImage.imageAsset?.height,
                                      },
                                  ]
                                : undefined
                        }
                    />
                ) : undefined,
                mobileOnlyImage ? 'business-services-mobile-only-hero' : undefined,
            )}
            {/* A phone-only binding must not invent a desktop advertisement. Both variants are
                pure presentation; CSS selects the existing layout before JavaScript runs. */}
            {mobileOnlyImage && renderHero(undefined, 'business-services-desktop-empty-hero')}
        </>
    );

    return (
        // The advertisement and assistance share a row; the growing tool directory stays below.
        <main className="page business-services-page" data-services-layout="directory-b">
            <style href="storefront-service-entries" precedence="commerce">
                {serviceStyles}
            </style>
            <style href="storefront-business-services" precedence="services">
                {heroStyles + pageStyles}
            </style>
            <MobilePageHeader
                className="business-services-mobile-header"
                title={pageTitle}
                storefrontName={storefrontName}
                logoUrl={logoUrl}
                language={language}
                displayCurrencyCode={displayCurrencyCode}
                availableCurrencyCodes={availableCurrencyCodes}
                currencyLoading={currencyLoading}
                onToggleLanguage={onToggleLanguage}
                onCurrencyChange={onCurrencyChange}
                onNotifications={onNotifications}
            />
            <div className="business-services-workspace" style={heroImageStyle}>
                {showAssistanceSidebar ? (
                    <div className="business-services-advertising-row">
                        {hero}
                        <aside
                            className="business-services-assistance-sidebar"
                            aria-label={isZh ? '客服与优惠' : 'Support and coupons'}
                        >
                            <ClientPluginSlot
                                block={clientPluginBlock}
                                placement="BUSINESS_SERVICES_MAIN"
                                group="assistance"
                                language={language}
                                onNavigate={onNavigate}
                            />
                        </aside>
                    </div>
                ) : (
                    hero
                )}
                <ClientPluginSlot
                    block={clientPluginBlock}
                    placement="BUSINESS_SERVICES_MAIN"
                    toolsFirst
                    group={showAssistanceSidebar ? 'tools' : undefined}
                    language={language}
                    onNavigate={onNavigate}
                />
            </div>

            {!plugins.length ? (
                <section className="business-services-empty" aria-live="polite">
                    <EmptyState
                        icon={<Puzzle />}
                        title={isZh ? '商业服务正在陆续开放' : 'Services are coming soon'}
                        detail={
                            isZh
                                ? '店铺启用新的服务后，会自动显示在这里。'
                                : 'New services will appear here when the store enables them.'
                        }
                    />
                </section>
            ) : null}
        </main>
    );
}

function imageRatio(dimensions?: { width?: number; height?: number }): number | undefined {
    const ratio = dimensions?.width && dimensions?.height ? dimensions.width / dimensions.height : undefined;
    return ratio && Number.isFinite(ratio) && ratio > 0 ? ratio : undefined;
}

// Abstract linework, not a merchant project photo or portfolio claim.
function ServiceArchitectureMotif() {
    return (
        <svg
            className="business-services-architecture"
            viewBox="0 0 460 340"
            fill="none"
            stroke="currentColor"
            strokeWidth="0.9"
            strokeLinejoin="round"
            aria-hidden="true"
            focusable="false"
        >
            <path d="M32 274 291 228 470 280M0 302 285 245 470 305M64 326 278 266 470 338" />
            <path d="M180 245V150L430 65V271M190 243V158L430 78M180 150 167 144 430 49 460 60" />
            <path d="M290 230V91L420 17 460 32M300 229V98L432 29M420 17V65" />
            <path d="M221 240V164L278 146V232M230 238V171L268 159V234M278 146 292 151M268 159 278 162" />
            <path d="M322 106V238M333 102V241M344 99V243M355 96V246M366 92V249M377 89V252M388 85V255M399 82V258M410 78V261" />
            <path d="M180 203 124 216V273L180 262M124 216 112 211 180 196M112 211V264L124 273" />
            <path d="M133 266V225L170 218V257M180 265 290 246 430 279M201 264 288 250 423 282" />
            <path d="M138 267 163 263 165 295 141 300ZM141 300 133 294 130 264 138 267M130 264 155 260 163 263" />
            <path d="M149 265C146 239 148 220 157 198M149 257C138 241 129 230 120 219M150 257C158 239 170 229 179 223M151 240C160 223 170 215 177 213" />
            <path d="M157 198C146 207 140 221 146 235C155 226 160 210 157 198Z" />
            <path d="M120 219C117 233 127 245 141 249C137 235 129 224 120 219Z" />
            <path d="M179 223C164 223 155 236 153 246C167 245 175 234 179 223Z" />
            <path d="M177 213C165 211 154 221 152 233C167 229 174 222 177 213Z" />
        </svg>
    );
}

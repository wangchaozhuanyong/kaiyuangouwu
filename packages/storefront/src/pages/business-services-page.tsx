import { ChevronRight, ExternalLink, KeyRound, Mail, Puzzle, WandSparkles } from 'lucide-react';

import { ClientPluginSlot, resolveClientPlugins } from '../client-plugins/client-plugin-registry';
import { resolveBottomNavigationItems } from '../components/common/bottom-navigation';
import { MobilePageHeader } from '../components/common/mobile-page-header';
import { useDesktopLayout } from '../desktop-layout';
import { SafeImage } from '../safe-image';
import { BusinessServicesPageContext } from '../storefront-page-contexts';
import { type RouteState } from '../storefront-router';
import {
    type StorefrontContentBlock,
    type StorefrontContentTargetType,
    type StorefrontLanguage,
} from '../types';

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
        marketLabel,
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
    const desktop = useDesktopLayout();
    const clientPluginBlock = contentBlocks.find(
        block => block.type === 'CLIENT_PLUGINS' && block.code === CLIENT_PLUGIN_BLOCK_CODE,
    );
    const navigationBlock = contentBlocks.find(block => block.type === 'NAVIGATION');
    const pageTitle =
        resolveBottomNavigationItems(navigationBlock, language).find(item => item.routeName === 'services')
            ?.label ?? (isZh ? '智能服务' : 'Intelligent services');
    const hasManagedCopy =
        clientPluginBlock?.settings?.businessServicesCopyVersion === BUSINESS_SERVICES_COPY_VERSION;
    const heroTitle =
        (hasManagedCopy ? clientPluginBlock?.title.trim() : '') ||
        (isZh ? '发现更多商业能力' : 'Discover more business capabilities');
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
    const shortcuts = [
        {
            code: 'ai-image-studio-entry',
            route: 'image-studio',
            label: isZh ? 'AI 图片工坊' : 'AI image studio',
            Icon: WandSparkles,
        },
        {
            code: 'two-factor-code-tool',
            route: 'two-factor',
            label: isZh ? '2FA 动态码' : 'Authenticator',
            Icon: KeyRound,
        },
        {
            code: 'icloud-mail-query-entry',
            route: 'mail-query',
            label: isZh ? '邮件验证码查询' : 'Mail verification codes',
            Icon: Mail,
        },
    ].filter(shortcut => plugins.some(plugin => plugin.code === shortcut.code));
    const heroImageUrl = desktop && clientPluginBlock?.enabled ? clientPluginBlock.imageUrl : null;

    return (
        <main className="page business-services-page">
            {!desktop && (
                <MobilePageHeader
                    className="business-services-mobile-header"
                    title={pageTitle}
                    storefrontName={storefrontName}
                    logoUrl={logoUrl}
                    language={language}
                    marketLabel={marketLabel}
                    displayCurrencyCode={displayCurrencyCode}
                    availableCurrencyCodes={availableCurrencyCodes}
                    currencyLoading={currencyLoading}
                    onToggleLanguage={onToggleLanguage}
                    onCurrencyChange={onCurrencyChange}
                    onNotifications={onNotifications}
                />
            )}
            <header className="business-services-heading">
                <div className="business-services-heading-copy">
                    {/* Only render copy exposed by the business services editor; legacy subtitles are not editable. */}
                    <h1 className="business-services-page-title">
                        {desktop && !hasManagedCopy ? pageTitle : heroTitle}
                    </h1>
                    <p>{heroDescription}</p>
                    {desktop && heroLinkTarget ? (
                        <button
                            type="button"
                            className="business-services-heading-link"
                            onClick={() => onContentTarget('URL', heroLinkTarget)}
                        >
                            {clientPluginBlock?.ctaLabel.trim() ||
                                (isZh ? '打开服务网站' : 'Open service website')}
                            <ExternalLink aria-hidden="true" />
                        </button>
                    ) : null}
                </div>
                {!desktop && heroLinkTarget ? (
                    <button
                        type="button"
                        className="business-services-heading-link"
                        onClick={() => onContentTarget('URL', heroLinkTarget)}
                    >
                        {isZh ? (desktop ? '点击前往' : '直通服务') : desktop ? 'Open link' : 'Open service'}
                        <ExternalLink aria-hidden="true" />
                    </button>
                ) : null}

                {desktop && (heroImageUrl || shortcuts.length > 0) ? (
                    <div className="business-services-hero-media">
                        {heroImageUrl ? (
                            <SafeImage src={heroImageUrl} alt="" imageKind="hero" />
                        ) : (
                            <nav
                                className="business-services-hero-shortcuts"
                                aria-label={isZh ? '服务快捷入口' : 'Service shortcuts'}
                            >
                                {shortcuts.map(({ code, route, label, Icon }) => (
                                    <button
                                        key={code}
                                        type="button"
                                        onClick={() => onNavigate({ name: route } as RouteState)}
                                    >
                                        <Icon aria-hidden="true" />
                                        <span>{label}</span>
                                        <ChevronRight aria-hidden="true" />
                                    </button>
                                ))}
                            </nav>
                        )}
                    </div>
                ) : null}
            </header>

            <ClientPluginSlot
                block={clientPluginBlock}
                placement="BUSINESS_SERVICES_MAIN"
                toolsFirst
                language={language}
                onNavigate={onNavigate}
            />

            {!plugins.length ? (
                <section className="business-services-empty" aria-live="polite">
                    <span aria-hidden="true">
                        <Puzzle />
                    </span>
                    <strong>{isZh ? '商业服务正在陆续开放' : 'Services are coming soon'}</strong>
                    <p>
                        {isZh
                            ? '店铺启用新的服务后，会自动显示在这里。'
                            : 'New services will appear here when the store enables them.'}
                    </p>
                </section>
            ) : null}
        </main>
    );
}

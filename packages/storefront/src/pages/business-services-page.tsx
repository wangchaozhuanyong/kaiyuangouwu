import { ExternalLink, Puzzle, Sparkles } from 'lucide-react';
import type { RouteState } from '../storefront-router';
import type { StorefrontContentBlock, StorefrontContentTargetType, StorefrontLanguage } from '../types';

import { ClientPluginSlot, resolveClientPlugins } from '../client-plugins/client-plugin-registry';
import { resolveBottomNavigationItems } from '../components/common/bottom-navigation';
import { BusinessServicesPageContext } from '../storefront-page-contexts';

const CLIENT_PLUGIN_BLOCK_CODE = 'storefront-client-plugins';
const BUSINESS_SERVICES_COPY_VERSION = 1;

export interface BusinessServicesPageProps {
    contentBlocks: StorefrontContentBlock[];
    language: StorefrontLanguage;
    onNavigate: (route: RouteState) => void;
    onContentTarget: (targetType: StorefrontContentTargetType, targetValue: string | null) => void;
}

export function BusinessServicesPage() {
    const { contentBlocks, language, onNavigate, onContentTarget } = BusinessServicesPageContext.useValue();
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

    return (
        <main className="page business-services-page">
            <header className="topbar business-services-topbar">
                <h1 className="business-services-page-title">{pageTitle}</h1>
            </header>

            <section className="business-services-hero" aria-labelledby="business-services-heading">
                <span className="business-services-hero-icon" aria-hidden="true">
                    <Sparkles />
                </span>
                <div>
                    <h2 id="business-services-heading">{heroTitle}</h2>
                    <p>{heroDescription}</p>
                    {heroLinkTarget ? (
                        <button
                            type="button"
                            className="business-services-hero-link"
                            onClick={() => onContentTarget('URL', heroLinkTarget)}
                        >
                            {isZh ? '访问链接' : 'Open link'}
                            <ExternalLink aria-hidden="true" />
                        </button>
                    ) : null}
                </div>
            </section>

            <ClientPluginSlot
                block={clientPluginBlock}
                placement="BUSINESS_SERVICES_MAIN"
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

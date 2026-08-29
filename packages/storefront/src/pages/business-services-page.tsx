import type { RouteState } from '../storefront-router';
import type { StorefrontContentBlock, StorefrontLanguage } from '../types';
import { BriefcaseBusiness, Puzzle, Sparkles } from 'lucide-react';

import { ClientPluginSlot, resolveClientPlugins } from '../client-plugins/client-plugin-registry';
import { useStorefront } from '../StorefrontContext';

interface BusinessServicesPageProps {
    contentBlocks: StorefrontContentBlock[];
    language: StorefrontLanguage;
    onNavigate: (route: RouteState) => void;
}

export function BusinessServicesPage() {
    const { contentBlocks, language, onNavigate } = useStorefront<BusinessServicesPageProps>();
    const isZh = language === 'zh';
    const clientPluginBlock = contentBlocks.find(block => block.type === 'CLIENT_PLUGINS');
    const plugins = resolveClientPlugins(clientPluginBlock, 'BUSINESS_SERVICES_MAIN');

    return (
        <main className="page business-services-page">
            <header className="topbar business-services-topbar">
                <div className="business-services-title-lockup">
                    <span className="business-services-title-icon" aria-hidden="true">
                        <BriefcaseBusiness />
                    </span>
                    <h1>{isZh ? '商业服务' : 'Business services'}</h1>
                </div>
            </header>

            <section className="business-services-hero" aria-labelledby="business-services-heading">
                <span className="business-services-hero-icon" aria-hidden="true">
                    <Sparkles />
                </span>
                <div>
                    <h2 id="business-services-heading">
                        {isZh ? '发现更多商业能力' : 'Discover more business capabilities'}
                    </h2>
                    <p>
                        {isZh
                            ? '这里展示店铺为你开放的工具、服务和专属权益。'
                            : 'Explore tools, services, and benefits enabled by this store.'}
                    </p>
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

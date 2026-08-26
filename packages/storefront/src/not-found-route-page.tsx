import { ArrowLeft, House, LayoutGrid, Navigation } from 'lucide-react';

import { RouteState } from './storefront-router';
import { useStorefront } from './StorefrontContext';
import { StorefrontLanguage } from './types';

interface NotFoundRouteRuntime {
    language: StorefrontLanguage;
    storefrontName: string;
    goBack: () => void;
    navigate: (route: RouteState, replace?: boolean) => void;
}

export function NotFoundRoutePage() {
    const runtime = useStorefront<NotFoundRouteRuntime>();
    const isZh = runtime.language === 'zh';

    return (
        <main className="page subpage not-found-page">
            <header className="topbar subpage-header">
                <button type="button" onClick={runtime.goBack} aria-label={isZh ? '返回' : 'Back'}>
                    <ArrowLeft aria-hidden="true" />
                </button>
                <strong>{isZh ? '页面未找到' : 'Page not found'}</strong>
                <span />
            </header>
            <section className="not-found-content">
                <span className="not-found-code" aria-hidden="true">
                    404
                </span>
                <span className="not-found-mark" aria-hidden="true">
                    <Navigation />
                </span>
                <h1>{isZh ? '这个页面不存在' : 'This page does not exist'}</h1>
                <p>
                    {isZh
                        ? '链接可能已失效，或者页面已经调整。'
                        : 'The link may have expired, or the page may have moved.'}
                </p>
                <div className="not-found-actions">
                    <button type="button" onClick={() => runtime.navigate({ name: 'home' }, true)}>
                        <House aria-hidden="true" />
                        {isZh ? `返回${runtime.storefrontName}首页` : `Back to ${runtime.storefrontName}`}
                    </button>
                    <button type="button" onClick={() => runtime.navigate({ name: 'category' }, true)}>
                        <LayoutGrid aria-hidden="true" />
                        {isZh ? '浏览商品' : 'Browse products'}
                    </button>
                </div>
            </section>
        </main>
    );
}

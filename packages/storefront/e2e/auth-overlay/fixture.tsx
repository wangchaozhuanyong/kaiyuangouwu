// organize-imports-ignore -- Preserve ESLint type groups and CSS side-effect order.
import type { ShopApi } from '../../src/api';
import type { MarketConfig, StorefrontContentBlock, StorefrontLanguage } from '../../src/types';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
    createMemoryHistory,
    createRootRoute,
    createRoute,
    createRouter,
    RouterProvider,
} from '@tanstack/react-router';
import { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import '../../src/styles.css';
import '../../src/styles/control-surfaces.css';
import '../../src/styles/visual-presets.css';

import {
    resolveStorefrontSemanticPalette,
    semanticPaletteCssVariables,
    storefrontSkinCssVariables,
} from '../../../storefront-content-plugin/src/shared/storefront-semantic-palette';
import { AuthenticationOverlay } from '../../src/auth-overlay';
import { isAuthOverlayMode } from '../../src/auth-overlay-navigation';
import { DesktopLayoutContext, useDesktopViewport } from '../../src/desktop-layout';
import { useStorefrontNavigation } from '../../src/hooks/useStorefrontNavigation';
import { OverlayHost } from '../../src/overlay-host';
import { routeHref } from '../../src/storefront-router';
import { StorefrontContext, type StorefrontContextValue } from '../../src/StorefrontContext';

// Uses production presentation/navigation with synthetic data. No real API or account is used.
const params = new URLSearchParams(location.search);
const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
const market: MarketConfig = {
    code: 'auth-overlay-local-only',
    defaultLanguageCode: 'zh_Hans',
    currencyCode: 'MYR',
    countryCode: 'MY',
    locale: 'zh-CN',
    label: 'Local synthetic preview',
};

function authBlock(type: 'AUTH_LOGIN' | 'AUTH_REGISTER'): StorefrontContentBlock {
    const login = type === 'AUTH_LOGIN';
    return {
        id: type,
        code: `local-${type}`,
        type,
        enabled: true,
        position: login ? 0 : 1,
        startsAt: null,
        endsAt: null,
        imageUrl: null,
        backgroundColor: '#061B44',
        textColor: '#FFFFFF',
        targetType: 'NONE',
        targetValue: null,
        title: '',
        subtitle: '',
        body: '',
        ctaLabel: '',
        items: [],
        settings: {
            // Existing Admin settings, using the already-defined auth palette as sample content.
            accentColor: login ? '#5BD8FF' : '#8B5CF6',
            formTitleZh: login ? '登录账户' : '注册账户',
            formTitleEn: login ? 'Sign in' : 'Create account',
            formSubtitleZh: login ? '登录后管理订单与服务' : '创建账户，探索 AI 工具与服务',
            formSubtitleEn: login ? 'Manage your orders and services' : 'Explore AI tools and services',
        },
    };
}

function legalBlock(language: StorefrontLanguage): StorefrontContentBlock {
    return {
        ...authBlock('AUTH_LOGIN'),
        id: 'local-legal',
        code: 'local-legal',
        type: 'LEGAL',
        title: '',
        settings: {},
        items: [
            {
                id: 'privacy',
                enabled: true,
                position: 0,
                imageUrl: null,
                label: language === 'zh' ? '隐私政策' : 'Privacy policy',
                description: '',
                targetType: 'PAGE',
                targetValue: '/legal?id=privacy',
            },
            {
                id: 'terms',
                enabled: true,
                position: 1,
                imageUrl: null,
                label: language === 'zh' ? '使用条款' : 'Terms of service',
                description: '',
                targetType: 'PAGE',
                targetValue: '/legal?id=terms',
            },
        ],
    };
}

function Fixture() {
    const desktop = useDesktopViewport();
    const [language, setLanguage] = useState<StorefrontLanguage>(params.get('lang') === 'en' ? 'en' : 'zh');
    const [preset, setPreset] = useState<'classic' | 'neo-minimalist'>(
        params.get('skin') === 'neo-minimalist' ? 'neo-minimalist' : 'classic',
    );
    const [authenticated, setAuthenticated] = useState(false);
    const [events, setEvents] = useState<string[]>([]);
    const contentBlocks = useMemo(() => [authBlock('AUTH_LOGIN'), authBlock('AUTH_REGISTER')], []);
    const navigation = useStorefrontNavigation({ collections: [], contentBlocks, authenticated });
    const isZh = language === 'zh';

    useEffect(() => {
        const palette = resolveStorefrontSemanticPalette(preset);
        document.documentElement.dataset.storefrontPreset = preset;
        document.documentElement.style.colorScheme = preset === 'classic' ? 'light' : 'dark';
        for (const [key, value] of Object.entries({
            ...semanticPaletteCssVariables(palette),
            ...storefrontSkinCssVariables(preset, palette),
        })) {
            document.documentElement.style.setProperty(key, value);
        }
    }, [preset]);
    useEffect(() => {
        document.documentElement.lang = language === 'zh' ? 'zh-CN' : 'en';
    }, [language]);

    const api = useMemo(() => {
        const finish = (operation: string) => {
            setEvents(previous => [...previous, operation]);
            if (params.get('fail') === '1')
                return Promise.reject(new Error('Local simulated request failed'));
            return Promise.resolve();
            // Request data deliberately stays inside the form and is never logged or persisted.
        };
        return {
            login: () => finish('login'),
            registerCustomerAccount: () => finish('register'),
            requestPasswordReset: () => finish('password-reset'),
            refreshCustomerVerification: () => finish('resend-verification'),
            referralProgram: () => Promise.resolve({ enabled: true, attributionWindowDays: 30 }),
            validateReferralInviteCode: () => Promise.resolve(true),
        } as unknown as ShopApi;
    }, []);

    const runtime = {
        ...navigation,
        api,
        language,
        storefrontName: 'Local component preview',
        storefrontCode: market.code,
        market,
        customer: authenticated ? { id: 'local-synthetic-customer' } : null,
        logoUrl: null,
        contentBlocks,
        contentQuery: { isPending: false },
        authSettings: {
            emailPasswordEnabled: true,
            emailAutoRegistrationEnabled: false,
            emailQuickRegistrationEnabled: false,
            googleEnabled: false,
            googleClientId: null,
        },
        legalContent: legalBlock(language),
        toggleLanguage: () => setLanguage(current => (current === 'zh' ? 'en' : 'zh')),
        completeAuthentication: (_login: unknown, destination: StorefrontContextValue['route']) => {
            setAuthenticated(true);
            navigation.navigateAfterAuthentication(destination ?? navigation.route, true);
            return Promise.resolve();
        },
    } as unknown as StorefrontContextValue;

    return (
        <DesktopLayoutContext.Provider value={desktop}>
            <StorefrontContext.Provider value={runtime}>
                <style>{`
                    .local-auth-preview { width: 100%;
                        min-height: 100dvh;
                        padding: var(--space-24);
                        max-width: 1240px;
                        margin: auto;
                        border: 0;
                        box-shadow: none;
                        color: var(--text);
                        }
                    .local-auth-toolbar { display: flex;
                        flex-wrap: wrap;
                        gap: var(--space-12);
                        align-items: center;
                        margin-bottom: var(--space-24);
                        }
                    .local-auth-toolbar select, .local-auth-toolbar button { min-height: 44px;
                        padding: var(--space-8) var(--space-16);
                        border-radius: var(--skin-control-radius);
                        background: var(--surface);
                        }
                    .local-auth-toolbar strong { margin-right: auto;
                        }
                    .local-auth-banner { padding: clamp(24px, 5vw, 64px);
                        border-radius: var(--skin-hero-radius);
                        background: linear-gradient(120deg,
                        color-mix(in srgb, #5BD8FF 30%, var(--surface)),
                        color-mix(in srgb, #8B5CF6 18%, var(--surface)));
                        }
                    .local-auth-banner h1 { margin: var(--space-12) 0;
                        max-width: 18ch;
                        font-size: var(--type-display-size);
                        line-height: var(--type-display-leading);
                        }
                    .local-auth-banner p { max-width: 54ch;
                        }
                    .local-auth-actions { display: flex;
                        flex-wrap: wrap;
                        gap: var(--space-12);
                        margin-top: var(--space-24);
                        }
                    .local-auth-actions button { min-height: 48px;
                        padding: var(--space-12) var(--space-24);
                        border-radius: var(--skin-control-radius);
                        background: var(--accent);
                        color: var(--accent-foreground);
                        font-size: var(--type-action-size);
                        line-height: var(--type-action-leading);
                        }
                    .local-auth-actions button + button { background: var(--surface);
                        color: var(--text);
                        }
                    .local-auth-grid { display: grid;
                        grid-template-columns: repeat(3, minmax(0, 1fr));
                        gap: var(--space-16);
                        margin-top: var(--space-24);
                        }
                    .local-auth-card { min-width: 0;
                        padding: var(--space-24);
                        background: var(--surface);
                        border-radius: var(--skin-card-radius);
                        }
                    .local-auth-tile { min-height: 120px;
                        display: grid;
                        place-items: center;
                        border-radius: var(--skin-media-radius);
                        background: linear-gradient(135deg,
                        color-mix(in srgb, #5BD8FF 18%, var(--surface)),
                        color-mix(in srgb, #8B5CF6 16%, var(--surface)));
                        color: var(--text);
                        }
                    .local-auth-card h2 { margin: var(--space-16) 0 var(--space-8);
                        }
                    .local-auth-disclaimer { margin-top: var(--space-24);
                        padding: var(--space-16);
                        background: var(--soft);
                        border-radius: var(--skin-control-radius);
                        }
                    @media (max-width: 767px) { .local-auth-preview { padding: var(--space-16);
                        } .local-auth-grid { grid-template-columns: 1fr;
                        } .local-auth-banner h1 { font-size: var(--type-page-size);
                        line-height: var(--type-page-leading);
                        } }
                `}</style>
                <div className="storefront-app local-auth-preview" data-testid="auth-preview-background">
                    <header className="local-auth-toolbar">
                        <strong className="type-card">
                            {isZh ? '店铺预览 · 本地测试' : 'Store preview · local test'}
                        </strong>
                        <select
                            aria-label="Preview skin"
                            value={preset}
                            onChange={event => setPreset(event.target.value as typeof preset)}
                        >
                            <option value="classic">{isZh ? '经典浅色' : 'Classic light'}</option>
                            <option value="neo-minimalist">{isZh ? '新锐深色' : 'Neo dark'}</option>
                        </select>
                        <button type="button" onClick={runtime.toggleLanguage}>
                            {isZh ? 'English' : '简体中文'}
                        </button>
                    </header>
                    <main>
                        <section className="local-auth-banner">
                            <span className="type-label">
                                {isZh ? '探索 · 创作 · 开发' : 'EXPLORE · CREATE · BUILD'}
                            </span>
                            <h1>{isZh ? '灵感与效率，随时开启' : 'Make room for your next idea'}</h1>
                            <p className="type-body">
                                {isZh
                                    ? '这是认证弹层的本地组件演示。背景和商品为合成样本，表单操作不会创建真实账户或发送邮件。'
                                    : 'A local preview of the real authentication overlay. Background products are synthetic; ' +
                                      'forms do not create real accounts or send email.'}
                            </p>
                            <div className="local-auth-actions">
                                <button
                                    type="button"
                                    data-testid="open-login"
                                    onClick={() => navigation.navigate({ name: 'login' })}
                                >
                                    {isZh ? '登录账户' : 'Sign in'}
                                </button>
                                <button
                                    type="button"
                                    data-testid="open-register"
                                    onClick={() => navigation.navigate({ name: 'register' })}
                                >
                                    {isZh ? '创建账户' : 'Create account'}
                                </button>
                            </div>
                        </section>
                        <section
                            className="local-auth-grid"
                            aria-label={isZh ? '合成商品样本' : 'Synthetic product samples'}
                        >
                            {(isZh
                                ? ['AI 创作工具', '开发辅助工具', '效率服务']
                                : ['Creative tools', 'Developer tools', 'Productivity services']
                            ).map((title, index) => (
                                <article className="local-auth-card" key={title}>
                                    <div className="local-auth-tile type-identity">
                                        {['✦', '⌘', '↗'][index]}
                                    </div>
                                    <h2 className="type-section">{title}</h2>
                                    <p className="type-body">
                                        {isZh
                                            ? '仅用于展示弹窗前后的页面层次，不代表真实商品。'
                                            : 'Synthetic content showing the page behind the overlay.'}
                                    </p>
                                </article>
                            ))}
                        </section>
                        <aside
                            className="local-auth-disclaimer type-helper"
                            data-testid="preview-status"
                            role="status"
                        >
                            {isZh ? '本地模拟状态' : 'Local simulated state'}:{' '}
                            {authenticated ? 'signed in' : 'signed out'} · {navigation.route.name} ·{' '}
                            {navigation.authOverlay?.mode ?? 'closed'}
                            <span data-testid="preview-events">
                                {events.length ? ` · ${events.join(', ')}` : ''}
                            </span>
                        </aside>
                    </main>
                </div>
                <OverlayHost
                    ownerKey={JSON.stringify([
                        'authentication',
                        runtime.storefrontCode,
                        market.code,
                        market.currencyCode,
                        routeHref(navigation.displayedRoute),
                    ])}
                >
                    {navigation.authOverlay && <AuthenticationOverlay request={navigation.authOverlay} />}
                </OverlayHost>
            </StorefrontContext.Provider>
        </DesktopLayoutContext.Provider>
    );
}

const initialMode = params.get('mode');
const rootRoute = createRootRoute({
    component: Fixture,
    validateSearch: (search: Record<string, unknown>) => search,
});
const routeTree = rootRoute.addChildren(
    ['/', '/account', '/legal'].map(path => createRoute({ getParentRoute: () => rootRoute, path })),
);
const router = createRouter({
    routeTree,
    history: createMemoryHistory({
        initialEntries: [isAuthOverlayMode(initialMode) ? `/?auth=${initialMode}` : '/'],
    }),
});
// Test-only access to the real memory-history adapter, including while the background is inert.
Object.assign(window, {
    __authOverlayPreviewHistory: {
        back: () => router.history.back(),
        forward: () => router.history.forward(),
    },
});
const root = document.getElementById('root');
if (!root) throw new Error('Authentication preview root is missing');
createRoot(root).render(
    <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
    </QueryClientProvider>,
);

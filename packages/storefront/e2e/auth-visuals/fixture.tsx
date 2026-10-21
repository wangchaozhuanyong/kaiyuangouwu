// Local visual acceptance only: real auth components with synthetic, non-network account actions.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
    createMemoryHistory,
    createRootRoute,
    createRoute,
    createRouter,
    RouterProvider,
} from '@tanstack/react-router';
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { StorefrontContentBlock } from '../../src/types';

import {
    resolveStorefrontSemanticPalette,
    semanticPaletteCssVariables,
    storefrontSkinCssVariables,
} from '../../../storefront-content-plugin/src/shared/storefront-semantic-palette';
import { ShopApiError, type ShopApi } from '../../src/api';
import { ForgotPasswordPage, LoginPage, RegisterPage, VerifyAccountPage } from '../../src/auth-pages';
import { DesktopLayoutContext, useDesktopViewport } from '../../src/desktop-layout';
import '../../src/storefront-styles';

import artworkPlan from './artwork-plan.json';

const params = new URLSearchParams(location.search);
const store = artworkPlan.stores.find(item => item.key === params.get('store')) ?? artworkPlan.stores[0];
const preset = params.get('skin') === 'neo-minimalist' ? 'neo-minimalist' : 'classic';
const palette = resolveStorefrontSemanticPalette(preset);
document.documentElement.dataset.storefrontPreset = preset;
document.documentElement.style.colorScheme = preset === 'classic' ? 'light' : 'dark';
for (const [key, value] of Object.entries({
    ...semanticPaletteCssVariables(palette),
    ...storefrontSkinCssVariables(preset, palette),
})) {
    document.documentElement.style.setProperty(key, value);
}
const verificationState = params.get('state') ?? 'password';
let completionAttempts = 0;
const api = {
    verifyCustomerAccount: async (_token: string, password?: string) => {
        if (verificationState === 'pending') return new Promise<void>(() => undefined);
        if (verificationState === 'expired')
            throw new ShopApiError('VERIFICATION_TOKEN_EXPIRED_ERROR', 'Local fixture');
        if (verificationState === 'network') throw new TypeError('Load failed');
        if (!password && verificationState !== 'success' && verificationState !== 'session-error')
            throw new ShopApiError('MISSING_PASSWORD_ERROR', 'Local fixture');
    },
    referralProgram: () => Promise.resolve({ enabled: false, attributionWindowDays: 30 }),
    registerCustomerAccount: () => Promise.resolve({ __typename: 'Success', success: true }),
    refreshCustomerVerification: () => Promise.resolve({ __typename: 'Success', success: true }),
    login: () => Promise.reject(new Error('Local visual preview: no account request is sent.')),
} as unknown as ShopApi;
const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

type PreviewVariant = 'login' | 'register' | 'forgot-password' | 'verify-account';

function Fixture({ variant }: { variant: PreviewVariant }) {
    const desktop = useDesktopViewport();
    const [language, setLanguage] = useState<'zh' | 'en'>(params.get('lang') === 'en' ? 'en' : 'zh');
    const copy =
        store.copy[
            variant === 'forgot-password' ? 'login' : variant === 'verify-account' ? 'register' : variant
        ][language];
    const content: StorefrontContentBlock = {
        id: 'local-' + variant,
        code: 'auth-' + variant + '-visual',
        type: variant === 'login' ? 'AUTH_LOGIN' : 'AUTH_REGISTER',
        enabled: true,
        position: 0,
        startsAt: null,
        endsAt: null,
        targetType: 'NONE',
        targetValue: null,
        title: copy.title,
        subtitle: copy.subtitle,
        body: '',
        ctaLabel: '',
        items: [],
        imageUrl: new URL('./artwork/' + store.file, import.meta.url).href,
        backgroundColor: store.backgroundColor,
        textColor: store.textColor,
        settings: { heroCopyPosition: 'bottom', heroLogoEnabled: true, accentColor: store.accentColor },
    };
    const props = {
        api,
        language,
        storefrontName: store.name,
        logoUrl: store.logoUrl,
        authVisualContent: content,
        onBack: () => undefined,
        onToggleLanguage: () => setLanguage(language === 'zh' ? 'en' : 'zh'),
        onSuccess: () => {
            if (verificationState === 'session-error' && completionAttempts++ === 0)
                return Promise.reject(new Error('Local session read failed'));
            return Promise.resolve();
        },
        onContentTarget: () => undefined,
        authSettings: {
            emailPasswordEnabled: true,
            emailAutoRegistrationEnabled: false,
            emailQuickRegistrationEnabled: true,
            googleEnabled: false,
            googleClientId: null,
        },
    };
    return (
        <DesktopLayoutContext.Provider value={desktop}>
            <div className={desktop ? 'desktop-store-layout' : ''}>
                <div className="desktop-shell-frame">
                    <div id="storefront-content">
                        {variant === 'login' ? (
                            <LoginPage {...props} />
                        ) : variant === 'register' ? (
                            <RegisterPage {...props} />
                        ) : variant === 'verify-account' ? (
                            <VerifyAccountPage
                                {...props}
                                onToggleLanguage={undefined}
                                token={verificationState === 'missing' ? undefined : 'synthetic-local-link'}
                            />
                        ) : (
                            <ForgotPasswordPage {...props} />
                        )}
                    </div>
                </div>
            </div>
        </DesktopLayoutContext.Provider>
    );
}
const rootRoute = createRootRoute();
const routeTree = rootRoute.addChildren(
    ['login', 'register', 'forgot-password', 'verify-account'].map(variant =>
        createRoute({
            getParentRoute: () => rootRoute,
            path: '/' + variant,
            component: () => <Fixture variant={variant as PreviewVariant} />,
        }),
    ),
);
const router = createRouter({
    routeTree,
    history: createMemoryHistory({
        initialEntries: [
            ['login', 'register', 'forgot-password', 'verify-account'].includes(params.get('variant') ?? '')
                ? '/' + params.get('variant')
                : '/register',
        ],
    }),
});
const rootElement = document.getElementById('root');
if (!rootElement) throw new Error('Preview root element is missing');
const previewRoot = createRoot(rootElement);
previewRoot.render(
    <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
    </QueryClientProvider>,
);

import.meta.hot?.dispose(() => previewRoot.unmount());

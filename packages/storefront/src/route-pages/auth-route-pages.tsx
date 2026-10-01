import { ReactNode, Suspense, useRef } from 'react';
import { preload } from 'react-dom';

import { authOriginalImageUrl } from '../../../storefront-content-plugin/src/shared/auth-visual';
import { findAuthVisualContent } from '../auth-visual';
import { useDesktopLayout } from '../desktop-layout';
import {
    LazyForgotPasswordPage,
    LazyLoginPage,
    LazyRegisterPage,
    LazyResetPasswordPage,
    LazyVerifyAccountPage,
} from '../lazy-storefront-pages';
import { imageSources } from '../responsive-image';
import { AuthPageBoundary } from '../storefront-ui/page-shell';

import { registerRoutePreload, useRouteRuntime as useRuntime } from './shared';

// A locale refresh must not clear credentials or briefly remove the merchant image.
// This cache is component memory only and is discarded on navigation/store changes.
function useAuthVisualContent(variant: 'login' | 'register') {
    const runtime = useRuntime();
    const content = findAuthVisualContent(runtime.contentBlocks, variant);
    const scope = `${runtime.market.code}:${variant}`;
    const previous = useRef({ scope, content });
    if (previous.current.scope !== scope || !runtime.contentQuery?.isPending)
        previous.current = { scope, content };
    return runtime.contentQuery?.isPending ? previous.current.content : content;
}

function AuthRouteBoundary({
    children,
    heroVariant,
}: {
    children: ReactNode;
    heroVariant?: 'login' | 'register';
}) {
    const runtime = useRuntime();
    const desktop = useDesktopLayout();
    const content = heroVariant ? findAuthVisualContent(runtime.contentBlocks, heroVariant) : undefined;
    if (desktop && content?.imageUrl) {
        const source = authOriginalImageUrl(content.imageUrl);
        const responsive = imageSources(source, 'detail', '(min-width: 1024px) 640px, 1px');
        preload(responsive.src, {
            as: 'image',
            fetchPriority: 'high',
            imageSrcSet: responsive.srcSet,
            imageSizes: responsive.sizes,
        });
    }
    const pendingContent =
        heroVariant && runtime.contentQuery?.isPending && !runtime.error && !runtime.contentError;
    const initialized = useRef(false);
    if (!pendingContent) initialized.current = true;
    const pendingInitialContent = pendingContent && !initialized.current;
    const placeholder = <span data-page-pending="module" />;
    return (
        <AuthPageBoundary language={runtime.language} onBack={runtime.goBack}>
            <Suspense fallback={placeholder}>{pendingInitialContent ? placeholder : children}</Suspense>
        </AuthPageBoundary>
    );
}

export function LoginRoutePage() {
    const runtime = useRuntime();
    const authVisualContent = useAuthVisualContent('login');
    return (
        <AuthRouteBoundary heroVariant="login">
            <LazyLoginPage
                returnTo={runtime.route.returnTo}
                returnVariantId={runtime.route.id}
                returnQuantity={runtime.route.quantity}
                api={runtime.api}
                language={runtime.language}
                logoUrl={runtime.logoUrl}
                storefrontName={runtime.storefrontName}
                legalContent={runtime.legalContent}
                authVisualContent={authVisualContent}
                authSettings={runtime.authSettings}
                onToggleLanguage={runtime.toggleLanguage}
                onBack={runtime.goBack}
                onSuccess={runtime.completeAuthentication}
                onContentTarget={runtime.openContentTarget}
            />
        </AuthRouteBoundary>
    );
}

export function RegisterRoutePage() {
    const runtime = useRuntime();
    const authVisualContent = useAuthVisualContent('register');
    return (
        <AuthRouteBoundary heroVariant="register">
            <LazyRegisterPage
                returnTo={runtime.route.returnTo}
                returnVariantId={runtime.route.id}
                returnQuantity={runtime.route.quantity}
                api={runtime.api}
                language={runtime.language}
                logoUrl={runtime.logoUrl}
                storefrontName={runtime.storefrontName}
                legalContent={runtime.legalContent}
                authVisualContent={authVisualContent}
                authSettings={runtime.authSettings}
                onToggleLanguage={runtime.toggleLanguage}
                onBack={runtime.goBack}
                onSuccess={runtime.completeAuthentication}
                onContentTarget={runtime.openContentTarget}
            />
        </AuthRouteBoundary>
    );
}

export function VerifyAccountRoutePage() {
    const runtime = useRuntime();
    return (
        <AuthRouteBoundary>
            <LazyVerifyAccountPage
                returnTo={runtime.route.returnTo}
                returnVariantId={runtime.route.id}
                returnQuantity={runtime.route.quantity}
                api={runtime.api}
                language={runtime.language}
                logoUrl={runtime.logoUrl}
                storefrontName={runtime.storefrontName}
                token={runtime.route.token}
                onBack={runtime.goBack}
                onSuccess={runtime.completeAuthentication}
            />
        </AuthRouteBoundary>
    );
}

export function ForgotPasswordRoutePage() {
    const runtime = useRuntime();
    return (
        <AuthRouteBoundary heroVariant="login">
            <LazyForgotPasswordPage
                returnTo={runtime.route.returnTo}
                returnVariantId={runtime.route.id}
                returnQuantity={runtime.route.quantity}
                api={runtime.api}
                language={runtime.language}
                logoUrl={runtime.logoUrl}
                storefrontName={runtime.storefrontName}
                authVisualContent={findAuthVisualContent(runtime.contentBlocks, 'login')}
                onBack={runtime.goBack}
            />
        </AuthRouteBoundary>
    );
}

export function ResetPasswordRoutePage() {
    const runtime = useRuntime();
    return (
        <AuthRouteBoundary>
            <LazyResetPasswordPage
                returnTo={runtime.route.returnTo}
                returnVariantId={runtime.route.id}
                returnQuantity={runtime.route.quantity}
                api={runtime.api}
                language={runtime.language}
                logoUrl={runtime.logoUrl}
                storefrontName={runtime.storefrontName}
                token={runtime.route.token}
                onBack={runtime.goBack}
                onSuccess={runtime.completeAuthentication}
            />
        </AuthRouteBoundary>
    );
}

export const preloadLoginRoutePage = registerRoutePreload(LoginRoutePage, LazyLoginPage);
export const preloadRegisterRoutePage = registerRoutePreload(RegisterRoutePage, LazyRegisterPage);
export const preloadVerifyAccountRoutePage = registerRoutePreload(
    VerifyAccountRoutePage,
    LazyVerifyAccountPage,
);
export const preloadForgotPasswordRoutePage = registerRoutePreload(
    ForgotPasswordRoutePage,
    LazyForgotPasswordPage,
);
export const preloadResetPasswordRoutePage = registerRoutePreload(
    ResetPasswordRoutePage,
    LazyResetPasswordPage,
);

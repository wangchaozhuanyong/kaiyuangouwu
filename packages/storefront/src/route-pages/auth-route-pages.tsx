import { ReactNode, Suspense } from 'react';
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
    const placeholder = <span data-page-pending="module" />;
    return (
        <AuthPageBoundary language={runtime.language} onBack={runtime.goBack}>
            <Suspense fallback={placeholder}>{pendingContent ? placeholder : children}</Suspense>
        </AuthPageBoundary>
    );
}

export function LoginRoutePage() {
    const runtime = useRuntime();
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
                authVisualContent={findAuthVisualContent(runtime.contentBlocks, 'login')}
                authSettings={runtime.authSettings}
                onBack={runtime.goBack}
                onSuccess={runtime.completeAuthentication}
                onContentTarget={runtime.openContentTarget}
            />
        </AuthRouteBoundary>
    );
}

export function RegisterRoutePage() {
    const runtime = useRuntime();
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
                authVisualContent={findAuthVisualContent(runtime.contentBlocks, 'register')}
                authSettings={runtime.authSettings}
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

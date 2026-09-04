import { ReactNode, Suspense } from 'react';

import { findAuthVisualContent } from '../auth-visual';
import {
    LazyForgotPasswordPage,
    LazyLoginPage,
    LazyRegisterPage,
    LazyResetPasswordPage,
    LazyVerifyAccountPage,
} from '../lazy-storefront-pages';
import { PageSkeleton } from '../route-loading';
import { AuthPageBoundary } from '../storefront-ui/page-shell';

import { registerRoutePreload, useRouteRuntime as useRuntime } from './shared';

function AuthRouteBoundary({ children }: { children: ReactNode }) {
    const runtime = useRuntime();
    return (
        <AuthPageBoundary language={runtime.language} onBack={runtime.goBack}>
            <Suspense fallback={<PageSkeleton label={runtime.language === 'zh' ? '正在加载' : 'Loading'} />}>
                {children}
            </Suspense>
        </AuthPageBoundary>
    );
}

export function LoginRoutePage() {
    const runtime = useRuntime();
    return (
        <AuthRouteBoundary>
            <LazyLoginPage
                api={runtime.api}
                language={runtime.language}
                logoUrl={runtime.logoUrl}
                storefrontName={runtime.storefrontName}
                legalContent={runtime.legalContent}
                authVisualContent={findAuthVisualContent(runtime.contentBlocks, 'login')}
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
        <AuthRouteBoundary>
            <LazyRegisterPage
                api={runtime.api}
                language={runtime.language}
                logoUrl={runtime.logoUrl}
                storefrontName={runtime.storefrontName}
                legalContent={runtime.legalContent}
                authVisualContent={findAuthVisualContent(runtime.contentBlocks, 'register')}
                onBack={runtime.goBack}
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
        <AuthRouteBoundary>
            <LazyForgotPasswordPage
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

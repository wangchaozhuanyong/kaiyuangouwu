// organize-imports-ignore -- CSS side effects require the explicit cascade order below.
import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import { StrictMode } from 'react';
import { createRoot, hydrateRoot } from 'react-dom/client';

import { storefrontQueryClient } from './query-client';
import { preloadStorefrontRouteComponent } from './route-component-preload';
import { router } from './router';
import { readInitialStorefrontBoot, seedStorefrontBoot } from './storefront-boot-data';
import { restoreStorefrontIcons } from './storefront-icons';
import { readInitialPublicPage, seedPublicPage, type PublicPageData } from './storefront-page-data';
import { routeFromRouterLocation } from './storefront-router';
import { StorefrontErrorBoundary } from './StorefrontErrorBoundary';
import './storefront-styles';

const rootElement = document.getElementById('root');

if (!rootElement) {
    throw new Error('Storefront root element was not found');
}
const appRootElement = rootElement;

const embeddedPreview = new URLSearchParams(window.location.search).get('storefrontPreviewEmbedded') === '1';
restoreStorefrontIcons();
let initialPublicPage: PublicPageData | undefined;
if (!embeddedPreview) {
    try {
        const initialBoot = readInitialStorefrontBoot();
        const initialPage = readInitialPublicPage();
        initialPublicPage = initialPage;
        if (initialPage) seedPublicPage(storefrontQueryClient, initialPage);
        else if (initialBoot) seedStorefrontBoot(storefrontQueryClient, initialBoot);
        // The exact HTML snapshot owns hydration. Newer session data may be adopted
        // by bootstrap only for missing reads, without replacing this document's tree.
        const adoptingSnapshot = !!initialPage && appRootElement.dataset.publicRendered === '1';
        const startPersistence = () => {
            const cache = import('./query-persistence');
            if (!adoptingSnapshot)
                void cache
                    .then(({ restorePublicQueryCache }) => restorePublicQueryCache(storefrontQueryClient))
                    .catch(() => undefined);
            void cache
                .then(({ watchPublicQueryCache }) => {
                    watchPublicQueryCache(storefrontQueryClient, undefined, adoptingSnapshot);
                })
                .catch(() => undefined);
        };
        // A valid SSR document already owns the public data. Download and subscribe
        // only after its first interactive commit, without joining route readiness.
        if (adoptingSnapshot && !document.documentElement.hasAttribute('data-storefront-app-owned'))
            document.addEventListener('storefront:app-owned', startPersistence, { once: true });
        else startPersistence();
    } catch {
        // sessionStorage can be disabled without preventing the storefront from starting.
    }
}

async function mountStorefront() {
    if (embeddedPreview) {
        const { installStorefrontPreviewRuntime } = await import('./storefront-preview-runtime');
        installStorefrontPreviewRuntime();
    }

    const interactiveApp = (
        <StrictMode>
            <QueryClientProvider client={storefrontQueryClient}>
                <StorefrontErrorBoundary>
                    <RouterProvider router={router} />
                </StorefrontErrorBoundary>
            </QueryClientProvider>
        </StrictMode>
    );
    const adoptingPublicHtml =
        !embeddedPreview && initialPublicPage && appRootElement.dataset.publicRendered === '1';
    if (adoptingPublicHtml) {
        // TanStack keeps the server's root boundary structure for a hydrated app.
        // Asset metadata is supplied by the HTML controller rather than a Start manifest.
        router.ssr = { manifest: undefined };
    }
    // Even a client-only entry must have a route match before its first commit.
    // Keep the existing HTML/initial placeholder while this same router loads.
    const location = router.state.location;
    const route = routeFromRouterLocation(location.pathname, location.search);
    await Promise.all([preloadStorefrontRouteComponent(route.name), router.load()]);
    if (adoptingPublicHtml) {
        hydrateRoot(appRootElement, interactiveApp);
    } else {
        createRoot(appRootElement).render(interactiveApp);
    }
}

function StartupFailure({ error }: { error: unknown }): never {
    throw error;
}

void mountStorefront().catch(error => {
    // A route chunk failure happens before hydration, outside React's normal boundary.
    createRoot(appRootElement).render(
        <StorefrontErrorBoundary>
            <StartupFailure error={error} />
        </StorefrontErrorBoundary>,
    );
});

// CWV uses buffered performance entries, so diagnostics never join the critical rendering path.
document.addEventListener(
    'storefront:app-owned',
    () => {
        void import('./performance-entry').catch(() => undefined);
    },
    { once: true },
);

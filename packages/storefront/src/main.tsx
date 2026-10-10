// organize-imports-ignore -- CSS side effects require the explicit cascade order below.
import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import { StrictMode } from 'react';
import { createRoot, hydrateRoot } from 'react-dom/client';

import {
    persistPublicQueryCache,
    restorePublicQueryCache,
    storefrontQueryClient,
    watchPublicQueryCache,
} from './query-client';
import { router } from './router';
import { restoreStorefrontIcons } from './storefront-icons';
import { readInitialPublicPage, seedPublicPage, type PublicPageData } from './storefront-page-data';
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
        const initialPage = readInitialPublicPage();
        initialPublicPage = initialPage;
        if (initialPage) seedPublicPage(storefrontQueryClient, initialPage);
        restorePublicQueryCache(storefrontQueryClient);
        watchPublicQueryCache(storefrontQueryClient);
        window.addEventListener('pagehide', () => {
            try {
                persistPublicQueryCache(storefrontQueryClient);
            } catch {
                // Browsing remains available when session storage is full or disabled.
            }
        });
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
    if (!embeddedPreview && initialPublicPage && appRootElement.dataset.publicRendered === '1') {
        const { createPublicSnapshotApp } = await import('./public-snapshot');
        const initialTree = await createPublicSnapshotApp(initialPublicPage, () =>
            root.render(interactiveApp),
        );
        const root = hydrateRoot(appRootElement, initialTree);
    } else {
        createRoot(appRootElement).render(interactiveApp);
    }
}

void mountStorefront();

// CWV uses buffered performance entries, so diagnostics never join the critical rendering path.
window.addEventListener(
    'load',
    () => {
        void import('./storefront-performance')
            .then(module => module.observeStorefrontPerformance())
            .catch(() => undefined);
    },
    { once: true },
);

// organize-imports-ignore -- CSS side effects require the explicit cascade order below.
import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import {
    persistPublicQueryCache,
    restorePublicQueryCache,
    storefrontQueryClient,
    watchPublicQueryCache,
} from './query-client';
import { router } from './router';
import { restoreStorefrontIcons } from './storefront-icons';
import { readInitialPublicPage, seedPublicPage } from './storefront-page-data';
import { StorefrontErrorBoundary } from './StorefrontErrorBoundary';
import './storefront-styles';

const rootElement = document.getElementById('root');

if (!rootElement) {
    throw new Error('Storefront root element was not found');
}
const appRootElement = rootElement;

restoreStorefrontIcons();
try {
    restorePublicQueryCache(storefrontQueryClient);
    const initialPage = readInitialPublicPage();
    if (initialPage) seedPublicPage(storefrontQueryClient, initialPage);
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

async function mountStorefront() {
    const parameters = new URLSearchParams(window.location.search);
    if (parameters.get('storefrontPreviewEmbedded') === '1') {
        const { installStorefrontPreviewRuntime } = await import('./storefront-preview-runtime');
        installStorefrontPreviewRuntime();
    }

    createRoot(appRootElement).render(
        <StrictMode>
            <QueryClientProvider client={storefrontQueryClient}>
                <StorefrontErrorBoundary>
                    <RouterProvider router={router} />
                </StorefrontErrorBoundary>
            </QueryClientProvider>
        </StrictMode>,
    );
}

void mountStorefront();

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
import { StorefrontErrorBoundary } from './StorefrontErrorBoundary';
/* eslint-disable import/order -- Load desktop composition after the base layout and selected visual preset. */
import './styles.css';
import './styles/desktop-layout.css';
import './styles/visual-presets.css';
import './styles/desktop-commerce.css';
import './styles/desktop-home.css';
import './styles/desktop-pages.css';
import './styles/storefront-design-preview.css';
/* eslint-enable import/order */

const rootElement = document.getElementById('root');

if (!rootElement) {
    throw new Error('Storefront root element was not found');
}

try {
    // Restore the cached brand within the CSP-approved module entry, without a
    // separate parser-blocking script or an inline-script CSP exception.
    const cachedLogoUrl = sessionStorage.getItem('__storefront_logo_url__');
    if (cachedLogoUrl) {
        for (const icon of document.querySelectorAll<HTMLLinkElement>(
            'link[rel="icon"], link[rel="apple-touch-icon"]',
        )) {
            icon.href = cachedLogoUrl;
        }
    }
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

createRoot(rootElement).render(
    <StrictMode>
        <QueryClientProvider client={storefrontQueryClient}>
            <StorefrontErrorBoundary>
                <RouterProvider router={router} />
            </StorefrontErrorBoundary>
        </QueryClientProvider>
    </StrictMode>,
);

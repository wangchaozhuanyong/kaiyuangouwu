// organize-imports-ignore -- CSS side effects require the explicit cascade order below.
import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { restorePublicQueryCache, storefrontQueryClient, watchPublicQueryCache } from './query-client';
import { router } from './router';
import { StorefrontErrorBoundary } from './StorefrontErrorBoundary';
/* eslint-disable import/order -- Load desktop composition after the base layout and selected visual preset. */
import './styles.css';
import './styles/desktop-layout.css';
import './styles/visual-presets.css';
import './styles/desktop-commerce.css';
import './styles/desktop-pages.css';
/* eslint-enable import/order */

const rootElement = document.getElementById('root');

if (!rootElement) {
    throw new Error('Storefront root element was not found');
}

try {
    restorePublicQueryCache(storefrontQueryClient);
    watchPublicQueryCache(storefrontQueryClient);
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

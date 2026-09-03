import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { restorePublicQueryCache, storefrontQueryClient, watchPublicQueryCache } from './query-client';
import { router } from './router';
import { StorefrontErrorBoundary } from './StorefrontErrorBoundary';
import './styles.css';
import './styles/desktop-layout.css';

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

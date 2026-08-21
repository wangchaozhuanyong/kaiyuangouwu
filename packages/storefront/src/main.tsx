import { QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './App';
import { restorePublicQueryCache, storefrontQueryClient, watchPublicQueryCache } from './query-client';
import { StorefrontErrorBoundary } from './StorefrontErrorBoundary';
import './styles.css';

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
                <App />
            </StorefrontErrorBoundary>
        </QueryClientProvider>
    </StrictMode>,
);

import { lazyRouteComponent } from '@tanstack/react-router';
import { Suspense } from 'react';

import { useStorefrontAppState } from './hooks/useStorefrontAppState';
import { languageCodeFor } from './i18n';
import { storefrontQueryKeys } from './query-client';
import { PageSkeleton } from './route-loading';
import { StorefrontShell } from './StorefrontShell';

export { HomeDualCategoryShowcase } from './storefront-ui/content-ui';

const StorefrontQueryFeedback = lazyRouteComponent(
    () => import('./StorefrontQueryFeedback'),
    'StorefrontQueryFeedback',
);
const StorefrontDesignPreview = lazyRouteComponent(
    () => import('./storefront-design-preview'),
    'StorefrontDesignPreview',
);

export function App() {
    if (window.location.pathname === '/__storefront-preview')
        return (
            <Suspense fallback={<PageSkeleton />}>
                <StorefrontDesignPreview />
            </Suspense>
        );
    return <StorefrontRuntime />;
}

function StorefrontRuntime() {
    const state = useStorefrontAppState();
    return (
        <>
            <StorefrontShell state={state} />
            <Suspense fallback={null}>
                <StorefrontQueryFeedback
                    language={state.language}
                    scope={{
                        marketCode: storefrontQueryKeys.market(state.storefrontContextValue.market),
                        languageCode: languageCodeFor(state.language),
                        includePrivate: true,
                    }}
                />
            </Suspense>
        </>
    );
}

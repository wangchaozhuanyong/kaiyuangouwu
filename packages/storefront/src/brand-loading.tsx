import { lazy, Suspense } from 'react';

export interface BrandLoadingProps {
    language?: string;
    logoUrl?: string | null;
    storefrontName?: string;
    compact?: boolean;
    local?: boolean;
    label?: string;
}

function LoadingDots() {
    return (
        <span className="brand-loading-dots" aria-hidden="true">
            <i />
            <i />
            <i />
        </span>
    );
}

// Fetch the small visual chunk alongside bootstrap, never block the shell or business queries.
// A stale/offline chunk must leave a usable pending state, not fail the destination route.
const visualModule = import('./brand-loading-content').catch(() => ({ default: LoadingDots }));
const LoadingContent = lazy(() => visualModule);

export function BrandLoadingIndicator(props: BrandLoadingProps) {
    return (
        <Suspense fallback={<LoadingDots />}>
            <LoadingContent {...props} />
        </Suspense>
    );
}

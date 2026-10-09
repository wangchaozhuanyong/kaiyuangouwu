import { lazy, Suspense } from 'react';

export interface BrandLoadingProps {
    language?: string;
    logoUrl?: string | null;
    storefrontName?: string;
    compact?: boolean;
    local?: boolean;
    label?: string;
    pending?: boolean;
}

function LoadingFallback({ pending = true, compact, local, label, language = 'zh' }: BrandLoadingProps) {
    if (!pending) return null;
    if (compact || local)
        return (
            <span className="brand-loading-dots" aria-hidden="true">
                <i />
                <i />
                <i />
            </span>
        );
    return (
        <span className="brand-loading" aria-hidden="true">
            <span className="brand-loading-caption">
                <span>{label ?? (language.startsWith('zh') ? '正在连接' : 'Connecting')}</span>
                <span className="brand-loading-bar">
                    <i />
                </span>
            </span>
        </span>
    );
}

// Fetch the small visual chunk alongside bootstrap, never block the shell or business queries.
// A stale/offline chunk must leave a usable pending state, not fail the destination route.
const visualModule = import('./brand-loading-content').catch(() => ({ default: LoadingFallback }));
const LoadingContent = lazy(() => visualModule);

export function BrandLoadingIndicator(props: BrandLoadingProps) {
    return (
        <Suspense fallback={<LoadingFallback {...props} />}>
            <LoadingContent {...props} />
        </Suspense>
    );
}

import { lazy } from 'react';

import { useRouteRuntime as useRuntime } from './shared';

const ManagedLegalPage = lazy(() =>
    import('../pages/legal-page').then(module => ({ default: module.ManagedLegalPage })),
);

export function LegalRoutePage() {
    const runtime = useRuntime();
    return (
        <ManagedLegalPage
            kind={runtime.route.id === 'terms' ? 'terms' : 'privacy'}
            language={runtime.language}
            storefrontName={runtime.storefrontName}
            contentBlocks={runtime.contentBlocks}
            onBack={runtime.goBack}
        />
    );
}

import { lazyRouteComponent } from '@tanstack/react-router';

import { registerRoutePreload, useRouteRuntime as useRuntime } from './shared';

const ManagedLegalPage = lazyRouteComponent(() => import('../pages/legal-page'), 'ManagedLegalPage');

export function LegalRoutePage() {
    const runtime = useRuntime();
    return (
        <ManagedLegalPage
            kind={runtime.route.id === 'terms' ? 'terms' : 'privacy'}
            language={runtime.language}
            storefrontName={runtime.storefrontName}
            contentBlocks={runtime.contentBlocks}
            legalIdentity={runtime.legalIdentity}
            onBack={runtime.goBack}
        />
    );
}

export const preloadLegalRoutePage = registerRoutePreload(LegalRoutePage, ManagedLegalPage);

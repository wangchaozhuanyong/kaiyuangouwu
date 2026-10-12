import { lazyRouteComponent } from '@tanstack/react-router';

import { usePageRouteCommit } from '../page-readiness';

import { registerRoutePreload, useRouteRuntime as useRuntime } from './shared';

const ManagedLegalPage = lazyRouteComponent(() => import('../pages/legal-page'), 'ManagedLegalPage');

export function LegalRoutePage() {
    usePageRouteCommit();
    const runtime = useRuntime();
    return (
        <ManagedLegalPage
            kind={runtime.route.id === 'terms' ? 'terms' : 'privacy'}
            language={runtime.language}
            storefrontName={runtime.storefrontName}
            contentBlocks={runtime.contentBlocks}
            legalIdentity={runtime.legalIdentity}
            onBack={runtime.goBack}
            onSelectDocument={kind => runtime.navigate({ name: 'legal', id: kind }, true)}
        />
    );
}

export const preloadLegalRoutePage = registerRoutePreload(LegalRoutePage, ManagedLegalPage);

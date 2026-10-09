import { lazyRouteComponent } from '@tanstack/react-router';

import '../commerce-styles';

import { registerRoutePreload, useRouteRuntime } from './shared';

const AnnouncementsPage = lazyRouteComponent(
    () => import('../pages/announcements-page'),
    'AnnouncementsPage',
);

export function AnnouncementsRoutePage() {
    const runtime = useRouteRuntime();
    return (
        <AnnouncementsPage
            api={runtime.api}
            market={runtime.market}
            language={runtime.language}
            locale={runtime.locale}
            route={runtime.route}
            onBack={runtime.goBack}
            onReturnToRoute={runtime.returnToRoute}
            onNavigate={runtime.navigate}
            onContentTarget={runtime.openContentTarget}
        />
    );
}

export const preloadAnnouncementsRoutePage = registerRoutePreload(AnnouncementsRoutePage, AnnouncementsPage);

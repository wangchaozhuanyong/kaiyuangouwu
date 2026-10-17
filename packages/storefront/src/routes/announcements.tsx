import { createFileRoute } from '@tanstack/react-router';

import { AnnouncementsRoutePage } from '../route-pages/announcements-route-page';
import { storefrontRouteCodeLoader } from '../storefront-page-data';

export const Route = createFileRoute('/announcements')({
    loader: storefrontRouteCodeLoader,
    component: AnnouncementsRoutePage,
});

import { createFileRoute } from '@tanstack/react-router';

import { EnvironmentMonitorRoutePage } from '../route-pages/environment-monitor-route-page';
import { storefrontRouteCodeLoader } from '../storefront-page-data';

export const Route = createFileRoute('/environment-monitor')({
    loader: storefrontRouteCodeLoader,
    component: EnvironmentMonitorRoutePage,
});

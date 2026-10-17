import { createRootRoute, lazyRouteComponent } from '@tanstack/react-router';

import { App } from '../App';

export const Route = createRootRoute({
    component: App,
    notFoundComponent: lazyRouteComponent(() => import('../not-found-route-page'), 'NotFoundRoutePage'),
});

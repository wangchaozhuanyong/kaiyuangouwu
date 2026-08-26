import { createRootRoute } from '@tanstack/react-router';

import { App } from '../App';
import { NotFoundRoutePage } from '../not-found-route-page';

export const Route = createRootRoute({
    component: App,
    notFoundComponent: NotFoundRoutePage,
});

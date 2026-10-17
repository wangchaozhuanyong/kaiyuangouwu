import { createFileRoute } from '@tanstack/react-router';

import { ImageStudioRoutePage } from '../route-pages/content-route-pages';
import { storefrontRouteCodeLoader } from '../storefront-page-data';

export const Route = createFileRoute('/image-studio')({
    loader: storefrontRouteCodeLoader,
    component: ImageStudioRoutePage,
});

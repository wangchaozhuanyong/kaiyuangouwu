import { createFileRoute } from '@tanstack/react-router';

import { GuidePage } from '../pages/guide-page';
import { storefrontQueryClient } from '../query-client';
import { prefetchPublicPage } from '../storefront-page-data';
import { normalizeRouteSearch } from '../storefront-router';

export const Route = createFileRoute('/guides/$slug')({
    validateSearch: normalizeRouteSearch,
    loader: ({ location, abortController }) =>
        // This only warms data. The mounted page's Query owns success, empty and error UI.
        prefetchPublicPage(storefrontQueryClient, location.publicHref, abortController.signal).catch(
            () => undefined,
        ),
    component: GuideRoute,
});
function GuideRoute() {
    return <GuidePage slug={Route.useParams().slug} />;
}

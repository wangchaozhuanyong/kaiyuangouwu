import { createFileRoute } from '@tanstack/react-router';

import { GuidePage } from '../pages/guide-page';
import { storefrontQueryClient } from '../query-client';
import { prefetchPublicPage } from '../storefront-page-data';
import { normalizeRouteSearch } from '../storefront-router';

export const Route = createFileRoute('/guides/$slug')({
    validateSearch: normalizeRouteSearch,
    loader: ({ location }) =>
        prefetchPublicPage(storefrontQueryClient, location.publicHref).catch(() => undefined),
    component: GuideRoute,
});
function GuideRoute() {
    return <GuidePage slug={Route.useParams().slug} />;
}

import { createFileRoute } from '@tanstack/react-router';

import { GuidePage } from '../pages/guide-page';
import { publicPageRouteLoader } from '../storefront-page-data';
import { normalizeRouteSearch } from '../storefront-router';

export const Route = createFileRoute('/guides/$slug')({
    validateSearch: normalizeRouteSearch,
    loader: publicPageRouteLoader,
    component: GuideRoute,
});
function GuideRoute() {
    return <GuidePage slug={Route.useParams().slug} />;
}

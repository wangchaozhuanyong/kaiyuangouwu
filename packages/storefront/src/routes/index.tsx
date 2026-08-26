import { createFileRoute } from '@tanstack/react-router';

import { HomeRoutePage } from '../route-pages/catalog-route-pages';

export const Route = createFileRoute('/')({
    component: HomeRoutePage,
});

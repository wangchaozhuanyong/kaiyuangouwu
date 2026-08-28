import { createFileRoute } from '@tanstack/react-router';

import { ServicesRoutePage } from '../route-pages/content-route-pages';

export const Route = createFileRoute('/services')({ component: ServicesRoutePage });

import { createFileRoute } from '@tanstack/react-router';

import { NotFoundRoutePage } from '../not-found-route-page';

export const Route = createFileRoute('/not-found')({ component: NotFoundRoutePage });

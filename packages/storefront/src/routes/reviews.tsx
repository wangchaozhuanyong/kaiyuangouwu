import { createFileRoute } from '@tanstack/react-router';

import { ReviewsRoutePage } from '../route-pages/content-route-pages';

export const Route = createFileRoute('/reviews')({ component: ReviewsRoutePage });

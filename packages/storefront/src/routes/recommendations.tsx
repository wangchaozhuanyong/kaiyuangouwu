import { createFileRoute } from '@tanstack/react-router';

import { RecommendationsRoutePage } from '../route-pages/content-route-pages';

export const Route = createFileRoute('/recommendations')({ component: RecommendationsRoutePage });

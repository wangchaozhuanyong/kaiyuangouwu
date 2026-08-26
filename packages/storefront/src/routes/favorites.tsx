import { createFileRoute } from '@tanstack/react-router';

import { FavoritesRoutePage } from '../route-pages/account-route-pages';

export const Route = createFileRoute('/favorites')({ component: FavoritesRoutePage });

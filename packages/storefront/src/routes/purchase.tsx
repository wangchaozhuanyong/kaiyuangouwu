import { createFileRoute } from '@tanstack/react-router';

import { PurchaseRoutePage } from '../route-pages/checkout-route-pages';

export const Route = createFileRoute('/purchase')({ component: PurchaseRoutePage });

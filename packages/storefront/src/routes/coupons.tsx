import { createFileRoute } from '@tanstack/react-router';

import { CouponsRoutePage } from '../route-pages/account-route-pages';

export const Route = createFileRoute('/coupons')({ component: CouponsRoutePage });

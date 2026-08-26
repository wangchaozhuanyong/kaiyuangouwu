import { createFileRoute } from '@tanstack/react-router';

import { PaymentRoutePage } from '../route-pages/checkout-route-pages';

export const Route = createFileRoute('/payment')({ component: PaymentRoutePage });

import { createFileRoute } from '@tanstack/react-router';

import { CheckoutPageRoute } from '../route-pages/checkout-route-pages';

export const Route = createFileRoute('/checkout')({ component: CheckoutPageRoute });

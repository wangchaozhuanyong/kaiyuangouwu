import { createFileRoute } from '@tanstack/react-router';

import { CartRoutePage } from '../route-pages/cart-route-page';

export const Route = createFileRoute('/cart')({ component: CartRoutePage });

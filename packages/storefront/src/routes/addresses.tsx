import { createFileRoute } from '@tanstack/react-router';

import { AddressesRoutePage } from '../route-pages/order-route-pages';

export const Route = createFileRoute('/addresses')({ component: AddressesRoutePage });

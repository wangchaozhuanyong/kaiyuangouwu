import { createFileRoute } from '@tanstack/react-router';

import { LogisticsRoutePage } from '../route-pages/order-route-pages';

export const Route = createFileRoute('/logistics')({ component: LogisticsRoutePage });

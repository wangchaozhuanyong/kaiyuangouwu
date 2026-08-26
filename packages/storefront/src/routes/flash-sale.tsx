import { createFileRoute } from '@tanstack/react-router';

import { FlashSaleRoutePage } from '../route-pages/content-route-pages';

export const Route = createFileRoute('/flash-sale')({ component: FlashSaleRoutePage });

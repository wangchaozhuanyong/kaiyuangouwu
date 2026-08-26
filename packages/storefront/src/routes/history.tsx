import { createFileRoute } from '@tanstack/react-router';

import { HistoryRoutePage } from '../route-pages/account-route-pages';

export const Route = createFileRoute('/history')({ component: HistoryRoutePage });

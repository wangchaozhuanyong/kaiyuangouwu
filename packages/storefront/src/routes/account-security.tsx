import { createFileRoute } from '@tanstack/react-router';

import { AccountSecurityRoutePage } from '../route-pages/order-route-pages';

export const Route = createFileRoute('/account-security')({ component: AccountSecurityRoutePage });

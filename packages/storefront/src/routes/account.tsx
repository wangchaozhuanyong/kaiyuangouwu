import { createFileRoute } from '@tanstack/react-router';

import { AccountRoutePage } from '../route-pages/account-route-pages';

export const Route = createFileRoute('/account')({ component: AccountRoutePage });

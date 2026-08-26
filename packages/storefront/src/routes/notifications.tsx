import { createFileRoute } from '@tanstack/react-router';

import { NotificationsRoutePage } from '../route-pages/account-route-pages';

export const Route = createFileRoute('/notifications')({ component: NotificationsRoutePage });

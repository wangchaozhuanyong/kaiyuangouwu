import { createFileRoute } from '@tanstack/react-router';

import { AnnouncementsRoutePage } from '../route-pages/account-route-pages';

export const Route = createFileRoute('/announcements')({ component: AnnouncementsRoutePage });

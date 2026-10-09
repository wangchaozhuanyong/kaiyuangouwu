import { createFileRoute } from '@tanstack/react-router';

import { AnnouncementsRoutePage } from '../route-pages/announcements-route-page';

export const Route = createFileRoute('/announcements')({ component: AnnouncementsRoutePage });

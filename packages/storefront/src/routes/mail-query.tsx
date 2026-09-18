import { createFileRoute } from '@tanstack/react-router';

import { MailQueryRoutePage } from '../route-pages/content-route-pages';

export const Route = createFileRoute('/mail-query')({ component: MailQueryRoutePage });

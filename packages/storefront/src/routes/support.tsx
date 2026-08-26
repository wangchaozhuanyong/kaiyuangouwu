import { createFileRoute } from '@tanstack/react-router';

import { SupportRoutePage } from '../route-pages/content-route-pages';

export const Route = createFileRoute('/support')({ component: SupportRoutePage });

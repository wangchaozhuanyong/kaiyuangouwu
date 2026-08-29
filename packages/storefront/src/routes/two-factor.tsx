import { createFileRoute } from '@tanstack/react-router';

import { TwoFactorRoutePage } from '../route-pages/content-route-pages';

export const Route = createFileRoute('/two-factor')({ component: TwoFactorRoutePage });

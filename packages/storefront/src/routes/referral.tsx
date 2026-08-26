import { createFileRoute } from '@tanstack/react-router';

import { ReferralRoutePage } from '../route-pages/account-route-pages';

export const Route = createFileRoute('/referral')({ component: ReferralRoutePage });

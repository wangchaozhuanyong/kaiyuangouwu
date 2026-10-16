import { createFileRoute } from '@tanstack/react-router';

import { GptRechargeRoutePage } from '../route-pages/gpt-recharge-route-page';

export const Route = createFileRoute('/gpt-recharge')({ component: GptRechargeRoutePage });

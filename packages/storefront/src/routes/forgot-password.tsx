import { createFileRoute } from '@tanstack/react-router';

import { ForgotPasswordRoutePage } from '../route-pages/auth-route-pages';

export const Route = createFileRoute('/forgot-password')({ component: ForgotPasswordRoutePage });

import { createFileRoute } from '@tanstack/react-router';

import { LoginRoutePage } from '../route-pages/auth-route-pages';

export const Route = createFileRoute('/login')({ component: LoginRoutePage });

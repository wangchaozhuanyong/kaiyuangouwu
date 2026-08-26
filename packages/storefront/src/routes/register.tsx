import { createFileRoute } from '@tanstack/react-router';

import { RegisterRoutePage } from '../route-pages/auth-route-pages';

export const Route = createFileRoute('/register')({ component: RegisterRoutePage });

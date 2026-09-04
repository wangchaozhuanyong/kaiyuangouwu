import { ADMIN_API_PATH } from '@vendure/common/lib/shared-constants';
import { json } from 'express';

export const catalogAdminApiMiddleware = [
    {
        handler: json({ limit: '1mb' }),
        route: `/${ADMIN_API_PATH}`,
        beforeListen: true,
    },
];

import { Injectable, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';

import { StorefrontPromotionAccessService } from './storefront-promotion-access.service';

@Injectable()
export class StorefrontEntryMiddleware implements NestMiddleware {
    constructor(private readonly accessService: StorefrontPromotionAccessService) {}

    async use(req: Request, res: Response, next: NextFunction): Promise<void> {
        if (!this.accessService.enabled || req.method === 'OPTIONS') {
            next();
            return;
        }
        const request = await this.accessService.resolveRequest(req);
        if (request && this.accessService.hasValidEntryCookie(req, request)) {
            next();
            return;
        }
        res.setHeader('Cache-Control', 'no-store');
        res.status(403).json({
            errors: [
                {
                    message: '请先从推广页进入主网站',
                    extensions: { code: 'STOREFRONT_ENTRY_REQUIRED' },
                },
            ],
        });
    }
}

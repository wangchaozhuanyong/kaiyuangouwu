import { Controller, Get, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';

import { StorefrontPromotionAccessService } from './promotion/storefront-promotion-access.service';
import { StorefrontLcpPreloadService } from './storefront-lcp-preload.service';

@Controller('storefront')
export class StorefrontLcpPreloadController {
    constructor(
        private readonly accessService: StorefrontPromotionAccessService,
        private readonly preloadService: StorefrontLcpPreloadService,
    ) {}

    @Get('lcp-preload')
    async preload(@Req() req: Request, @Res() res: Response): Promise<void> {
        res.setHeader('Cache-Control', 'private, no-store, max-age=0');
        res.setHeader('X-Content-Type-Options', 'nosniff');
        const request = await this.accessService.resolveRequest(req);
        if (!request) {
            res.status(204).send();
            return;
        }
        const link = await this.preloadService.render(request.ctx);
        if (!link) {
            res.status(204).send();
            return;
        }
        res.status(200).type('text/html').send(link);
    }
}

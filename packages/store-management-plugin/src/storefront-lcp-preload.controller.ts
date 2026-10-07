import { Controller, Get, Req, Res } from '@nestjs/common';
import { ForbiddenError } from '@vendure/core';
import { publicPageRequestFromUrl, type PublicPageRequest } from '@vendure/storefront-content-plugin';
import type { Request, Response } from 'express';

import { StorefrontPromotionAccessService } from './promotion/storefront-promotion-access.service';
import { StorefrontClosedError } from './storefront-activation.service';
import { StorefrontLcpPreloadService } from './storefront-lcp-preload.service';
import { publicPagePreferences, trustedPublicPageHeaders } from './storefront-public-request';

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
        try {
            await this.readPreload(req, res);
        } catch (error) {
            if (!(error instanceof StorefrontClosedError) && !(error instanceof ForbiddenError)) throw error;
            res.status(403).json({ errorCode: 'STOREFRONT_CLOSED', message: 'Storefront is closed' });
        }
    }

    private async readPreload(req: Request, res: Response): Promise<void> {
        const request = await this.accessService.resolveRequest(req);
        if (!request) {
            res.status(204).send();
            return;
        }
        let route: PublicPageRequest = { kind: 'home' };
        let layout: { primaryCollectionId: string } | undefined;
        let ctx = request.ctx;
        const original = req.headers?.['x-storefront-original-uri'];
        if (original != null) {
            if (!trustedPublicPageHeaders(req) || typeof original !== 'string') {
                res.status(204).send();
                return;
            }
            try {
                const parsed = publicPageRequestFromUrl(original);
                if (!parsed) {
                    res.status(204).send();
                    return;
                }
                route = parsed;
                if (parsed.kind === 'catalog' && parsed.path === '/category') {
                    // Child selection belongs to the data key; the original parent controls the mobile sidebar.
                    const query = new URL(original, 'https://storefront.invalid').searchParams;
                    layout = {
                        primaryCollectionId: query.get('collectionId') || query.get('collection') || 'all',
                    };
                }
                ctx = ctx.copy(
                    publicPagePreferences(
                        ctx,
                        req.headers['x-storefront-language'],
                        req.headers['x-storefront-currency'],
                    ),
                );
            } catch {
                res.status(204).send();
                return;
            }
        }
        const link = layout
            ? await this.preloadService.render(ctx, request.host, route, layout)
            : await this.preloadService.render(ctx, request.host, route);
        if (!link) {
            res.status(204).send();
            return;
        }
        res.status(200).type('text/html').send(link);
    }
}

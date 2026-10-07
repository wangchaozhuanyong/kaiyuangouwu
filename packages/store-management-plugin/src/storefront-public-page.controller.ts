import { Controller, Get, Optional, Post, Req, Res } from '@nestjs/common';
import { ForbiddenError, Logger, RequestContextService } from '@vendure/core';
import { canonicalPublicPageRequest, type PublicPageRequest } from '@vendure/storefront-content-plugin';
import type { Request, Response } from 'express';

import { StorefrontPromotionAccessService } from './promotion/storefront-promotion-access.service';
import { StorefrontClosedError } from './storefront-activation.service';
import { parsePublicPerformanceBatch, publicPerformanceRegion } from './storefront-performance';
import { StorefrontPublicPageWarmService } from './storefront-public-page-warm.service';
import { StorefrontPublicPageService } from './storefront-public-page.service';
import { publicPagePreferences } from './storefront-public-request';

export function parsePublicPageRequest(query: Request['query']): PublicPageRequest {
    if (query.kind == null || query.kind === 'home') return canonicalPublicPageRequest({ kind: 'home' });
    if (query.kind === 'product' && typeof query.id === 'string')
        return canonicalPublicPageRequest({ kind: 'product', id: query.id });
    if (query.kind !== 'catalog' || typeof query.input !== 'string' || query.input.length > 2000)
        throw new Error('Invalid public page');
    return canonicalPublicPageRequest({
        kind: 'catalog',
        input: JSON.parse(query.input),
        path: query.path as '/category' | '/search' | undefined,
    });
}

@Controller('storefront')
export class StorefrontPublicPageController {
    constructor(
        private readonly access: StorefrontPromotionAccessService,
        private readonly contexts: RequestContextService,
        private readonly pages: StorefrontPublicPageService,
        @Optional() private readonly warmer?: StorefrontPublicPageWarmService,
    ) {}

    @Post('performance')
    async performance(@Req() req: Request, @Res() res: Response): Promise<void> {
        res.setHeader('Cache-Control', 'private, no-store');
        res.setHeader('X-Content-Type-Options', 'nosniff');
        let batch: ReturnType<typeof parsePublicPerformanceBatch>;
        try {
            batch = parsePublicPerformanceBatch(req.body);
        } catch {
            res.status(400).end();
            return;
        }
        const verified = await this.access.resolveRequest(req);
        if (!verified) {
            res.status(404).end();
            return;
        }
        Logger.info(
            JSON.stringify({
                event: 'storefront-performance',
                store: verified.ctx.channel.code,
                region: publicPerformanceRegion(req),
                ...batch,
            }),
            'StorefrontPerformance',
        );
        res.status(204).end();
    }

    @Get('page-data')
    async read(@Req() req: Request, @Res() res: Response): Promise<void> {
        // Public snapshots contain no cookie/session data, but are host-scoped and not a CDN HTML cache.
        res.setHeader('Cache-Control', 'private, no-store');
        res.setHeader('X-Content-Type-Options', 'nosniff');
        try {
            await this.readPage(req, res);
        } catch (error) {
            if (!(error instanceof StorefrontClosedError) && !(error instanceof ForbiddenError)) throw error;
            res.status(403).json({ errorCode: 'STOREFRONT_CLOSED', message: 'Storefront is closed' });
        }
    }

    private async readPage(req: Request, res: Response): Promise<void> {
        const verified = await this.access.resolveRequest(req);
        if (!verified) {
            res.status(404).end();
            return;
        }
        const language = req.query.languageCode;
        const currency = req.query.currencyCode;
        let request: PublicPageRequest;
        let preferences: ReturnType<typeof publicPagePreferences>;
        try {
            preferences = publicPagePreferences(verified.ctx, language, currency);
            request = parsePublicPageRequest(req.query);
        } catch {
            res.status(400).json({ error: 'Invalid public page request' });
            return;
        }
        const ctx = await this.contexts.create({
            // Pass only verified routing headers to asset URL generation; never credentials or account state.
            req: {
                headers: { host: verified.host, 'x-forwarded-host': verified.host },
                protocol: req.protocol,
                get: (name: string) => (name.toLowerCase() === 'host' ? verified.host : undefined),
            } as unknown as Request,
            apiType: 'shop',
            channelOrToken: verified.ctx.channel,
            ...preferences,
        });
        const start = performance.now();
        const page = await this.pages.read(ctx, verified.host, request);
        void this.warmer?.observe(ctx, verified.host, request).catch(() => undefined);
        res.setHeader('Server-Timing', `public-page;dur=${(performance.now() - start).toFixed(1)}`);
        res.status(200).json(page);
    }
}

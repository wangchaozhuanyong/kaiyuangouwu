import { Body, Controller, Post, Req, Res } from '@nestjs/common';
import { RequestContextService } from '@vendure/core';
import type { Request, Response } from 'express';

import { IcloudUnifiedQueryService } from '../services/icloud-unified-query.service';

/** Public code lookup only; shares the existing local/managed query-code checks. */
@Controller('standalone-mail')
export class IcloudStandaloneQueryController {
    constructor(
        private readonly context: RequestContextService,
        private readonly queries: IcloudUnifiedQueryService,
    ) {}

    @Post('query')
    async query(@Body() body: unknown, @Req() req: Request, @Res() res: Response) {
        res.setHeader('Cache-Control', 'private, no-store, no-transform');
        const code = (body as { queryCode?: unknown } | null)?.queryCode;
        const ip = req.ip || req.socket?.remoteAddress;
        if (!ip || typeof code !== 'string' || !code.trim() || code.length > 128) {
            res.status(400).json({ error: 'invalid_request' });
            return;
        }
        try {
            // This public tool never imports a storefront customer session or channel override.
            const ctx = await this.context.create({ apiType: 'shop' });
            const result = await this.queries.queryByCode(ctx, code, ip, req.get('user-agent') || '');
            res.status(200).json(result);
        } catch {
            res.status(503).json({ error: 'mail_query_unavailable' });
        }
    }
}

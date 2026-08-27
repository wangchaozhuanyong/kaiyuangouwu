import { Body, Controller, Get, Post, Query, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';

import { isAccountEntryRoute } from './account-entry-proof';
import { promotionEntryRedirect } from './promotion-entry-destination';
import { PROMOTION_VISUAL_SCRIPT_SHA256 } from './promotion-visual-script';
import { StorefrontPromotionAccessService } from './storefront-promotion-access.service';
import { StorefrontPromotionService } from './storefront-promotion.service';

@Controller('promo')
export class StorefrontPromotionController {
    constructor(
        private readonly accessService: StorefrontPromotionAccessService,
        private readonly promotionService: StorefrontPromotionService,
    ) {}

    @Get()
    async promotion(@Req() req: Request, @Res() res: Response): Promise<void> {
        const request = await this.accessService.resolveRequest(req);
        if (!request) {
            res.status(404).type('text/plain').send('未找到该店铺推广页');
            return;
        }
        const ticket = this.accessService.createEntryTicket(request);
        const html = await this.promotionService.renderPublished(request.ctx, ticket);
        this.setPromotionHeaders(res);
        res.status(200).type('html').send(html);
    }

    @Post('enter')
    async enter(
        @Req() req: Request,
        @Res() res: Response,
        @Body('ticket') ticket?: string,
        @Body('destination') destination?: string,
    ): Promise<void> {
        const request = await this.accessService.resolveRequest(req);
        if (!request || !ticket || !this.accessService.validateEntryTicket(ticket, request)) {
            res.status(403).type('text/plain').send('入口已失效，请返回推广页重试');
            return;
        }
        res.setHeader('Set-Cookie', this.accessService.createEntryCookie(request));
        res.setHeader('Cache-Control', 'no-store');
        res.redirect(303, promotionEntryRedirect(destination));
    }

    @Get('access')
    async access(@Req() req: Request, @Res() res: Response): Promise<void> {
        if (!this.accessService.enabled) {
            res.status(204).send();
            return;
        }
        const request = await this.accessService.resolveRequest(req);
        if (request && this.accessService.hasValidEntryCookie(req, request)) {
            res.status(204).send();
            return;
        }
        res.setHeader('Cache-Control', 'no-store');
        res.status(401).send();
    }

    @Get('account-entry')
    async accountEntry(
        @Req() req: Request,
        @Res() res: Response,
        @Query('route') route?: string,
        @Query('token') token?: string,
        @Query('proof') proof?: string,
    ): Promise<void> {
        const request = await this.accessService.resolveRequest(req);
        if (
            !request ||
            !route ||
            !isAccountEntryRoute(route) ||
            !token ||
            token.length < 16 ||
            !proof ||
            !this.accessService.validateAccountEntryProof(proof, route, token, request)
        ) {
            res.status(400).type('text/plain').send('账号操作链接无效');
            return;
        }
        res.setHeader('Set-Cookie', this.accessService.createEntryCookie(request));
        res.setHeader('Cache-Control', 'no-store');
        const params = new URLSearchParams({ token });
        res.redirect(303, `/#/${route}?${params.toString()}`);
    }

    @Get('robots')
    async robots(@Req() req: Request, @Res() res: Response): Promise<void> {
        const request = await this.accessService.resolveRequest(req);
        if (!request) {
            res.status(404).type('text/plain').send('Storefront not found');
            return;
        }
        res.setHeader('Cache-Control', 'public, max-age=300');
        res.type('text/plain').send(
            `User-agent: *\nAllow: /promo$\nDisallow: /promo/\nDisallow: /\nSitemap: https://${request.host}/sitemap.xml\n`,
        );
    }

    @Get('sitemap')
    async sitemap(@Req() req: Request, @Res() res: Response): Promise<void> {
        const request = await this.accessService.resolveRequest(req);
        if (!request) {
            res.status(404).type('text/plain').send('Storefront not found');
            return;
        }
        res.setHeader('Cache-Control', 'public, max-age=300');
        res.type('application/xml').send(
            `<?xml version="1.0" encoding="UTF-8"?>\n` +
                `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
                `  <url><loc>https://${request.host}/promo</loc><changefreq>daily</changefreq><priority>1.0</priority></url>\n` +
                `</urlset>\n`,
        );
    }

    private setPromotionHeaders(res: Response): void {
        res.setHeader('Cache-Control', 'no-store');
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
        res.setHeader('X-Frame-Options', 'DENY');
        res.setHeader(
            'Content-Security-Policy',
            [
                "default-src 'self'",
                "base-uri 'self'",
                "object-src 'none'",
                "frame-ancestors 'none'",
                "form-action 'self'",
                "img-src 'self' data: https: http:",
                "media-src 'self' https: http:",
                "font-src 'self' data: https:",
                "style-src 'self' 'unsafe-inline' https:",
                "script-src 'none'",
                `script-src-elem 'sha256-${PROMOTION_VISUAL_SCRIPT_SHA256}' https://static.cloudflareinsights.com`,
                'connect-src https://cloudflareinsights.com',
            ].join('; '),
        );
    }
}

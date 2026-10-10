import {
    Body,
    Controller,
    Get,
    Optional,
    Post,
    Query,
    Req,
    Res,
    ServiceUnavailableException,
    UseFilters,
} from '@nestjs/common';
import {
    ConfigService,
    extractSessionToken,
    LanguageCode,
    RequestContext,
    SessionService,
    TransactionalConnection,
} from '@vendure/core';
import type { Request, Response } from 'express';

import { StoreProfile } from '../entities/store-profile.entity';
import { resolvePromotionSeo } from '../seo/storefront-promotion-seo';
import { StorefrontPublicSeoService } from '../seo/storefront-public-seo.service';
import { publicRobots, sitemapXml } from '../seo/storefront-seo-output';
import { type StorefrontSeoDocument, type StorefrontSeoPublicSettings } from '../seo/storefront-seo.contract';
import { StorefrontSeoService } from '../seo/storefront-seo.service';
import { StorefrontActivationService, StorefrontClosedError } from '../storefront-activation.service';
import { StorefrontClosedHttpFilter } from '../storefront-closed-http.filter';
import { trustedPublicPageHeaders } from '../storefront-public-request';

import { isAccountEntryRoute } from './account-entry-proof';
import { promotionEntryRedirect } from './promotion-entry-destination';
import { PROMOTION_VISUAL_SCRIPT_SHA256 } from './promotion-visual-script';
import { StorefrontPromotionAccessService } from './storefront-promotion-access.service';
import { StorefrontPromotionService } from './storefront-promotion.service';

interface PromotionAuthority {
    settings: StorefrontSeoPublicSettings | null;
    document: StorefrontSeoDocument | null;
    settingsVersion: number;
    documentVersion: number;
    primaryHost: string | null;
    mode: string;
    languageContentComplete: boolean;
}

@Controller('promo')
@UseFilters(StorefrontClosedHttpFilter)
export class StorefrontPromotionController {
    constructor(
        private readonly accessService: StorefrontPromotionAccessService,
        private readonly promotionService: StorefrontPromotionService,
        private readonly sessionService: SessionService,
        private readonly configService: ConfigService,
        @Optional() private readonly seo?: StorefrontSeoService,
        @Optional() private readonly publicSeo?: StorefrontPublicSeoService,
        @Optional() private readonly activation?: StorefrontActivationService,
        @Optional() private readonly connection?: TransactionalConnection,
    ) {}

    @Get()
    async promotion(@Req() req: Request, @Res() res: Response): Promise<void> {
        const request = await this.accessService.resolveRequest(req);
        if (!request) {
            res.status(404).type('text/plain').send('未找到该店铺推广页');
            return;
        }
        this.setPromotionHeaders(res);
        const forwardedPath = trustedPublicPageHeaders(req)
            ? req.headers?.['x-storefront-original-uri']
            : undefined;
        const path = typeof forwardedPath === 'string' ? forwardedPath : (req.originalUrl ?? '/promo');
        const explicit = /^\/(zh|en)\/promo(?:[/?]|$)/u.exec(path)?.[1];
        const scoped =
            explicit && request.ctx.copy
                ? {
                      ...request,
                      ctx: request.ctx.copy({
                          languageCode: explicit === 'zh' ? LanguageCode.zh_Hans : LanguageCode.en,
                      }),
                  }
                : request;
        const ticket = this.accessService.createEntryTicket(scoped);
        const html = await this.promotionService.renderPublished(scoped.ctx, ticket);
        const authority = await this.promotionAuthority(scoped.ctx);
        if (authority.mode === 'CLOSED') throw new StorefrontClosedError();
        const rendered = resolvePromotionSeo({
            ...authority,
            html,
            host: scoped.host,
            channelCode: scoped.ctx.channel?.code ?? '',
            languageCode: scoped.ctx.languageCode === LanguageCode.zh_Hans ? 'zh_Hans' : 'en',
            legacyEntry: !explicit,
        });
        const current = await this.promotionAuthority(scoped.ctx);
        if (current.mode === 'CLOSED') throw new StorefrontClosedError();
        if (
            current.mode !== authority.mode ||
            current.primaryHost !== authority.primaryHost ||
            current.settingsVersion !== authority.settingsVersion ||
            current.documentVersion !== authority.documentVersion ||
            current.languageContentComplete !== authority.languageContentComplete
        )
            throw new ServiceUnavailableException('Promotion publication or store access changed');
        res.setHeader('X-Robots-Tag', rendered.seo.robots);
        res.status(200).type('html').send(rendered.html);
    }

    @Post('enter')
    async enter(
        @Req() req: Request,
        @Res() res: Response,
        @Body('ticket') ticket?: string,
        @Body('destination') destination?: string,
    ): Promise<void> {
        const request = await this.accessService.resolveRequest(req);
        if (request && (!destination || destination === 'home')) {
            // The published homepage is public, including from an old promotion tab.
            res.setHeader('Cache-Control', 'no-store');
            res.redirect(303, '/');
            return;
        }
        if (!request || !ticket || !this.accessService.validateEntryTicket(ticket, request)) {
            res.setHeader('Cache-Control', 'no-store');
            res.redirect(303, '/promo');
            return;
        }
        res.setHeader('Set-Cookie', this.accessService.createEntryCookie(request));
        res.setHeader('Cache-Control', 'no-store');
        res.redirect(303, promotionEntryRedirect(destination));
    }

    @Get('access')
    async access(@Req() req: Request, @Res() res: Response): Promise<void> {
        res.setHeader('Cache-Control', 'private, no-store');
        const options = this.configService.authOptions;
        const extracted = extractSessionToken(req, options.tokenMethod, options.apiKeyHeaderKey);
        const session =
            extracted && extracted.method !== 'api-key'
                ? await this.sessionService.getSessionFromToken(extracted.token)
                : undefined;
        const request = await this.accessService.resolveRequest(req);
        if (request && session?.user?.id) {
            res.status(204).send();
            return;
        }
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
        res.setHeader('Cache-Control', 'no-store');
        res.type('text/plain').send(
            this.publicSeo ? await this.publicSeo.robots(request.ctx) : publicRobots(null, null, false),
        );
    }

    @Get('sitemap')
    async sitemap(@Req() req: Request, @Res() res: Response): Promise<void> {
        const request = await this.accessService.resolveRequest(req);
        if (!request) {
            res.status(404).type('text/plain').send('Storefront not found');
            return;
        }
        res.setHeader('Cache-Control', 'no-store');
        res.type('application/xml').send(
            this.publicSeo ? await this.publicSeo.sitemap(request.ctx, request.host) : sitemapXml([]),
        );
    }

    private async promotionAuthority(ctx: RequestContext): Promise<PromotionAuthority> {
        if (!this.seo || !this.publicSeo || !this.activation || !this.connection)
            return {
                settings: null,
                document: null,
                settingsVersion: 0,
                documentVersion: 0,
                primaryHost: null,
                mode: 'UNKNOWN',
                languageContentComplete: false,
            };
        const languageCode = ctx.languageCode === LanguageCode.zh_Hans ? 'zh_Hans' : 'en';
        const [settings, document, primaryHost, mode, profile] = await Promise.all([
            this.seo.publishedConfiguration(ctx),
            this.seo.publishedRecord(ctx, { targetType: 'PAGE', targetId: 'promo', languageCode }),
            this.publicSeo.primaryHost(ctx),
            this.activation.getAccessMode(ctx),
            this.connection.getRepository(ctx, StoreProfile).findOne({ where: { channelId: ctx.channelId } }),
        ]);
        const names = ctx.channel.customFields as { storefrontNameEn?: string; storefrontNameZh?: string };
        const name = languageCode === 'zh_Hans' ? names.storefrontNameZh : names.storefrontNameEn;
        const description = languageCode === 'zh_Hans' ? profile?.descriptionZh : profile?.descriptionEn;
        return {
            settings: settings?.payload ?? null,
            document: document?.payload ?? null,
            settingsVersion: settings?.version ?? 0,
            documentVersion: document?.version ?? 0,
            primaryHost,
            mode,
            languageContentComplete: Boolean(name?.trim() && description?.trim()),
        };
    }

    private setPromotionHeaders(res: Response): void {
        res.setHeader('Cache-Control', 'no-store');
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
        res.setHeader('X-Frame-Options', 'DENY');
        res.setHeader('X-Robots-Tag', 'noindex, follow');
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
                "connect-src 'self' https://cloudflareinsights.com",
            ].join('; '),
        );
    }
}

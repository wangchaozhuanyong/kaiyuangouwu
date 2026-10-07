import { Controller, Get, Req, Res } from '@nestjs/common';
import { CurrencyCode, LanguageCode, RequestContextService } from '@vendure/core';
import type {
    PublicPageCatalogInput,
    PublicPageRequest,
    StorefrontPageData,
} from '@vendure/storefront-content-plugin';
import type { Request, Response } from 'express';

import { StorefrontPromotionAccessService } from './promotion/storefront-promotion-access.service';
import { StorefrontClosedError } from './storefront-activation.service';
import { StorefrontPublicPageService } from './storefront-public-page.service';

export function parsePublicPageRequest(query: Request['query']): PublicPageRequest {
    if (query.kind == null || query.kind === 'home') return { kind: 'home' };
    if (query.kind === 'product' && typeof query.id === 'string' && /^[a-z0-9_-]{1,100}$/iu.test(query.id)) {
        return { kind: 'product', id: query.id };
    }
    if (query.kind !== 'catalog' || typeof query.input !== 'string' || query.input.length > 2000)
        throw new Error('Invalid public page');
    const raw = JSON.parse(query.input);
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Invalid catalog input');
    const input: PublicPageCatalogInput = {};
    if (raw.term != null) {
        if (typeof raw.term !== 'string' || raw.term.length > 200) throw new Error('Invalid search');
        input.term = raw.term.trim();
    }
    if (raw.collectionId != null) {
        if (typeof raw.collectionId !== 'string' || !/^[a-z0-9_-]{1,100}$/iu.test(raw.collectionId))
            throw new Error('Invalid collection');
        input.collectionId = raw.collectionId;
    }
    if (raw.sort != null) {
        if (!['RECOMMENDED', 'SALES', 'NEWEST', 'NAME', 'PRICE_ASC', 'PRICE_DESC'].includes(raw.sort))
            throw new Error('Invalid sort');
        input.sort = raw.sort;
    }
    if (raw.fulfillmentType != null) {
        if (!['PHYSICAL', 'DIGITAL'].includes(raw.fulfillmentType)) throw new Error('Invalid fulfillment');
        input.fulfillmentType = raw.fulfillmentType;
    }
    if (raw.inStockOnly != null && typeof raw.inStockOnly !== 'boolean')
        throw new Error('Invalid stock filter');
    input.inStockOnly = raw.inStockOnly === true;
    for (const key of ['minPriceWithTax', 'maxPriceWithTax', 'skip', 'take'] as const) {
        const value = raw[key];
        if (value == null) continue;
        if (
            !Number.isSafeInteger(value) ||
            value < 0 ||
            (key === 'take' && (value < 1 || value > 48)) ||
            (key === 'skip' && value > 100_000)
        )
            throw new Error('Invalid pagination or price');
        input[key] = value;
    }
    return { kind: 'catalog', input };
}

@Controller('storefront')
export class StorefrontPublicPageController {
    constructor(
        private readonly access: StorefrontPromotionAccessService,
        private readonly contexts: RequestContextService,
        private readonly pages: StorefrontPublicPageService,
    ) {}

    @Get('page-data')
    async read(@Req() req: Request, @Res() res: Response): Promise<void> {
        // Public snapshots contain no cookie/session data, but are host-scoped and not a CDN HTML cache.
        res.setHeader('Cache-Control', 'private, no-store');
        res.setHeader('X-Content-Type-Options', 'nosniff');
        let verified: Awaited<ReturnType<StorefrontPromotionAccessService['resolveRequest']>>;
        try {
            verified = await this.access.resolveRequest(req);
        } catch (error) {
            if (!(error instanceof StorefrontClosedError)) throw error;
            res.status(403).json({ errorCode: 'STOREFRONT_CLOSED', message: 'Store not open yet' });
            return;
        }
        if (!verified) {
            res.status(404).end();
            return;
        }
        const language = req.query.languageCode;
        const currency = req.query.currencyCode;
        if (language != null && language !== 'en' && language !== 'zh_Hans') {
            res.status(400).json({ error: 'Unsupported language' });
            return;
        }
        if (
            currency != null &&
            (typeof currency !== 'string' ||
                !verified.ctx.channel.availableCurrencyCodes.includes(currency as CurrencyCode))
        ) {
            res.status(400).json({ error: 'Unsupported currency' });
            return;
        }
        let request: PublicPageRequest;
        try {
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
            languageCode: (language as LanguageCode | undefined) ?? verified.ctx.languageCode,
            currencyCode: (currency as CurrencyCode | undefined) ?? verified.ctx.currencyCode,
        });
        const start = performance.now();
        let page: StorefrontPageData;
        try {
            page = await this.pages.read(ctx, verified.host, request);
        } catch (error) {
            if (!(error instanceof StorefrontClosedError)) throw error;
            res.status(403).json({ errorCode: 'STOREFRONT_CLOSED', message: 'Store not open yet' });
            return;
        }
        res.setHeader('Server-Timing', `public-page;dur=${(performance.now() - start).toFixed(1)}`);
        res.status(200).json(page);
    }
}

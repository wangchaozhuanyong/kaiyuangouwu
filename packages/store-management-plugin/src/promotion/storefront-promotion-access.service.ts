import { Inject, Injectable } from '@nestjs/common';
import {
    ConfigService,
    ID,
    LanguageCode,
    RequestContext,
    RequestContextService,
    TransactionalConnection,
} from '@vendure/core';
import { normalizeRequestHost, StoreDomain } from '@vendure/store-domain-plugin';
import type { Request } from 'express';
import { createHmac, timingSafeEqual } from 'node:crypto';

import { STOREFRONT_ENTRY_COOKIE, STOREFRONT_PROMOTION_OPTIONS } from '../constants';
import { StorefrontActivationService } from '../storefront-activation.service';
import { StorefrontPromotionPluginOptions } from '../types';

type SignedValueKind = 'entry-ticket' | 'entry-cookie';

interface SignedValuePayload {
    kind: SignedValueKind;
    channelId: string;
    host: string;
    exp: number;
}

export interface StorefrontPromotionRequest {
    ctx: RequestContext;
    host: string;
    channelId: ID;
}

@Injectable()
export class StorefrontPromotionAccessService {
    constructor(
        private readonly connection: TransactionalConnection,
        private readonly configService: ConfigService,
        private readonly requestContextService: RequestContextService,
        private readonly activationService: StorefrontActivationService,
        @Inject(STOREFRONT_PROMOTION_OPTIONS)
        private readonly options: Required<StorefrontPromotionPluginOptions>,
    ) {}

    get enabled(): boolean {
        return this.options.enabled;
    }

    async resolveRequest(req: Request): Promise<StorefrontPromotionRequest | null> {
        const forwardedHost = this.options.trustProxyHeaders
            ? this.headerValue(req.headers['x-forwarded-host'])
            : undefined;
        const host = normalizeRequestHost(forwardedHost ?? req.headers.host);
        if (!host) return null;

        const acceptLanguage = String(req.headers['accept-language'] || '').toLowerCase();
        const isChinese = acceptLanguage.includes('zh');
        const languageCode = isChinese ? LanguageCode.zh_Hans : LanguageCode.en;

        if (this.options.bypassHosts.includes(host)) {
            const tokenKey = this.configService.apiOptions.channelTokenKey;
            const queryToken = req.query?.[tokenKey];
            const headerToken = req.headers[tokenKey];
            const channelToken =
                (typeof queryToken === 'string' ? queryToken : undefined) ?? this.headerValue(headerToken);
            const bypassContext = await this.requestContextService.create({
                req,
                apiType: 'shop',
                channelOrToken: channelToken,
                languageCode,
            });
            await this.activationService.assertActive(bypassContext);
            return { ctx: bypassContext, host, channelId: bypassContext.channelId };
        }

        const domain = await this.connection.rawConnection.getRepository(StoreDomain).findOne({
            where: { domain: host, status: 'ACTIVE' },
            relations: { channel: true },
        });
        if (!domain) return null;
        const domainContext = await this.requestContextService.create({
            req,
            apiType: 'shop',
            channelOrToken: domain.channel,
            languageCode,
        });
        await this.activationService.assertActive(domainContext);
        return { ctx: domainContext, host, channelId: domain.channelId };
    }

    createEntryTicket(request: StorefrontPromotionRequest): string {
        return this.sign({
            kind: 'entry-ticket',
            channelId: String(request.channelId),
            host: request.host,
            exp: Date.now() + 15 * 60 * 1000,
        });
    }

    validateEntryTicket(token: string, request: StorefrontPromotionRequest): boolean {
        return this.validate(token, 'entry-ticket', request);
    }

    createEntryCookie(request: StorefrontPromotionRequest): string {
        const token = this.sign({
            kind: 'entry-cookie',
            channelId: String(request.channelId),
            host: request.host,
            exp: Date.now() + 7 * 24 * 60 * 60 * 1000,
        });
        const secure = this.options.secureCookie ? '; Secure' : '';
        return `${STOREFRONT_ENTRY_COOKIE}=${token}; Path=/; Max-Age=604800; HttpOnly; SameSite=Lax${secure}`;
    }

    hasValidEntryCookie(req: Request, request: StorefrontPromotionRequest): boolean {
        const token = this.readCookie(req, STOREFRONT_ENTRY_COOKIE);
        return token ? this.validate(token, 'entry-cookie', request) : false;
    }

    private sign(payload: SignedValuePayload): string {
        const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
        const signature = createHmac('sha256', this.options.signingSecret)
            .update(encoded)
            .digest('base64url');
        return `${encoded}.${signature}`;
    }

    private validate(token: string, kind: SignedValueKind, request: StorefrontPromotionRequest): boolean {
        const [encoded, signature, extra] = token.split('.');
        if (!encoded || !signature || extra) return false;
        const expected = createHmac('sha256', this.options.signingSecret).update(encoded).digest('base64url');
        const actualBuffer = Buffer.from(signature);
        const expectedBuffer = Buffer.from(expected);
        if (actualBuffer.length !== expectedBuffer.length || !timingSafeEqual(actualBuffer, expectedBuffer)) {
            return false;
        }
        try {
            const payload = JSON.parse(
                Buffer.from(encoded, 'base64url').toString('utf8'),
            ) as SignedValuePayload;
            return (
                payload.kind === kind &&
                payload.channelId === String(request.channelId) &&
                payload.host === request.host &&
                Number.isFinite(payload.exp) &&
                payload.exp > Date.now()
            );
        } catch {
            return false;
        }
    }

    private readCookie(req: Request, name: string): string | undefined {
        for (const part of (req.headers.cookie ?? '').split(';')) {
            const separator = part.indexOf('=');
            if (separator < 0) continue;
            if (part.slice(0, separator).trim() === name) {
                return part.slice(separator + 1).trim();
            }
        }
    }

    private headerValue(value: string | string[] | undefined): string | undefined {
        return Array.isArray(value) ? value[0] : value;
    }
}

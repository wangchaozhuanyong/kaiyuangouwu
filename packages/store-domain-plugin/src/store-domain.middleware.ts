import { Inject, Injectable, NestMiddleware } from '@nestjs/common';
import { ConfigService } from '@vendure/core';
import { NextFunction, Request, Response } from 'express';

import { STORE_DOMAIN_PLUGIN_OPTIONS } from './constants';
import { normalizeRequestHost } from './domain-utils';
import { StoreDomainService } from './store-domain.service';
import { ResolvedStoreDomainPluginOptions } from './types';

@Injectable()
export class StoreDomainMiddleware implements NestMiddleware {
    constructor(
        private readonly configService: ConfigService,
        private readonly storeDomainService: StoreDomainService,
        @Inject(STORE_DOMAIN_PLUGIN_OPTIONS) private readonly options: ResolvedStoreDomainPluginOptions,
    ) {}

    async use(req: Request, res: Response, next: NextFunction): Promise<void> {
        const forwardedHost = this.options.trustProxyHeaders
            ? this.headerValue(req.headers['x-forwarded-host'])
            : undefined;
        const host = normalizeRequestHost(forwardedHost ?? req.headers.host);
        if (host && this.options.bypassHosts.includes(host)) {
            next();
            return;
        }

        const storeDomain = host ? await this.storeDomainService.resolveRoute(host) : null;
        if (storeDomain?.status === 'ACTIVE') {
            const tokenKey = this.configService.apiOptions.channelTokenKey;
            req.headers[tokenKey] = storeDomain.channelToken;
            Object.defineProperty(req, 'query', {
                configurable: true,
                enumerable: true,
                writable: true,
                value: { ...req.query, [tokenKey]: storeDomain.channelToken },
            });
            next();
            return;
        }

        if (storeDomain || this.options.routingMode === 'require-domain') {
            res.status(404).json({
                errors: [
                    {
                        message: storeDomain ? '该店铺域名尚未验证' : '未找到该域名对应的店铺',
                        extensions: {
                            code: storeDomain ? 'STORE_DOMAIN_NOT_ACTIVE' : 'STORE_DOMAIN_NOT_FOUND',
                        },
                    },
                ],
            });
            return;
        }
        next();
    }

    private headerValue(value: string | string[] | undefined): string | undefined {
        return Array.isArray(value) ? value[0] : value;
    }
}

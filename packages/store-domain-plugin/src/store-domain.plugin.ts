import { MiddlewareConsumer, NestModule, OnApplicationBootstrap } from '@nestjs/common';
import { ChannelEvent, ConfigService, EventBus, PluginCommonModule, VendurePlugin } from '@vendure/core';

import { adminApiExtensions } from './api-extensions';
import { STORE_DOMAIN_PLUGIN_OPTIONS, storeDomainPermission } from './constants';
import { StoreDomain } from './entities/store-domain.entity';
import { StoreDomainChangedEvent } from './store-domain.event';
import { StoreDomainMiddleware } from './store-domain.middleware';
import { StoreDomainAdminResolver, StoreDomainEntityResolver } from './store-domain.resolver';
import { defaultResolveTxt, StoreDomainService } from './store-domain.service';
import { reconcileAutomatedStoreDomainsTask } from './store-domain.tasks';
import { ResolvedStoreDomainPluginOptions, StoreDomainPluginOptions } from './types';

@VendurePlugin({
    imports: [PluginCommonModule],
    entities: [StoreDomain],
    providers: [
        StoreDomainService,
        StoreDomainMiddleware,
        { provide: STORE_DOMAIN_PLUGIN_OPTIONS, useFactory: () => StoreDomainPlugin.options },
    ],
    configuration: config => {
        config.authOptions.customPermissions.push(storeDomainPermission);
        config.schedulerOptions.tasks.push(reconcileAutomatedStoreDomainsTask);
        return config;
    },
    adminApiExtensions: {
        schema: adminApiExtensions,
        resolvers: [StoreDomainAdminResolver, StoreDomainEntityResolver],
    },
    dashboard: '../src/dashboard/index.tsx',
    compatibility: '^3.7.0',
})
export class StoreDomainPlugin implements NestModule, OnApplicationBootstrap {
    static options: ResolvedStoreDomainPluginOptions = {
        cnameTarget: '',
        routingMode: 'prefer-domain',
        trustProxyHeaders: false,
        bypassHosts: ['localhost', '127.0.0.1'],
        resolveTxt: defaultResolveTxt,
        cloudflare: null,
    };

    constructor(
        private readonly configService: ConfigService,
        private readonly eventBus: EventBus,
        private readonly storeDomainService: StoreDomainService,
    ) {}

    static init(options: StoreDomainPluginOptions): typeof StoreDomainPlugin {
        const production = process.env.NODE_ENV === 'production';
        const cnameTarget = options.cnameTarget.trim().toLowerCase();
        const routingMode = options.routingMode ?? (production ? 'require-domain' : 'prefer-domain');
        if (!cnameTarget) {
            throw new Error('StoreDomainPlugin requires a public CNAME target');
        }
        if (production && routingMode !== 'require-domain') {
            throw new Error('StoreDomainPlugin must use require-domain routing in production');
        }
        if (production && (cnameTarget === 'localhost' || cnameTarget.endsWith('.localhost'))) {
            throw new Error('StoreDomainPlugin requires a public CNAME target in production');
        }
        const cloudflare = options.cloudflare
            ? {
                  ...options.cloudflare,
                  apiToken: options.cloudflare.apiToken.trim(),
                  saasZoneId: options.cloudflare.saasZoneId.trim(),
                  fallbackOrigin: options.cloudflare.fallbackOrigin.trim().toLowerCase(),
                  autoManageDns: options.cloudflare.autoManageDns ?? false,
                  apiBaseUrl: (
                      options.cloudflare.apiBaseUrl ?? 'https://api.cloudflare.com/client/v4'
                  ).replace(/\/$/u, ''),
                  fetch: options.cloudflare.fetch ?? fetch,
              }
            : null;
        if (cloudflare && (!cloudflare.apiToken || !cloudflare.saasZoneId || !cloudflare.fallbackOrigin)) {
            throw new Error('Cloudflare domain automation requires apiToken, saasZoneId, and fallbackOrigin');
        }
        if (production && cloudflare && !cloudflare.apiBaseUrl.startsWith('https://')) {
            throw new Error('Cloudflare domain automation requires an HTTPS API endpoint in production');
        }
        this.options = {
            cnameTarget,
            routingMode,
            trustProxyHeaders: options.trustProxyHeaders ?? false,
            bypassHosts: (options.bypassHosts ?? (production ? [] : ['localhost', '127.0.0.1'])).map(host =>
                host.trim().toLowerCase(),
            ),
            resolveTxt: options.resolveTxt ?? defaultResolveTxt,
            cloudflare,
        };
        return StoreDomainPlugin;
    }

    configure(consumer: MiddlewareConsumer) {
        consumer.apply(StoreDomainMiddleware).forRoutes(this.configService.apiOptions.shopApiPath);
    }

    onApplicationBootstrap(): void {
        this.eventBus.ofType(StoreDomainChangedEvent).subscribe(event => {
            void this.storeDomainService.invalidateDomainRoute(event.domain);
        });
        this.eventBus.ofType(ChannelEvent).subscribe(event => {
            if (event.type === 'updated' || event.type === 'deleted') {
                void this.storeDomainService.invalidateChannelRoutes(event.entity.id);
            }
        });
    }
}

import { MiddlewareConsumer, NestModule, OnApplicationBootstrap } from '@nestjs/common';
import { ChannelEvent, ConfigService, EventBus, PluginCommonModule, VendurePlugin } from '@vendure/core';

import { adminApiExtensions } from './api-extensions';
import { STORE_DOMAIN_PLUGIN_OPTIONS } from './constants';
import { StoreDomain } from './entities/store-domain.entity';
import { StoreDomainChangedEvent } from './store-domain.event';
import { StoreDomainMiddleware } from './store-domain.middleware';
import { StoreDomainAdminResolver, StoreDomainEntityResolver } from './store-domain.resolver';
import { defaultResolveTxt, StoreDomainService } from './store-domain.service';
import { StoreDomainPluginOptions } from './types';

@VendurePlugin({
    imports: [PluginCommonModule],
    entities: [StoreDomain],
    providers: [
        StoreDomainService,
        StoreDomainMiddleware,
        { provide: STORE_DOMAIN_PLUGIN_OPTIONS, useFactory: () => StoreDomainPlugin.options },
    ],
    adminApiExtensions: {
        schema: adminApiExtensions,
        resolvers: [StoreDomainAdminResolver, StoreDomainEntityResolver],
    },
    dashboard: '../src/dashboard/index.tsx',
    compatibility: '^3.7.0',
})
export class StoreDomainPlugin implements NestModule, OnApplicationBootstrap {
    static options: Required<StoreDomainPluginOptions> = {
        cnameTarget: '',
        routingMode: 'prefer-domain',
        trustProxyHeaders: false,
        bypassHosts: ['localhost', '127.0.0.1'],
        resolveTxt: defaultResolveTxt,
    };

    constructor(
        private readonly configService: ConfigService,
        private readonly eventBus: EventBus,
        private readonly storeDomainService: StoreDomainService,
    ) {}

    static init(options: StoreDomainPluginOptions): typeof StoreDomainPlugin {
        this.options = {
            cnameTarget: options.cnameTarget.trim().toLowerCase(),
            routingMode: options.routingMode ?? 'prefer-domain',
            trustProxyHeaders: options.trustProxyHeaders ?? false,
            bypassHosts: (options.bypassHosts ?? ['localhost', '127.0.0.1']).map(host =>
                host.trim().toLowerCase(),
            ),
            resolveTxt: options.resolveTxt ?? defaultResolveTxt,
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

import { MiddlewareConsumer, NestModule } from '@nestjs/common';
import { Type } from '@vendure/common/lib/shared-types';
import {
    PluginCommonModule,
    ProcessContext,
    registerPluginStartupMessage,
    SettingsStoreScopes,
    VendurePlugin,
} from '@vendure/core';

import { adminApiExtensions } from './api/api-extensions';
import { MetricsResolver } from './api/metrics.resolver';
import { manageDashboardGlobalViews } from './constants';
import { MetricsService } from './service/metrics.service';
import { createNextAdminStaticServer } from './static-server';

export interface NextAdminPluginOptions {
    route: string;
    appDir: string;
    serveStatic: boolean;
}

/** Hosts next-admin only; metrics and saved settings retain their existing API contract. */
@VendurePlugin({
    imports: [PluginCommonModule],
    adminApiExtensions: { schema: adminApiExtensions, resolvers: [MetricsResolver] },
    providers: [MetricsService],
    configuration: config => {
        config.authOptions.customPermissions.push(manageDashboardGlobalViews);
        config.settingsStoreFields['vendure.dashboard'] = [
            { name: 'userSettings', scope: SettingsStoreScopes.user },
            {
                name: 'globalSavedViews',
                scope: SettingsStoreScopes.global,
                requiresPermission: {
                    read: manageDashboardGlobalViews.Read,
                    write: manageDashboardGlobalViews.Write,
                },
            },
            { name: 'userSavedViews', scope: SettingsStoreScopes.user },
        ];
        return config;
    },
    compatibility: '^3.7.0',
})
export class NextAdminPlugin implements NestModule {
    private static options: NextAdminPluginOptions;

    constructor(private readonly processContext: ProcessContext) {}

    static init(options: NextAdminPluginOptions): Type<NextAdminPlugin> {
        this.options = options;
        return NextAdminPlugin;
    }

    configure(consumer: MiddlewareConsumer) {
        if (this.processContext.isWorker || !NextAdminPlugin.options?.serveStatic) return;
        const { route, appDir } = NextAdminPlugin.options;
        const rateLimitRequests = process.env.NODE_ENV === 'production' ? 500 : 100_000;
        consumer.apply(createNextAdminStaticServer(appDir, rateLimitRequests)).forRoutes(route);
        registerPluginStartupMessage('next-admin', route);
    }
}

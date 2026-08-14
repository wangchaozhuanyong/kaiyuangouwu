/* eslint-disable no-console */
import { OnApplicationBootstrap } from '@nestjs/common';
import { AssetServerPlugin } from '@vendure/asset-server-plugin';
import { CommerceFulfillmentPlugin } from '@vendure/commerce-fulfillment-plugin';
import { ADMIN_API_PATH, API_PORT, SHOP_API_PATH } from '@vendure/common/lib/shared-constants';
import {
    DefaultJobQueuePlugin,
    DefaultLogger,
    DefaultSchedulerPlugin,
    DefaultSearchPlugin,
    dummyPaymentHandler,
    LogLevel,
    PluginCommonModule,
    RequestContextService,
    SettingsStoreScopes,
    SettingsStoreService,
    VendureConfig,
    VendurePlugin,
} from '@vendure/core';
import { DashboardPlugin } from '@vendure/dashboard/plugin';
import { defaultEmailHandlers, EmailPlugin, FileBasedTemplateLoader } from '@vendure/email-plugin';
import { OperationsDashboardPlugin } from '@vendure/operations-dashboard-plugin';
import { StorefrontCartPlugin } from '@vendure/storefront-cart-plugin';
import { StoreDomainPlugin, type StoreDomainRoutingMode } from '@vendure/store-domain-plugin';
import 'dotenv/config';
import { createRequire } from 'node:module';
import path from 'path';
import { DataSourceOptions } from 'typeorm';

// import { FieldTestPlugin } from './test-plugins/field-test/field-test-plugin';
import { ReviewsPlugin } from './test-plugins/reviews/reviews-plugin';

const IS_INSTRUMENTED = process.env.IS_INSTRUMENTED === 'true';
const SERVE_GRAPHIQL = process.env.VENDURE_SERVE_GRAPHIQL !== 'false';
const SERVE_STATIC_DASHBOARD = process.env.VENDURE_SERVE_STATIC_DASHBOARD !== 'false';
const loadPackage = createRequire(__filename);
const dashboardUrl = process.env.VENDURE_DASHBOARD_URL || 'http://localhost:3000/dashboard';
const dashboardAppDir =
    path.basename(__dirname) === 'dist'
        ? path.join(__dirname, './dashboard')
        : path.join(__dirname, './dist/dashboard');
const localizedEmailSubjects: Record<string, string> = {
    'order-confirmation': '订单确认 #{{ order.code }}',
    'email-verification': '请验证您的电子邮箱',
    'password-reset': '重置您的登录密码',
    'email-address-change': '请验证新的电子邮箱',
};
const localizedEmailHandlers = defaultEmailHandlers.map(handler => {
    const subject = localizedEmailSubjects[handler.type];
    return subject ? handler.setSubject(subject) : handler;
});

function storeDomainRoutingMode(): StoreDomainRoutingMode | undefined {
    const value = process.env.STORE_DOMAIN_ROUTING_MODE?.trim();
    if (!value) {
        return;
    }
    if (value === 'prefer-domain' || value === 'require-domain') {
        return value;
    }
    throw new Error('STORE_DOMAIN_ROUTING_MODE must be prefer-domain or require-domain');
}

function storeDomainBypassHosts(): string[] | undefined {
    const value = process.env.STORE_DOMAIN_BYPASS_HOSTS;
    if (value == null) {
        return;
    }
    return value
        .split(',')
        .map(host => host.trim())
        .filter(Boolean);
}

@VendurePlugin({
    imports: [PluginCommonModule],
    configuration: config => {
        config.settingsStoreFields = {
            ...config.settingsStoreFields,
            ReadonlyTest: [
                { name: 'buildVersion', readonly: true },
                { name: 'buildMeta', readonly: true },
            ],
        };
        return config;
    },
})
class ReadonlySettingsTestPlugin implements OnApplicationBootstrap {
    constructor(
        private settingsStoreService: SettingsStoreService,
        private requestContextService: RequestContextService,
    ) {}
    async onApplicationBootstrap() {
        const ctx = await this.requestContextService.create({ apiType: 'admin' });
        await this.settingsStoreService.set(ctx, 'ReadonlyTest.buildVersion', 'v3.5.2' as any);
        await this.settingsStoreService.set(ctx, 'ReadonlyTest.buildMeta', {
            buildDate: '2026-03-06',
            commit: 'd0384f3ed',
            features: ['settings-store-ui', 'option-groups'],
        });
    }
}

/**
 * Config settings used during development
 */
export const devConfig: VendureConfig = {
    apiOptions: {
        port: Number(process.env.PORT) || Number(process.env.API_PORT) || API_PORT,
        trustProxy: process.env.VENDURE_TRUST_PROXY === 'true',
        adminApiPath: ADMIN_API_PATH,
        adminApiPlayground: {
            settings: {
                'request.credentials': 'include',
            },
        },
        adminApiDebug: true,
        shopApiPath: SHOP_API_PATH,
        shopApiPlayground: {
            settings: {
                'request.credentials': 'include',
            },
        },
        shopApiDebug: true,
    },
    authOptions: {
        disableAuth: false,
        tokenMethod: ['bearer', 'cookie', 'api-key'] as const,
        requireVerification: true,
        customPermissions: [],
        cookieOptions: {
            secret: 'abc',
        },
    },
    dbConnectionOptions: {
        synchronize: false,
        logging: false,
        migrations: [path.join(__dirname, 'migrations/*.+(js|ts)')],
        ...getDbConfig(),
    },
    paymentOptions: {
        paymentMethodHandlers: [dummyPaymentHandler],
    },
    settingsStoreFields: {
        MyPlugin: [
            {
                name: 'globalVal',
            },
            {
                name: 'userVal',
                scope: SettingsStoreScopes.user,
            },
        ],
    },
    customFields: {},
    logger: new DefaultLogger({ level: LogLevel.Verbose }),
    importExportOptions: {
        importAssetsDir: path.join(__dirname, 'import-assets'),
    },
    plugins: [
        // MultivendorPlugin.init({
        //     platformFeePercent: 10,
        //     platformFeeSKU: 'FEE',
        // }),
        ReadonlySettingsTestPlugin,
        ReviewsPlugin,
        // FieldTestPlugin,
        OperationsDashboardPlugin,
        CommerceFulfillmentPlugin,
        StorefrontCartPlugin,
        StoreDomainPlugin.init({
            cnameTarget: process.env.STORE_DOMAIN_CNAME_TARGET || 'vendure.localhost',
            routingMode: storeDomainRoutingMode(),
            trustProxyHeaders: process.env.STORE_DOMAIN_TRUST_PROXY === 'true',
            bypassHosts: storeDomainBypassHosts(),
        }),
        ...(SERVE_GRAPHIQL ? [loadPackage('@vendure/graphiql-plugin').GraphiqlPlugin.init()] : []),
        AssetServerPlugin.init({
            route: 'assets',
            assetUploadDir: path.join(__dirname, 'assets'),
        }),
        DefaultSearchPlugin.init({ bufferUpdates: false, indexStockStatus: false }),
        // Enable if you need to debug the job queue
        // BullMQJobQueuePlugin.init({}),
        DefaultJobQueuePlugin.init({}),
        // JobQueueTestPlugin.init({ queueCount: 10 }),
        DefaultSchedulerPlugin.init({}),
        EmailPlugin.init({
            devMode: true,
            route: 'mailbox',
            handlers: localizedEmailHandlers,
            templateLoader: new FileBasedTemplateLoader(path.join(__dirname, './email-templates')),
            outputPath: path.join(__dirname, 'test-emails'),
            globalTemplateVars: {
                verifyEmailAddressUrl: `${dashboardUrl}/verify`,
                passwordResetUrl: `${dashboardUrl}/reset-password`,
                changeEmailAddressUrl: `${dashboardUrl}/change-email-address`,
            },
        }),
        ...(IS_INSTRUMENTED ? [loadPackage('@vendure/telemetry-plugin').TelemetryPlugin.init({})] : []),
        SERVE_STATIC_DASHBOARD
            ? DashboardPlugin.init({
                  route: 'dashboard',
                  appDir: dashboardAppDir,
              })
            : DashboardPlugin,
    ],
};

function getDbConfig(): DataSourceOptions {
    const dbType = process.env.DB || 'mysql';
    switch (dbType) {
        case 'postgres':
            console.log('Using postgres connection');
            return {
                synchronize: true,
                type: 'postgres',
                host: process.env.DB_HOST || 'localhost',
                port: Number(process.env.DB_PORT) || 5432,
                username: process.env.DB_USERNAME || 'vendure',
                password: process.env.DB_PASSWORD || 'password',
                database: process.env.DB_NAME || 'vendure-dev',
                schema: process.env.DB_SCHEMA || 'public',
            };
        case 'sqlite':
            console.log('Using sqlite connection');
            return {
                synchronize: false,
                type: 'better-sqlite3',
                database: path.join(__dirname, 'vendure.sqlite'),
            };
        case 'sqljs':
            console.log('Using sql.js connection');
            return {
                type: 'sqljs',
                autoSave: true,
                database: new Uint8Array([]),
                location: path.join(__dirname, 'vendure.sqlite'),
            };
        case 'mysql':
        case 'mariadb':
        default:
            console.log('Using mysql connection');
            return {
                synchronize: true,
                type: 'mariadb',
                host: '127.0.0.1',
                port: 3306,
                username: 'vendure',
                password: 'password',
                database: 'vendure-dev',
            };
    }
}

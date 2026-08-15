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
    LanguageCode,
    LogLevel,
    PluginCommonModule,
    RequestContext,
    RequestContextService,
    SettingsStoreScopes,
    SettingsStoreService,
    TransactionalConnection,
    VendureConfig,
    VendurePlugin,
} from '@vendure/core';
import { DashboardPlugin } from '@vendure/dashboard/plugin';
import { defaultEmailHandlers, EmailPlugin, FileBasedTemplateLoader } from '@vendure/email-plugin';
import { OperationsDashboardPlugin } from '@vendure/operations-dashboard-plugin';
import { StoreDomain, StoreDomainPlugin, type StoreDomainRoutingMode } from '@vendure/store-domain-plugin';
import { StorefrontCartPlugin } from '@vendure/storefront-cart-plugin';
import { StorefrontContentPlugin } from '@vendure/storefront-content-plugin';
import 'dotenv/config';
import { createRequire } from 'node:module';
import path from 'path';
import { DataSourceOptions } from 'typeorm';

import { devServerMigrations } from './migrations';
// import { FieldTestPlugin } from './test-plugins/field-test/field-test-plugin';
import { ReviewsPlugin } from './test-plugins/reviews/reviews-plugin';

const IS_PRODUCTION = process.env.NODE_ENV === 'production';
const IS_INSTRUMENTED = process.env.IS_INSTRUMENTED === 'true';
const BOOTSTRAP_BASE_SCHEMA = process.env.VENDURE_BOOTSTRAP_BASE_SCHEMA === 'true';
const SERVE_GRAPHIQL =
    process.env.VENDURE_SERVE_GRAPHIQL != null
        ? process.env.VENDURE_SERVE_GRAPHIQL === 'true'
        : !IS_PRODUCTION;
const SERVE_STATIC_DASHBOARD = process.env.VENDURE_SERVE_STATIC_DASHBOARD !== 'false';
const loadPackage = createRequire(__filename);
const serverRoot = path.basename(__dirname) === 'dist' ? path.dirname(__dirname) : __dirname;
const dashboardUrl = process.env.VENDURE_DASHBOARD_URL || 'http://localhost:3000/dashboard';
const dashboardAppDir =
    path.basename(__dirname) === 'dist'
        ? path.join(__dirname, './dashboard')
        : path.join(__dirname, './dist/dashboard');
const corsOrigins = process.env.VENDURE_CORS_ORIGINS?.split(',')
    .map(origin => origin.trim())
    .filter(Boolean);
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

function configuredValue(name: string, developmentDefault: string): string {
    const value = process.env[name]?.trim();
    if (value) {
        return value;
    }
    if (IS_PRODUCTION) {
        throw new Error(`${name} must be configured in production`);
    }
    return developmentDefault;
}

function fallbackStorefrontUrl(): string {
    const rawUrl = configuredValue('VENDURE_STOREFRONT_URL', 'http://127.0.0.1:5175');
    let url: URL;
    try {
        url = new URL(rawUrl);
    } catch {
        throw new Error('VENDURE_STOREFRONT_URL must be a valid absolute URL');
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        throw new Error('VENDURE_STOREFRONT_URL must use http or https');
    }
    return url.toString().replace(/\/$/, '');
}

async function storefrontUrlForChannel(
    ctx: RequestContext,
    connection: TransactionalConnection,
): Promise<string> {
    const primaryDomain = await connection.getRepository(ctx, StoreDomain).findOne({
        where: { channelId: ctx.channelId, isPrimary: true, status: 'ACTIVE' },
    });
    return primaryDomain ? `https://${primaryDomain.domain}` : fallbackStorefrontUrl();
}

function storefrontNameDisplayUnits(value: string): number {
    return Array.from(value).reduce((total, character) => {
        const isWideCharacter = /[\p{Script=Han}\uFF01-\uFF60]/u.test(character);
        return total + (isWideCharacter ? 2 : 1);
    }, 0);
}

function validateStorefrontName(value: string) {
    const displayUnits = storefrontNameDisplayUnits(value.trim());
    if (displayUnits < 1 || displayUnits > 16) {
        return [
            {
                languageCode: LanguageCode.zh_Hans,
                value: '网站名称须为 1 至 16 个显示单位（中文按 2 个计算）',
            },
            { languageCode: LanguageCode.en, value: 'Website name must use 1 to 16 display units' },
        ];
    }
}

function validateCustomerOrderNote(value: string) {
    if (value.length > 500) {
        return [
            { languageCode: LanguageCode.zh_Hans, value: '订单备注不能超过 500 个字符' },
            { languageCode: LanguageCode.en, value: 'Order note cannot exceed 500 characters' },
        ];
    }
}

function trustProxySetting(): boolean | number | string {
    const value = process.env.VENDURE_TRUST_PROXY?.trim();
    if (!value || value === 'false') {
        return false;
    }
    if (value === 'true') {
        return true;
    }
    const hopCount = Number(value);
    return Number.isInteger(hopCount) && hopCount >= 0 ? hopCount : value;
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
        hostname: process.env.VENDURE_HOSTNAME || (IS_PRODUCTION ? '127.0.0.1' : undefined),
        port: Number(process.env.PORT) || Number(process.env.API_PORT) || API_PORT,
        trustProxy: trustProxySetting(),
        adminApiPath: ADMIN_API_PATH,
        adminApiPlayground: IS_PRODUCTION
            ? false
            : {
                  settings: {
                      'request.credentials': 'include',
                  },
              },
        adminApiDebug: !IS_PRODUCTION,
        shopApiPath: SHOP_API_PATH,
        shopApiPlayground: IS_PRODUCTION
            ? false
            : {
                  settings: {
                      'request.credentials': 'include',
                  },
              },
        shopApiDebug: !IS_PRODUCTION,
        introspection: !IS_PRODUCTION,
        ...(corsOrigins?.length
            ? { cors: { origin: corsOrigins, credentials: true } }
            : IS_PRODUCTION
              ? { cors: false }
              : {}),
    },
    authOptions: {
        disableAuth: false,
        tokenMethod: ['bearer', 'cookie', 'api-key'] as const,
        requireVerification: true,
        customPermissions: [],
        superadminCredentials: {
            identifier: configuredValue('SUPERADMIN_USERNAME', 'superadmin'),
            password: configuredValue('SUPERADMIN_PASSWORD', 'superadmin'),
        },
        cookieOptions: {
            secret: configuredValue('COOKIE_SECRET', 'abc'),
            httpOnly: true,
            secure: IS_PRODUCTION,
            sameSite: 'lax',
        },
    },
    dbConnectionOptions: {
        synchronize: false,
        logging: false,
        migrations: devServerMigrations,
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
    customFields: {
        Order: [
            {
                name: 'customerNote',
                type: 'text',
                nullable: true,
                public: true,
                validate: validateCustomerOrderNote,
                label: [
                    { languageCode: LanguageCode.zh_Hans, value: '客户订单备注' },
                    { languageCode: LanguageCode.en, value: 'Customer order note' },
                ],
                description: [
                    { languageCode: LanguageCode.zh_Hans, value: '客户在确认订单时提交的备注' },
                    { languageCode: LanguageCode.en, value: 'Note submitted during checkout' },
                ],
            },
        ],
        Channel: [
            {
                name: 'storefrontNameZh',
                type: 'string',
                length: 32,
                nullable: false,
                defaultValue: '云桥Ai',
                public: true,
                validate: validateStorefrontName,
                label: [
                    { languageCode: LanguageCode.zh_Hans, value: '中文网站名称' },
                    { languageCode: LanguageCode.en, value: 'Chinese website name' },
                ],
                description: [
                    { languageCode: LanguageCode.zh_Hans, value: '客户端切换为中文时显示的网站名称' },
                    {
                        languageCode: LanguageCode.en,
                        value: 'Website name shown when the storefront uses Chinese',
                    },
                ],
            },
            {
                name: 'storefrontNameEn',
                type: 'string',
                length: 32,
                nullable: false,
                defaultValue: 'Yunqiao Ai',
                public: true,
                validate: validateStorefrontName,
                label: [
                    { languageCode: LanguageCode.zh_Hans, value: '英文网站名称' },
                    { languageCode: LanguageCode.en, value: 'English website name' },
                ],
                description: [
                    { languageCode: LanguageCode.zh_Hans, value: '客户端切换为英文时显示的网站名称' },
                    {
                        languageCode: LanguageCode.en,
                        value: 'Website name shown when the storefront uses English',
                    },
                ],
            },
        ],
    },
    logger: new DefaultLogger({ level: IS_PRODUCTION ? LogLevel.Info : LogLevel.Verbose }),
    importExportOptions: {
        importAssetsDir: process.env.VENDURE_IMPORT_ASSETS_DIR || path.join(serverRoot, 'import-assets'),
    },
    plugins: [
        // MultivendorPlugin.init({
        //     platformFeePercent: 10,
        //     platformFeeSKU: 'FEE',
        // }),
        ...(!IS_PRODUCTION && !BOOTSTRAP_BASE_SCHEMA ? [ReadonlySettingsTestPlugin, ReviewsPlugin] : []),
        // FieldTestPlugin,
        OperationsDashboardPlugin,
        ...(!BOOTSTRAP_BASE_SCHEMA
            ? [
                  CommerceFulfillmentPlugin,
                  StorefrontCartPlugin,
                  StorefrontContentPlugin,
                  StoreDomainPlugin.init({
                      cnameTarget: process.env.STORE_DOMAIN_CNAME_TARGET || 'vendure.localhost',
                      routingMode: storeDomainRoutingMode(),
                      trustProxyHeaders: process.env.STORE_DOMAIN_TRUST_PROXY === 'true',
                      bypassHosts: storeDomainBypassHosts(),
                  }),
              ]
            : []),
        ...(SERVE_GRAPHIQL ? [loadPackage('@vendure/graphiql-plugin').GraphiqlPlugin.init()] : []),
        AssetServerPlugin.init({
            route: 'assets',
            assetUploadDir: process.env.VENDURE_ASSET_UPLOAD_DIR || path.join(serverRoot, 'assets'),
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
            templateLoader: new FileBasedTemplateLoader(path.join(serverRoot, 'email-templates')),
            outputPath: process.env.VENDURE_EMAIL_OUTPUT_DIR || path.join(serverRoot, 'test-emails'),
            globalTemplateVars: async (ctx, injector) => {
                const storefrontUrl = await storefrontUrlForChannel(
                    ctx,
                    injector.get(TransactionalConnection),
                );
                return {
                    verifyEmailAddressUrl: `${storefrontUrl}/#/verify-account`,
                    passwordResetUrl: `${storefrontUrl}/#/reset-password`,
                    changeEmailAddressUrl: `${dashboardUrl}/change-email-address`,
                };
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
    const synchronize =
        process.env.DB_SYNCHRONIZE != null
            ? process.env.DB_SYNCHRONIZE === 'true'
            : !IS_PRODUCTION && dbType !== 'sqlite';
    switch (dbType) {
        case 'postgres':
            console.log('Using postgres connection');
            return {
                synchronize,
                type: 'postgres',
                host: process.env.DB_HOST || 'localhost',
                port: Number(process.env.DB_PORT) || 5432,
                username: configuredValue('DB_USERNAME', 'vendure'),
                password: configuredValue('DB_PASSWORD', 'password'),
                database: configuredValue('DB_NAME', 'vendure-dev'),
                schema: process.env.DB_SCHEMA || 'public',
            };
        case 'sqlite':
            console.log('Using sqlite connection');
            return {
                synchronize: false,
                type: 'better-sqlite3',
                database: process.env.DB_NAME || path.join(serverRoot, 'vendure.sqlite'),
            };
        case 'sqljs':
            console.log('Using sql.js connection');
            return {
                type: 'sqljs',
                autoSave: true,
                database: new Uint8Array([]),
                location: process.env.DB_NAME || path.join(serverRoot, 'vendure.sqlite'),
            };
        case 'mysql':
        case 'mariadb':
        default:
            console.log('Using mysql connection');
            return {
                synchronize,
                type: 'mariadb',
                host: process.env.DB_HOST || '127.0.0.1',
                port: Number(process.env.DB_PORT) || 3306,
                username: configuredValue('DB_USERNAME', 'vendure'),
                password: configuredValue('DB_PASSWORD', 'password'),
                database: configuredValue('DB_NAME', 'vendure-dev'),
            };
    }
}

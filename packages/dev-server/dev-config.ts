/* eslint-disable no-console */
import { OnApplicationBootstrap } from '@nestjs/common';
import { AssetServerPlugin, PresetOnlyStrategy } from '@vendure/asset-server-plugin';
import {
    AutoCardDeliveryReadyEvent,
    AutoCardService,
    CommerceFulfillmentPlugin,
    OrderConfirmationTokenService,
    summarizeOrderFulfillment,
} from '@vendure/commerce-fulfillment-plugin';
import { ADMIN_API_PATH, API_PORT, SHOP_API_PATH } from '@vendure/common/lib/shared-constants';
import {
    ContentTranslationPlugin,
    GoogleCloudTranslationProvider,
} from '@vendure/content-translation-plugin';
import {
    DefaultJobQueuePlugin,
    DefaultLogger,
    DefaultPasswordValidationStrategy,
    DefaultProductVariantPriceUpdateStrategy,
    DefaultSchedulerPlugin,
    DefaultSearchPlugin,
    dummyPaymentHandler,
    Injector,
    LanguageCode,
    LogLevel,
    OrderStateTransitionEvent,
    PluginCommonModule,
    RequestContext,
    RequestContextService,
    SettingsStoreService,
    ShippingLine,
    TransactionalConnection,
    VendureConfig,
    VendurePlugin,
} from '@vendure/core';
import { DashboardPlugin } from '@vendure/dashboard/plugin';
import {
    defaultEmailHandlers,
    EmailEventHandlerWithAsyncData,
    EmailEventListener,
    EmailPlugin,
    type EmailPluginDevModeOptions,
    type EmailPluginOptions,
    type EventWithAsyncData,
    FileBasedTemplateLoader,
} from '@vendure/email-plugin';
import { HardenPlugin } from '@vendure/harden-plugin';
import { OperationsDashboardPlugin } from '@vendure/operations-dashboard-plugin';
import { StoreDomain, StoreDomainPlugin, type StoreDomainRoutingMode } from '@vendure/store-domain-plugin';
import { StoreManagementPlugin } from '@vendure/store-management-plugin';
import { StorefrontCartPlugin } from '@vendure/storefront-cart-plugin';
import { StorefrontCatalogPlugin } from '@vendure/storefront-catalog-plugin';
import { StorefrontContentPlugin } from '@vendure/storefront-content-plugin';
import { StorefrontReviewPlugin } from '@vendure/storefront-review-plugin';
import 'dotenv/config';
import { createRequire } from 'node:module';
import path from 'path';
import { DataSourceOptions } from 'typeorm';
import './business-time';

import {
    ACCOUNT_TOKEN_DURATION,
    ACCOUNT_TOKEN_EXPIRY_HOURS,
    buildAccountActionUrl,
    buildSignedStorefrontAccountActionUrl,
} from './account-auth';
import { emailLanguageVariables, localizedEmailSubjects, localizedEmailText } from './email-localization';
import { devServerMigrations } from './migrations';
import {
    buildOrderConfirmationUrl,
    normalizeDeliveryEmail,
    orderConfirmationRecipient,
} from './order-confirmation-email';
import { StorefrontNativeAuthenticationStrategy } from './storefront-native-authentication-strategy';
// import { FieldTestPlugin } from './test-plugins/field-test/field-test-plugin';

const IS_PRODUCTION = process.env.NODE_ENV === 'production';
const IS_INSTRUMENTED = process.env.IS_INSTRUMENTED === 'true';
const BOOTSTRAP_BASE_SCHEMA = process.env.VENDURE_BOOTSTRAP_BASE_SCHEMA === 'true';
const contentTranslationApiKey = BOOTSTRAP_BASE_SCHEMA
    ? ''
    : configuredValue('VENDURE_GOOGLE_TRANSLATION_API_KEY', '');
const SERVE_GRAPHIQL =
    process.env.VENDURE_SERVE_GRAPHIQL != null
        ? process.env.VENDURE_SERVE_GRAPHIQL === 'true'
        : !IS_PRODUCTION;
if (IS_PRODUCTION && SERVE_GRAPHIQL) {
    throw new Error('VENDURE_SERVE_GRAPHIQL must be false in production');
}
const SERVE_STATIC_DASHBOARD = process.env.VENDURE_SERVE_STATIC_DASHBOARD !== 'false';
if (IS_PRODUCTION) {
    configuredValue('ORDER_CONFIRMATION_TOKEN_SECRET', '');
}
const loadPackage = createRequire(__filename);
const serverRoot = path.basename(__dirname) === 'dist' ? path.dirname(__dirname) : __dirname;
const dashboardUrl = configuredUrl('VENDURE_DASHBOARD_URL', 'http://localhost:3000/dashboard');
const storefrontFallbackUrl = configuredUrl('VENDURE_STOREFRONT_URL', 'http://127.0.0.1:5175');
const storefrontPromotionGateEnabled =
    process.env.STOREFRONT_PROMOTION_GATE_ENABLED != null
        ? process.env.STOREFRONT_PROMOTION_GATE_ENABLED === 'true'
        : IS_PRODUCTION;
if (IS_PRODUCTION && !storefrontPromotionGateEnabled) {
    throw new Error('STOREFRONT_PROMOTION_GATE_ENABLED must be true in production');
}
const storefrontEntrySecret = configuredValue(
    'STOREFRONT_ENTRY_SECRET',
    'development-storefront-entry-secret',
);
const dashboardAppDir =
    path.basename(__dirname) === 'dist'
        ? path.join(__dirname, './dashboard')
        : path.join(__dirname, './dist/dashboard');
const corsOrigins = process.env.VENDURE_CORS_ORIGINS?.split(',')
    .map(origin => origin.trim())
    .filter(Boolean);
const autoCardDeliveryEmailHandler = new EmailEventListener('auto-card-delivery')
    .on(AutoCardDeliveryReadyEvent)
    .loadData(({ event, injector }) =>
        injector.get(AutoCardService).emailPayload(event.ctx, event.deliveryId),
    )
    .setRecipient(event => event.data.recipientEmail)
    .setFrom('{{ fromAddress }}')
    .setSubject(event =>
        event.data.isChinese ? '您购买的虚拟商品已自动发货' : 'Your digital credentials are ready',
    )
    .setTemplateVars(event => event.data)
    .setMetadata(event => ({
        type: 'auto-card-delivery',
        deliveryId: event.data.deliveryId,
    }));

const localizedEmailHandlers = [...defaultEmailHandlers, autoCardDeliveryEmailHandler].map(handler => {
    if (handler.type === 'order-confirmation') {
        type DefaultOrderEmailData = { shippingLines: ShippingLine[] };
        type StorefrontOrderEmailData = DefaultOrderEmailData & {
            isDigitalOrder: boolean;
            containsDigitalProducts: boolean;
            recipientEmail: string;
            digitalDeliveryActionUrl?: string;
        };
        type DefaultOrderEmailEvent = EventWithAsyncData<OrderStateTransitionEvent, DefaultOrderEmailData>;
        const orderHandler = handler as EmailEventHandlerWithAsyncData<
            DefaultOrderEmailData,
            'order-confirmation',
            OrderStateTransitionEvent,
            DefaultOrderEmailEvent
        >;
        const loadDefaultOrderData = orderHandler._loadDataFn.bind(orderHandler);
        orderHandler._loadDataFn = async context => {
            const data = await loadDefaultOrderData(context);
            const fulfillment = summarizeOrderFulfillment(context.event.order);
            const isDigitalOrder = fulfillment.fulfillmentType === 'DIGITAL';
            const containsDigitalProducts = fulfillment.containsDigitalProducts;
            const customerEmail = context.event.order.customer?.emailAddress;
            if (!customerEmail) {
                throw new Error('Order confirmation email requires an order customer email address');
            }
            const recipientEmail = orderConfirmationRecipient(
                containsDigitalProducts,
                context.event.order.customFields?.deliveryEmail,
                customerEmail,
            );
            let digitalDeliveryActionUrl: string | undefined;
            if (containsDigitalProducts) {
                const confirmation = context.injector
                    .get(OrderConfirmationTokenService)
                    .createForSettledOrder(context.event.ctx, {
                        id: context.event.order.id,
                        state: context.event.toState,
                    });
                const storefrontUrl = await storefrontUrlForChannel(
                    context.event.ctx,
                    context.injector.get(TransactionalConnection),
                );
                digitalDeliveryActionUrl = buildOrderConfirmationUrl(
                    storefrontUrl,
                    context.event.order.code,
                    confirmation.token,
                );
            }
            return {
                ...data,
                isDigitalOrder,
                containsDigitalProducts,
                recipientEmail,
                digitalDeliveryActionUrl,
            } satisfies StorefrontOrderEmailData;
        };
        orderHandler.setRecipient(event => {
            const data = event.data as StorefrontOrderEmailData;
            return data.recipientEmail;
        });
        orderHandler.setTemplateVars(event => {
            const data = event.data as StorefrontOrderEmailData;
            return {
                order: event.order,
                shippingLines: data.shippingLines,
                isDigitalOrder: data.isDigitalOrder,
                containsDigitalProducts: data.containsDigitalProducts,
                digitalDeliveryActionUrl: data.digitalDeliveryActionUrl,
            };
        });
    } else if (handler.type === 'email-verification') {
        handler.setTemplateVars((event, globals) => ({
            verifyEmailAddressActionUrl: buildSignedStorefrontAccountActionUrl(
                globals.verifyEmailAddressUrl,
                event.user.getNativeAuthenticationMethod().verificationToken,
                storefrontEntrySecret,
            ),
        }));
    } else if (handler.type === 'password-reset') {
        handler.setTemplateVars((event, globals) => ({
            passwordResetActionUrl: buildSignedStorefrontAccountActionUrl(
                globals.passwordResetUrl,
                event.user.getNativeAuthenticationMethod().passwordResetToken,
                storefrontEntrySecret,
            ),
        }));
    } else if (handler.type === 'email-address-change') {
        handler.setTemplateVars((event, globals) => ({
            changeEmailAddressActionUrl: buildAccountActionUrl(
                globals.changeEmailAddressUrl,
                event.user.getNativeAuthenticationMethod().identifierChangeToken,
            ),
        }));
    }
    const subjects = localizedEmailSubjects[handler.type];
    return subjects
        ? handler.setSubject((_event, ctx) => localizedEmailText(subjects, ctx.languageCode))
        : handler;
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

function configuredPort(name: string, developmentDefault: number): number {
    const rawValue = configuredValue(name, String(developmentDefault));
    const value = Number(rawValue);
    if (!Number.isInteger(value) || value < 1 || value > 65535) {
        throw new Error(`${name} must be an integer between 1 and 65535`);
    }
    return value;
}

function configuredBoolean(name: string, developmentDefault: boolean): boolean {
    const value = configuredValue(name, String(developmentDefault)).toLowerCase();
    if (value === 'true') {
        return true;
    }
    if (value === 'false') {
        return false;
    }
    throw new Error(`${name} must be true or false`);
}

function configuredUrl(name: string, developmentDefault: string): string {
    const rawUrl = configuredValue(name, developmentDefault);
    let url: URL;
    try {
        url = new URL(rawUrl);
    } catch {
        throw new Error(`${name} must be a valid absolute URL`);
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        throw new Error(`${name} must use http or https`);
    }
    if (IS_PRODUCTION && url.protocol !== 'https:') {
        throw new Error(`${name} must use https in production`);
    }
    return url.toString().replace(/\/$/, '');
}

function configuredDirectory(name: string, developmentDefault: string): string {
    const configuredPath = configuredValue(name, developmentDefault);
    if (IS_PRODUCTION && !path.isAbsolute(configuredPath)) {
        throw new Error(`${name} must be an absolute path in production`);
    }
    const resolvedPath = path.resolve(serverRoot, configuredPath);
    if (IS_PRODUCTION && resolvedPath === path.parse(resolvedPath).root) {
        throw new Error(`${name} must not use the filesystem root`);
    }
    return resolvedPath;
}

const importAssetsDir = configuredDirectory(
    'VENDURE_IMPORT_ASSETS_DIR',
    path.join(serverRoot, 'import-assets'),
);
const assetUploadDir = configuredDirectory('VENDURE_ASSET_UPLOAD_DIR', path.join(serverRoot, 'assets'));

async function storefrontUrlForChannel(
    ctx: RequestContext,
    connection: TransactionalConnection,
): Promise<string> {
    const primaryDomain = await connection.getRepository(ctx, StoreDomain).findOne({
        where: { channelId: ctx.channelId, isPrimary: true, status: 'ACTIVE' },
    });
    return primaryDomain ? `https://${primaryDomain.domain}` : storefrontFallbackUrl;
}

async function emailTemplateVars(ctx: RequestContext, injector: Injector, fromAddress: string) {
    const storefrontUrl = await storefrontUrlForChannel(ctx, injector.get(TransactionalConnection));
    return {
        ...emailLanguageVariables(ctx.languageCode, ctx.channel.customFields),
        fromAddress,
        accountTokenExpiryHours: ACCOUNT_TOKEN_EXPIRY_HOURS,
        verifyEmailAddressUrl: `${storefrontUrl}/promo/account-entry?route=verify-account`,
        passwordResetUrl: `${storefrontUrl}/promo/account-entry?route=reset-password`,
        changeEmailAddressUrl: `${dashboardUrl}/change-email-address`,
    };
}

function emailPluginOptions(): EmailPluginOptions | EmailPluginDevModeOptions {
    const fromAddress = configuredValue('VENDURE_EMAIL_FROM', '"Yunqiao Ai" <noreply@example.com>');
    const commonOptions = {
        handlers: localizedEmailHandlers,
        templateLoader: new FileBasedTemplateLoader(path.join(serverRoot, 'email-templates')),
        globalTemplateVars: (ctx: RequestContext, injector: Injector) =>
            emailTemplateVars(ctx, injector, fromAddress),
    };
    if (!IS_PRODUCTION) {
        return {
            ...commonOptions,
            devMode: true,
            route: 'mailbox',
            outputPath: process.env.VENDURE_EMAIL_OUTPUT_DIR || path.join(serverRoot, 'test-emails'),
        };
    }

    const smtpUser = process.env.SMTP_USER?.trim();
    const smtpPassword = process.env.SMTP_PASSWORD?.trim();
    if (!smtpUser || !smtpPassword) {
        throw new Error('SMTP_USER and SMTP_PASSWORD must both be configured in production');
    }

    const smtpHost = configuredValue('SMTP_HOST', '127.0.0.1');
    const smtpPort = configuredPort('SMTP_PORT', 1025);
    const smtpSecure = configuredBoolean('SMTP_SECURE', false);
    if (smtpHost.toLowerCase() === 'smtp.resend.com') {
        const validTlsMode =
            (smtpSecure && (smtpPort === 465 || smtpPort === 2465)) ||
            (!smtpSecure && (smtpPort === 25 || smtpPort === 587 || smtpPort === 2587));
        if (smtpUser !== 'resend') {
            throw new Error('SMTP_USER must be resend when SMTP_HOST is smtp.resend.com');
        }
        if (!validTlsMode) {
            throw new Error('SMTP_PORT and SMTP_SECURE do not form a supported Resend TLS configuration');
        }
    }

    return {
        ...commonOptions,
        transport: {
            type: 'smtp',
            host: smtpHost,
            port: smtpPort,
            secure: smtpSecure,
            requireTLS: !smtpSecure,
            auth: {
                user: smtpUser,
                pass: smtpPassword,
            },
        },
    };
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

function validateOrderDeliveryEmail(value: string) {
    if (value && !normalizeDeliveryEmail(value)) {
        return [
            { languageCode: LanguageCode.zh_Hans, value: '请填写有效的交付邮箱' },
            { languageCode: LanguageCode.en, value: 'Enter a valid delivery email address' },
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
        verificationTokenDuration: ACCOUNT_TOKEN_DURATION,
        shopAuthenticationStrategy: [new StorefrontNativeAuthenticationStrategy()],
        passwordValidationStrategy: new DefaultPasswordValidationStrategy({ minLength: 8, maxLength: 72 }),
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
        paymentMethodHandlers: IS_PRODUCTION ? [] : [dummyPaymentHandler],
    },
    catalogOptions: {
        productVariantPriceUpdateStrategy: new DefaultProductVariantPriceUpdateStrategy({
            syncPricesAcrossChannels: true,
        }),
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
            {
                name: 'deliveryEmail',
                type: 'string',
                length: 254,
                nullable: true,
                public: true,
                validate: validateOrderDeliveryEmail,
                label: [
                    { languageCode: LanguageCode.zh_Hans, value: '数字商品交付邮箱' },
                    { languageCode: LanguageCode.en, value: 'Digital delivery email' },
                ],
                description: [
                    {
                        languageCode: LanguageCode.zh_Hans,
                        value: '用于接收数字商品订单确认与安全领取入口',
                    },
                    {
                        languageCode: LanguageCode.en,
                        value: 'Receives the digital order confirmation and secure delivery link',
                    },
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
                // Storefront names are maintained in the dedicated store profile page,
                // where Chinese is the source and English is generated on save. Hiding
                // these raw fields avoids presenting a second bilingual entry point in
                // the generic Channel form while keeping them available to the APIs.
                ui: { dashboard: false },
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
                ui: { dashboard: false },
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
            {
                name: 'isStoreProvisioningTemplate',
                type: 'boolean',
                nullable: false,
                defaultValue: false,
                public: false,
                label: [
                    { languageCode: LanguageCode.zh_Hans, value: '可作为开店配置模板' },
                    { languageCode: LanguageCode.en, value: 'Use as store provisioning template' },
                ],
                description: [
                    {
                        languageCode: LanguageCode.zh_Hans,
                        value: '允许平台管理员基于此 Channel 的语言、币种、税务、库存、支付和配送配置创建新网店',
                    },
                    {
                        languageCode: LanguageCode.en,
                        value: 'Allows platform administrators to provision stores from this Channel configuration',
                    },
                ],
            },
            {
                name: 'currencySelectorEnabled',
                type: 'boolean',
                nullable: false,
                defaultValue: true,
                public: false,
                ui: { dashboard: false },
                label: [
                    { languageCode: LanguageCode.zh_Hans, value: '客户端币种切换' },
                    { languageCode: LanguageCode.en, value: 'Storefront currency selector' },
                ],
            },
            {
                name: 'currencyRateMode',
                type: 'string',
                length: 16,
                nullable: false,
                defaultValue: 'AUTO',
                public: false,
                ui: { dashboard: false },
                label: [
                    { languageCode: LanguageCode.zh_Hans, value: '汇率模式' },
                    { languageCode: LanguageCode.en, value: 'Exchange-rate mode' },
                ],
            },
            {
                name: 'cnyToMyrRate',
                type: 'float',
                nullable: true,
                public: false,
                ui: { dashboard: false },
                label: [
                    { languageCode: LanguageCode.zh_Hans, value: '人民币兑马币汇率' },
                    { languageCode: LanguageCode.en, value: 'CNY to MYR rate' },
                ],
            },
            {
                name: 'currencyRateMarkupBps',
                type: 'int',
                nullable: false,
                defaultValue: 0,
                public: false,
                ui: { dashboard: false },
                label: [
                    { languageCode: LanguageCode.zh_Hans, value: '汇率加价基点' },
                    { languageCode: LanguageCode.en, value: 'Exchange-rate markup (bps)' },
                ],
            },
            {
                name: 'currencyRoundingMode',
                type: 'string',
                length: 16,
                nullable: false,
                defaultValue: 'CENT',
                public: false,
                ui: { dashboard: false },
                label: [
                    { languageCode: LanguageCode.zh_Hans, value: '换算价格取整' },
                    { languageCode: LanguageCode.en, value: 'Converted-price rounding' },
                ],
            },
            {
                name: 'currencyRateSource',
                type: 'string',
                length: 120,
                nullable: true,
                public: false,
                ui: { dashboard: false },
                label: [
                    { languageCode: LanguageCode.zh_Hans, value: '汇率数据来源' },
                    { languageCode: LanguageCode.en, value: 'Exchange-rate source' },
                ],
            },
            {
                name: 'currencyRateUpdatedAt',
                type: 'datetime',
                nullable: true,
                public: false,
                ui: { dashboard: false },
                label: [
                    { languageCode: LanguageCode.zh_Hans, value: '汇率更新时间' },
                    { languageCode: LanguageCode.en, value: 'Exchange rate updated at' },
                ],
            },
            {
                name: 'currencyPricesUpdatedAt',
                type: 'datetime',
                nullable: true,
                public: false,
                ui: { dashboard: false },
                label: [
                    { languageCode: LanguageCode.zh_Hans, value: '币种价格同步时间' },
                    { languageCode: LanguageCode.en, value: 'Currency prices updated at' },
                ],
            },
            {
                name: 'currencySyncedPriceCount',
                type: 'int',
                nullable: false,
                defaultValue: 0,
                public: false,
                ui: { dashboard: false },
                label: [
                    { languageCode: LanguageCode.zh_Hans, value: '最近同步价格数' },
                    { languageCode: LanguageCode.en, value: 'Last synced price count' },
                ],
            },
        ],
    },
    logger: new DefaultLogger({ level: IS_PRODUCTION ? LogLevel.Info : LogLevel.Verbose }),
    importExportOptions: {
        importAssetsDir,
    },
    plugins: [
        // MultivendorPlugin.init({
        //     platformFeePercent: 10,
        //     platformFeeSKU: 'FEE',
        // }),
        ...(!IS_PRODUCTION && !BOOTSTRAP_BASE_SCHEMA ? [ReadonlySettingsTestPlugin] : []),
        ...(IS_PRODUCTION
            ? [
                  HardenPlugin.init({
                      apiMode: 'prod',
                      hideFieldSuggestions: true,
                      maxQueryComplexity: productionQueryComplexity(),
                  }),
              ]
            : []),
        // FieldTestPlugin,
        OperationsDashboardPlugin,
        ...(!BOOTSTRAP_BASE_SCHEMA
            ? [
                  ContentTranslationPlugin.init({
                      provider: new GoogleCloudTranslationProvider({
                          apiKey: contentTranslationApiKey,
                      }),
                      glossary: {
                          大马通: 'Damatong',
                          'ChatGPT- plus': 'ChatGPT Plus',
                          ChatGPT: 'ChatGPT',
                          Codex: 'Codex',
                      },
                  }),
                  CommerceFulfillmentPlugin,
                  StoreManagementPlugin.init({
                      enabled: storefrontPromotionGateEnabled,
                      signingSecret: storefrontEntrySecret,
                      secureCookie: IS_PRODUCTION,
                      trustProxyHeaders: process.env.STORE_DOMAIN_TRUST_PROXY === 'true',
                      bypassHosts: storeDomainBypassHosts(),
                  }),
                  StorefrontCatalogPlugin,
                  StorefrontCartPlugin,
                  StorefrontContentPlugin,
                  StorefrontReviewPlugin,
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
            assetUploadDir,
            presets: [
                { name: 'storefront-original-preview', width: 1600, height: 1600, mode: 'resize' },
                { name: 'storefront-placeholder-square-48', width: 48, height: 48, mode: 'crop' },
                { name: 'storefront-placeholder-wide-64', width: 64, height: 32, mode: 'crop' },
                { name: 'storefront-thumbnail-160', width: 160, height: 160, mode: 'crop' },
                { name: 'storefront-thumbnail-320', width: 320, height: 320, mode: 'crop' },
                // Keep legacy card presets available while older storefront bundles are still cached.
                { name: 'storefront-card-320', width: 320, height: 280, mode: 'crop' },
                { name: 'storefront-card-640', width: 640, height: 560, mode: 'crop' },
                { name: 'storefront-card-square-320', width: 320, height: 320, mode: 'resize' },
                { name: 'storefront-card-square-640', width: 640, height: 640, mode: 'resize' },
                { name: 'storefront-card-square-960', width: 960, height: 960, mode: 'resize' },
                { name: 'storefront-hero-480', width: 480, height: 240, mode: 'crop' },
                { name: 'storefront-hero-960', width: 960, height: 480, mode: 'crop' },
                { name: 'storefront-hero-1440', width: 1440, height: 720, mode: 'crop' },
                { name: 'storefront-hero-1600', width: 1600, height: 800, mode: 'crop' },
                { name: 'storefront-detail-640', width: 640, height: 640, mode: 'resize' },
                { name: 'storefront-detail-1200', width: 1200, height: 1200, mode: 'resize' },
                { name: 'storefront-detail-1600', width: 1600, height: 1600, mode: 'resize' },
            ],
            imageTransformStrategy: new PresetOnlyStrategy({
                defaultPreset: 'storefront-original-preview',
                permittedQuality: [75, 90],
                permittedFormats: ['webp'],
            }),
        }),
        DefaultSearchPlugin.init({ bufferUpdates: false, indexStockStatus: true }),
        // Enable if you need to debug the job queue
        // BullMQJobQueuePlugin.init({}),
        DefaultJobQueuePlugin.init({}),
        // JobQueueTestPlugin.init({ queueCount: 10 }),
        DefaultSchedulerPlugin.init({}),
        EmailPlugin.init(emailPluginOptions()),
        ...(IS_INSTRUMENTED ? [loadPackage('@vendure/telemetry-plugin').TelemetryPlugin.init({})] : []),
        SERVE_STATIC_DASHBOARD
            ? DashboardPlugin.init({
                  route: 'dashboard',
                  appDir: dashboardAppDir,
              })
            : DashboardPlugin,
    ],
};

function productionQueryComplexity(): number {
    const value = Number(process.env.VENDURE_MAX_QUERY_COMPLEXITY ?? 1_000);
    if (!Number.isInteger(value) || value < 100 || value > 5_000) {
        throw new Error('VENDURE_MAX_QUERY_COMPLEXITY must be an integer between 100 and 5000');
    }
    return value;
}

function getDbConfig(): DataSourceOptions {
    const dbType = process.env.DB || 'mysql';
    const supportedDbTypes = ['mysql', 'mariadb', 'postgres', 'sqlite', 'sqljs'];
    if (!supportedDbTypes.includes(dbType)) {
        throw new Error(`DB must be one of: ${supportedDbTypes.join(', ')}`);
    }
    if (IS_PRODUCTION && (dbType === 'sqlite' || dbType === 'sqljs')) {
        throw new Error('Production must use mysql, mariadb, or postgres instead of a file database');
    }
    const synchronize =
        process.env.DB_SYNCHRONIZE != null
            ? process.env.DB_SYNCHRONIZE === 'true'
            : !IS_PRODUCTION && dbType !== 'sqlite';
    if (IS_PRODUCTION && synchronize) {
        throw new Error('DB_SYNCHRONIZE must be false in production');
    }
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
                timezone: 'Z',
            };
    }
}

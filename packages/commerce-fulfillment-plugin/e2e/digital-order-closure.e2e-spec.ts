import { Args, Mutation, Resolver } from '@nestjs/graphql';
import { CatalogManagementPlugin } from '@vendure/catalog-management-plugin';
import { CurrencyCode, GlobalFlag, LanguageCode, Permission } from '@vendure/common/lib/generated-types';
import { ContentTranslationPlugin } from '@vendure/content-translation-plugin';
import {
    Allow,
    ChannelService,
    Ctx,
    CustomerService,
    DefaultLogger,
    EventBus,
    Fulfillment,
    ID,
    LogLevel,
    Order,
    OrderLine,
    OrderService,
    Payment,
    PaymentMethod,
    PaymentMethodHandler,
    PaymentMethodService,
    PluginCommonModule,
    ProductService,
    ProductVariantService,
    Refund,
    RequestContext,
    RequestContextService,
    Role,
    RoleService,
    ShippingMethodService,
    StockLocationService,
    Transaction,
    TransactionalConnection,
    User,
    UserInputError,
    VendurePlugin,
    mergeConfig,
} from '@vendure/core';
import { EmailSendEvent } from '@vendure/email-plugin';
import { OperationsDashboardPlugin } from '@vendure/operations-dashboard-plugin';
import { StorefrontCartPlugin } from '@vendure/storefront-cart-plugin';
import { SimpleGraphQLClient, createTestEnvironment } from '@vendure/testing';
import { print } from 'graphql';
import gql from 'graphql-tag';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Subscription } from 'rxjs';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { initialData } from '../../../e2e-common/e2e-initial-data';
import { TEST_SETUP_TIMEOUT_MS, testConfig } from '../../../e2e-common/test-config';
import { AdministratorAccessService } from '../../store-management-plugin/src/administrator-access.service';
import { ReferralWalletUsage } from '../../store-management-plugin/src/entities/referral-wallet-usage.entity';
import { ReferralWallet } from '../../store-management-plugin/src/entities/referral-wallet.entity';
import { StoreProfile } from '../../store-management-plugin/src/entities/store-profile.entity';
import { StorefrontUsdtPaymentIntent } from '../../store-management-plugin/src/entities/storefront-usdt-payment-intent.entity';
import { ReferralService } from '../../store-management-plugin/src/referral/referral.service';
import { StoreManagementPlugin } from '../../store-management-plugin/src/store-management.plugin';
import {
    UsdtPaymentService,
    findMatchingTransfer,
} from '../../store-management-plugin/src/usdt/usdt-payment.service';
import { UsdtTrc20Client } from '../../store-management-plugin/src/usdt/usdt-trc20-client';
import { fingerprintReceivingAddress } from '../../store-management-plugin/src/usdt/usdt-wallet-configuration.service';
import { AutoCardDeliveryReadyEvent } from '../src/auto-card-delivery.event';
import { readSoldAutoCardsPermission } from '../src/auto-card.constants';
import { AutoCardService } from '../src/auto-card.service';
import { CommerceFulfillmentPlugin } from '../src/commerce-fulfillment.plugin';
import { CommerceModeService } from '../src/commerce-mode.service';
import { DigitalDeliveryTokenService } from '../src/digital-delivery-token.service';
import { AutoCardDeliveryEvent } from '../src/entities/auto-card-delivery-event.entity';
import { AutoCardDelivery } from '../src/entities/auto-card-delivery.entity';
import { AutoCardPoolItem } from '../src/entities/auto-card-pool-item.entity';
import {
    DigitalOrderReservation,
    DigitalReceiptAccess,
    DigitalVariantConfig,
} from '../src/entities/digital-product.entity';
import { ManualDigitalDeliveryEvent } from '../src/entities/manual-digital-delivery-event.entity';
import { ManualDigitalDelivery } from '../src/entities/manual-digital-delivery.entity';
import { ManualDigitalDeliveryReadyEvent } from '../src/manual-digital-delivery.event';
import { OrderConfirmationTokenService } from '../src/order-confirmation-token.service';

import { closureDatabase } from './order-closure-db';
// All payment providers and identities are synthetic; production database access is refused.
const root = path.resolve(__dirname, '../../../');
const fixtureRoot = path.join(root, 'reports/digital-order-closure-e2e');
const database = closureDatabase(path.join(fixtureRoot, 'sqljs-' + randomUUID()));
const privateRoot = path.join(fixtureRoot, 'private-storage');
const apiOrigin = 'http://localhost:37394';
const envNames = [
    'DIGITAL_DELIVERY_ROOT',
    'DIGITAL_DELIVERY_SIGNING_SECRET',
    'AUTO_CARD_ENCRYPTION_KEY',
    'STOREFRONT_USDT_TRC20_RECEIVING_ADDRESS',
    'STOREFRONT_USDT_TRC20_ADDRESS_SHA256',
    'USDT_WALLET_ENCRYPTION_KEY',
] as const;
const previousEnv = Object.fromEntries(envNames.map(name => [name, process.env[name]]));
process.env.DIGITAL_DELIVERY_ROOT = privateRoot;
process.env.DIGITAL_DELIVERY_SIGNING_SECRET = randomBytes(32).toString('base64url');
process.env.AUTO_CARD_ENCRYPTION_KEY = randomBytes(32).toString('base64url');
// Non-spendable public fixture address; all chain responses below are supplied locally.
process.env.STOREFRONT_USDT_TRC20_RECEIVING_ADDRESS = 'T9yD14Nj9j7xAB4dbGeiX9h8unkKHxuWwb';
process.env.STOREFRONT_USDT_TRC20_ADDRESS_SHA256 = fingerprintReceivingAddress(
    process.env.STOREFRONT_USDT_TRC20_RECEIVING_ADDRESS,
);
process.env.USDT_WALLET_ENCRYPTION_KEY = randomBytes(32).toString('base64url');
let providerCalls = 0;
const authorizationFrames: string[] = [];
class SyntheticDiagnosticLogger extends DefaultLogger {
    debug(message: string, context?: string): void {
        if (/error\.forbidden/.test(message)) authorizationFrames.push(message);
        // Keep all routine debug messages and request data out of the fixture report.
    }
}
function syntheticHandler(code: string, pending = false) {
    return new PaymentMethodHandler({
        code,
        description: [{ languageCode: LanguageCode.en, value: 'Synthetic digital closure provider' }],
        args: {},
        createPayment: (_ctx, order, amount) => ({
            amount,
            state: 'Settled',
            transactionId: 'LOCAL-DIGITAL-PAYMENT-' + order.code,
            metadata: {},
        }),
        settlePayment: () => ({ success: true }),
        cancelPayment: () => ({ success: true }),
        refundSettlementMode: 'automatic',
        createRefund: () => {
            providerCalls++;
            return {
                state: pending ? ('Pending' as const) : ('Settled' as const),
                transactionId: pending ? undefined : 'LOCAL-DIGITAL-REFUND-' + providerCalls,
                metadata: {},
            };
        },
    });
}
const settledProvider = syntheticHandler('closure-digital-settled');
const pendingProvider = syntheticHandler('closure-digital-pending', true);
/** Test-only provider callback; invokes the actual locked core transition and settlement validation. */
@Resolver()
class SyntheticDigitalRefundCallbackResolver {
    constructor(
        private readonly connectionScoped: TransactionalConnection,
        private readonly orders: OrderService,
    ) {}
    @Mutation()
    @Transaction()
    @Allow(Permission.SuperAdmin)
    async syntheticDigitalRefundCallback(
        @Ctx()
        ctx: RequestContext,
        @Args('refundId')
        id: ID,
        @Args('state')
        state: string,
    ) {
        const refundScoped = await this.connectionScoped.getEntityOrThrow(ctx, Refund, id, {
            relations: ['payment', 'payment.order'],
        });
        if (refundScoped.payment.method !== pendingProvider.code)
            throw new UserInputError('Synthetic provider callback method mismatch');
        if (state === 'Failed') return this.orders.transitionRefundToState(ctx, id, 'Failed');
        if (state !== 'Settled') throw new UserInputError('Unsupported synthetic provider callback');
        const transactionId = 'LOCAL-DIGITAL-CALLBACK-' + String(refundScoped.id);
        return this.orders.settleRefund(
            ctx,
            { id, transactionId },
            {
                source: 'provider-callback',
                paymentId: refundScoped.payment.id,
                amount: refundScoped.total,
                transactionId,
                evidenceReference: 'synthetic-local://digital-refund/' + String(refundScoped.id),
            },
        );
    }
}
@VendurePlugin({
    imports: [PluginCommonModule],
    adminApiExtensions: {
        schema: gql`
            extend type Mutation {
                syntheticDigitalRefundCallback(refundId: ID!, state: String!): Refund!
            }
        `,
        resolvers: [SyntheticDigitalRefundCallbackResolver],
    },
})
class SyntheticDigitalProviderPlugin {}
const config = mergeConfig(testConfig(), {
    apiOptions: { port: 37394, hostname: '127.0.0.1', shopApiDebug: true },
    dbConnectionOptions: database,
    defaultLanguageCode: LanguageCode.zh_Hans,
    logger: new SyntheticDiagnosticLogger({ level: LogLevel.Error }),
    paymentOptions: { paymentMethodHandlers: [settledProvider, pendingProvider] },
    customFields: {
        Channel: [
            { name: 'usdtDisplayEnabled', type: 'boolean', defaultValue: true },
            { name: 'cnyPerUsdtRate', type: 'float', nullable: true },
            { name: 'usdtRateUpdatedAt', type: 'datetime', nullable: true },
        ],
        Order: [
            { name: 'customerNote', type: 'text', nullable: true, public: true },
            { name: 'deliveryEmail', type: 'string', length: 254, nullable: true, public: true },
            { name: 'deliveryEmailContactId', type: 'string', length: 64, nullable: true, public: false },
        ],
    },
    plugins: [
        OperationsDashboardPlugin,
        CatalogManagementPlugin,
        StorefrontCartPlugin,
        ContentTranslationPlugin.init({
            provider: {
                name: 'synthetic-no-network',
                isConfigured: () => true,
                translate: request =>
                    Promise.resolve({
                        provider: 'synthetic-no-network',
                        translations: request.segments.map(segment => ({
                            key: segment.key,
                            text: segment.text,
                        })),
                    }),
            },
        }),
        StoreManagementPlugin.init({ enabled: false, signingSecret: randomUUID() }),
        CommerceFulfillmentPlugin.init({
            testPaymentsEnabled: false,
            evidenceStorage: {
                rootDirectory: path.join(fixtureRoot, 'evidence'),
                signingSecret: randomUUID(),
            },
        }),
        SyntheticDigitalProviderPlugin,
    ],
});
const { server, adminClient } = createTestEnvironment(config);
const idStrategy = config.entityOptions.entityIdStrategy;
const superadmin = config.authOptions.superadminCredentials;
if (!idStrategy || !superadmin) throw new Error('Missing synthetic test identity');
const encode = (id: ID) => idStrategy.encodeId(id);
const decode = (id: string) => idStrategy.decodeId(id);
const adminUrl = apiOrigin + '/' + config.apiOptions.adminApiPath;
const shopUrl = apiOrigin + '/' + config.apiOptions.shopApiPath;
const reader = new SimpleGraphQLClient(config, adminUrl);
const revealer = new SimpleGraphQLClient(config, adminUrl);
let connection: TransactionalConnection;
let own: RequestContext;
let foreign: RequestContext;
let platformContext: RequestContext;
let locationId: ID;
let shippingMethodId: ID;
const subscriptions: Subscription[] = [];
const notices: Array<{
    kind: string;
    deliveryId: string;
}> = [];
type Mode = 'manual_service' | 'auto_card' | 'file_download';
const orderFields = `id code state totalWithTax lines { id quantity productVariant { id } }
    payments { id amount state } fulfillments { id state lines { orderLineId quantity } }
    manualDigitalDeliveries { id state quantity }`;
const contentFields = `orderLineId mode state eligibleQuantity readyQuantity claimedQuantity notificationState
    instructions packages { number note fields { label value } attachments { name downloadUrl } } downloadUrl`;
const getContents = gql`query($orderId: ID!, $confirmationToken: String) {
    myDigitalDeliveryContents(orderId: $orderId, confirmationToken: $confirmationToken) { ${contentFields} }
}`;
const claimContents = gql`mutation($orderId: ID!, $orderLineId: ID!, $confirmationToken: String) {
    claimDigitalDelivery(orderId: $orderId, orderLineId: $orderLineId, confirmationToken: $confirmationToken) { ${contentFields} }
}`;
const readOrder = gql`query($id: ID!) { order(id: $id) { ${orderFields} } }`;
const readManual = gql`
    query ($id: ID!) {
        manualDigitalDelivery(id: $id) {
            id
            state
            quantity
            hasContent
            packages {
                fields {
                    value
                }
            }
        }
    }
`;
const publishManual = gql`
    mutation ($input: SaveManualDigitalDeliveryInput!) {
        publishManualDigitalDelivery(input: $input) {
            id
            state
            quantity
            hasContent
            packages {
                fields {
                    value
                }
            }
        }
    }
`;
const revealManual = gql`
    mutation ($id: ID!) {
        revealMyManualDigitalDelivery(id: $id) {
            id
            hasContent
            packages {
                fields {
                    key
                    label
                    value
                    secret
                }
                note
            }
        }
    }
`;
const revealCards = gql`
    mutation ($id: ID!) {
        revealMyOrderAutoCards(deliveryId: $id) {
            key
            value
            secret
        }
    }
`;
const refundMutation = gql`
    mutation ($input: RefundOrderInput!) {
        refundOrder(input: $input) {
            ... on Refund {
                id
                state
                total
            }
            ... on ErrorResult {
                errorCode
                message
            }
        }
    }
`;
async function query(
    client: SimpleGraphQLClient,
    document: ReturnType<typeof gql>,
    variables?: Record<string, unknown>,
) {
    try {
        return await client.query(document, variables);
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Local GraphQL request failed';
        const code = (
            error as {
                response?: {
                    errors?: Array<{
                        extensions?: {
                            code?: string;
                        };
                    }>;
                };
            }
        ).response?.errors?.[0]?.extensions?.code;
        throw new Error(
            message +
                (code === 'FORBIDDEN'
                    ? '\n' + (authorizationFrames[authorizationFrames.length - 1] ?? '')
                    : ''),
        );
    }
}
function shop() {
    const client = new SimpleGraphQLClient(config, shopUrl);
    client.setChannelToken(own.channel.token);
    return client;
}
async function scan(
    client: SimpleGraphQLClient,
    document: ReturnType<typeof gql>,
    variables: Record<string, unknown>,
) {
    const parameters = new URLSearchParams({ query: print(document), variables: JSON.stringify(variables) });
    const response = await client.fetch(
        (client === reader ? adminUrl : shopUrl) + '?' + parameters.toString(),
        {
            method: 'GET',
        },
    );
    const payload = (await response.json()) as {
        data?: any;
        errors?: Array<{
            message: string;
        }>;
    };
    if (!response.ok || payload.errors) throw new Error(payload.errors?.[0]?.message ?? 'Local GET failed');
    return payload.data;
}
const packages = (quantity: number) =>
    Array.from({ length: quantity }, (_, index) => ({
        note: 'Synthetic account ' + index,
        fields: [
            { key: 'account', label: '账号', value: 'synthetic-account-' + index, secret: false },
            { key: 'password', label: '密码', value: 'SYNTHETIC-CONTENT-' + index, secret: true },
        ],
    }));
beforeAll(async () => {
    await mkdir(privateRoot, { recursive: true });
    await server.init({
        initialData: {
            ...initialData,
            defaultLanguage: LanguageCode.zh_Hans,
            collections: [],
            paymentMethods: [],
        },
        customerCount: 1,
    });
    connection = server.app.get(TransactionalConnection);
    const contexts = server.app.get(RequestContextService);
    const user = await connection.rawConnection.getRepository(User).findOneOrFail({
        where: { identifier: superadmin.identifier },
        relations: ['roles', 'roles.channels'],
    });
    const platform = await contexts.create({ apiType: 'admin', user });
    platformContext = platform;
    await server.app.get(CommerceModeService).updateActiveMode(platform, 'HYBRID');
    const createChannel = async (code: string) => {
        const result = await server.app.get(ChannelService).create(platform, {
            code,
            token: code,
            defaultLanguageCode: LanguageCode.zh_Hans,
            currencyCode: CurrencyCode.CNY,
            pricesIncludeTax: true,
            defaultTaxZoneId: requireFixture(platform.channel.defaultTaxZone).id,
            defaultShippingZoneId: requireFixture(platform.channel.defaultShippingZone).id,
            customFields: { commerceMode: 'HYBRID', cnyPerUsdtRate: 7, usdtRateUpdatedAt: new Date() },
        });
        if (!('id' in result)) throw new Error(result.message);
        await connection
            .getRepository(platform, Role)
            .createQueryBuilder()
            .relation(Role, 'channels')
            .of(user.roles[0].id)
            .add(result.id);
        const roles = server.app.get(RoleService);
        await roles.assignRoleToChannel(platform, (await roles.getCustomerRole(platform)).id, result.id);
        return contexts.create({ apiType: 'admin', user, channelOrToken: result.token });
    };
    own = await createChannel('synthetic-digital-own');
    foreign = await createChannel('synthetic-digital-foreign');
    // Reload role memberships after the SQL relation changes before constructing service contexts.
    const currentUser = await connection.rawConnection.getRepository(User).findOneOrFail({
        where: { id: user.id },
        relations: ['roles', 'roles.channels'],
    });
    own = await contexts.create({ apiType: 'admin', user: currentUser, channelOrToken: own.channel.token });
    foreign = await contexts.create({
        apiType: 'admin',
        user: currentUser,
        channelOrToken: foreign.channel.token,
    });
    // An actual public store requires an ACTIVE profile. Seed that business precondition;
    // keep StorefrontActivationInterceptor and all permission checks enabled.
    for (const context of [own, foreign])
        await connection.getRepository(platform, StoreProfile).save(
            new StoreProfile({
                channelId: context.channelId,
                status: 'ACTIVE',
                isPublished: true,
                descriptionZh: '合成本地验收店铺',
                descriptionEn: 'Synthetic local API acceptance store',
            }),
        );
    locationId = (
        await server.app
            .get(StockLocationService)
            .create(own, { name: 'Synthetic digital migration location' })
    ).id;
    shippingMethodId = (
        await server.app.get(ShippingMethodService).create(own, {
            code: 'synthetic-digital-mixed-shipping',
            fulfillmentHandler: 'manual-fulfillment',
            checker: {
                code: 'supported-destination-eligibility-checker',
                arguments: [
                    { name: 'allowedCountryCodes', value: 'GB' },
                    { name: 'blockedPostalPrefixes', value: '' },
                ],
            },
            calculator: {
                code: 'physical-subtotal-shipping-calculator',
                arguments: [
                    { name: 'baseRate', value: '0' },
                    { name: 'freeAbove', value: '0' },
                    { name: 'currencyCode', value: 'CNY' },
                    { name: 'taxRate', value: '0' },
                    { name: 'priceIncludesTax', value: 'true' },
                    { name: 'estimateMinDays', value: '1' },
                    { name: 'estimateMaxDays', value: '3' },
                ],
            },
            translations: [
                {
                    languageCode: LanguageCode.zh_Hans,
                    name: 'Synthetic local shipping',
                    description: 'No physical shipping occurs',
                },
            ],
        })
    ).id;
    for (const handler of [settledProvider, pendingProvider]) {
        const method = await server.app.get(PaymentMethodService).create(platform, {
            code: handler.code,
            enabled: true,
            handler: { code: handler.code, arguments: [] },
            translations: [
                {
                    languageCode: LanguageCode.zh_Hans,
                    name: handler.code,
                    description: 'Synthetic local provider',
                },
            ],
        });
        await server.app
            .get(ChannelService)
            .assignToChannels(platform, PaymentMethod, method.id, [own.channelId]);
        await server.app.get(PaymentMethodService).setStorePaymentOptionEnabled(own, method.id, true);
    }
    await adminClient.asSuperAdmin();
    adminClient.setChannelToken(own.channel.token);
    adminClient.setRequestHeader('x-vendure-sensitive-action-password', superadmin.password);
    const createOperator = async (client: SimpleGraphQLClient, permissions: Permission[], name: string) => {
        const access = server.app.get(AdministratorAccessService);
        const role = await access.createManagedRole(platform, {
            code: name,
            description: 'Synthetic local role',
            permissions,
            scope: 'PLATFORM',
        });
        const password = 'Aa1!' + randomBytes(24).toString('base64url');
        const email = name + '@example.invalid';
        await access.createManagedAdministrator(platform, {
            firstName: 'Synthetic',
            lastName: name,
            emailAddress: email,
            password,
            roleIds: [role.id],
            scope: 'PLATFORM',
            authority: 'STAFF',
        });
        await client.asUserWithCredentials(email, password);
        const changedPassword = 'Aa1!' + randomBytes(24).toString('base64url');
        expect(
            (
                await query(
                    client,
                    gql`
                        mutation CompleteSyntheticInitialPassword($password: String!) {
                            completeInitialPasswordChange(password: $password) {
                                mustChangePassword
                            }
                        }
                    `,
                    { password: changedPassword },
                )
            ).completeInitialPasswordChange.mustChangePassword,
        ).toBe(false);
        await client.asUserWithCredentials(email, changedPassword);
        client.setChannelToken(own.channel.token);
    };
    await createOperator(reader, [Permission.ReadOrder], 'digital-reader');
    await createOperator(
        revealer,
        [Permission.ReadOrder, readSoldAutoCardsPermission.Permission],
        'digital-revealer',
    );
    const bus = server.app.get(EventBus);
    subscriptions.push(
        bus
            .ofType(ManualDigitalDeliveryReadyEvent)
            .subscribe(event => notices.push({ kind: 'manual', deliveryId: event.deliveryId })),
    );
    subscriptions.push(
        bus
            .ofType(AutoCardDeliveryReadyEvent)
            .subscribe(event => notices.push({ kind: 'card', deliveryId: event.deliveryId })),
    );
}, TEST_SETUP_TIMEOUT_MS);
afterAll(async () => {
    subscriptions.forEach(subscription => subscription.unsubscribe());
    await server.destroy();
    envNames.forEach(name => {
        if (previousEnv[name] === undefined) delete process.env[name];
        else process.env[name] = previousEnv[name];
    });
});
async function variant(mode: Mode, fileVersionId?: string) {
    const suffix = randomUUID();
    const product = await server.app.get(ProductService).create(own, {
        translations: [
            {
                languageCode: LanguageCode.zh_Hans,
                name: 'Synthetic digital ' + mode,
                slug: 'digital-' + suffix,
                description: 'Synthetic local digital closure fixture',
            },
        ],
        customFields: { fulfillmentType: 'digital' },
    });
    const [result] = await server.app.get(ProductVariantService).create(own, [
        {
            productId: product.id,
            sku: 'SYNTHETIC-' + suffix,
            price: 1000,
            trackInventory: GlobalFlag.FALSE,
            customFields: {
                fulfillmentType: 'digital',
                digitalDeliveryMode: mode,
                digitalStockPolicy: mode === 'auto_card' ? 'pool_derived' : 'unlimited',
            },
            translations: [{ languageCode: LanguageCode.zh_Hans, name: 'Synthetic digital ' + mode }],
        },
    ]);
    // New variant creation must initialize the independent digital domain through real hooks.
    const domain = await connection
        .getRepository(own, DigitalVariantConfig)
        .findOneBy({ channelId: own.channelId, productVariantId: result.id });
    expect(domain?.migrationState).toBe('ACTIVE');
    await query(
        adminClient,
        gql`
            mutation ($input: UpdateDigitalVariantConfigInput!) {
                updateDigitalVariantConfig(input: $input) {
                    id
                    deliveryMode
                    stockPolicy
                }
            }
        `,
        {
            input: {
                productVariantId: encode(result.id),
                deliveryMode: mode,
                stockPolicy: mode === 'auto_card' ? 'pool_derived' : 'unlimited',
                ...(fileVersionId ? { fileVersionId } : {}),
            },
        },
    );
    if (mode === 'auto_card')
        await query(
            adminClient,
            gql`
                mutation ($input: UpdateAutoCardConfigInput!) {
                    updateAutoCardConfig(input: $input) {
                        id
                        enabled
                    }
                }
            `,
            {
                input: {
                    productVariantId: encode(result.id),
                    enabled: true,
                    formatName: 'Synthetic accounts',
                    delimiter: '|',
                    fields: [
                        { key: 'account', label: '账号', secret: false },
                        { key: 'password', label: '密码', secret: true },
                    ],
                    instructions: 'Synthetic account instructions',
                    lowStockThreshold: 0,
                },
            },
        );
    return result;
}
async function addCards(variantId: ID, quantity: number) {
    const rawText = Array.from(
        { length: quantity },
        () => 'synthetic-' + randomUUID() + '|SYNTHETIC-PASSWORD',
    ).join('\n');
    return (
        await query(
            adminClient,
            gql`
                mutation ($input: AutoCardImportInput!) {
                    importAutoCardPoolItems(input: $input) {
                        importedCount
                        duplicateCount
                        availableCount
                    }
                }
            `,
            { input: { productVariantId: encode(variantId), rawText } },
        )
    ).importAutoCardPoolItems;
}
async function physicalVariant() {
    const suffix = randomUUID();
    const product = await server.app.get(ProductService).create(own, {
        customFields: { fulfillmentType: 'physical' },
        translations: [
            {
                languageCode: LanguageCode.zh_Hans,
                name: 'Synthetic unshipped physical',
                slug: 'physical-' + suffix,
                description: 'Local mixed order fixture',
            },
        ],
    });
    const [result] = await server.app.get(ProductVariantService).create(own, [
        {
            productId: product.id,
            sku: 'PHYSICAL-' + suffix,
            price: 1000,
            trackInventory: GlobalFlag.FALSE,
            stockLevels: [{ stockLocationId: locationId, stockOnHand: 100 }],
            translations: [{ languageCode: LanguageCode.zh_Hans, name: 'Synthetic unshipped physical' }],
        },
    ]);
    return result;
}
async function checkout(
    productVariantId: ID,
    quantity = 2,
    provider = settledProvider.code,
    physicalId?: ID,
    authenticatedClient?: SimpleGraphQLClient,
) {
    const client = authenticatedClient ?? shop();
    const result = (
        await query(
            client,
            gql`
                mutation ($id: ID!, $quantity: Int!) {
                    addItemToOrder(productVariantId: $id, quantity: $quantity) {
                        ... on Order {
                            id
                            code
                            lines {
                                id
                                quantity
                            }
                        }
                        ... on ErrorResult {
                            errorCode
                            message
                        }
                    }
                }
            `,
            { id: encode(productVariantId), quantity },
        )
    ).addItemToOrder;
    expect(result.errorCode, result.message).toBeUndefined();
    if (physicalId) {
        const physical = (
            await query(
                client,
                gql`
                    mutation ($id: ID!) {
                        addItemToOrder(productVariantId: $id, quantity: 1) {
                            ... on Order {
                                id
                            }
                            ... on ErrorResult {
                                errorCode
                                message
                            }
                        }
                    }
                `,
                { id: encode(physicalId) },
            )
        ).addItemToOrder;
        expect(physical.errorCode, physical.message).toBeUndefined();
        await query(
            client,
            gql`
                mutation ($input: CreateAddressInput!) {
                    setOrderShippingAddress(input: $input) {
                        ... on Order {
                            id
                        }
                        ... on ErrorResult {
                            errorCode
                            message
                        }
                    }
                }
            `,
            {
                input: {
                    fullName: 'Synthetic Digital Mixed',
                    streetLine1: '1 Synthetic Street',
                    city: 'London',
                    province: 'London',
                    postalCode: 'SW1A 1AA',
                    countryCode: 'GB',
                    phoneNumber: '+440000000000',
                },
            },
        );
        const shipping = (
            await query(
                client,
                gql`
                    mutation ($id: ID!) {
                        setOrderShippingMethod(shippingMethodId: [$id]) {
                            ... on Order {
                                id
                            }
                            ... on ErrorResult {
                                errorCode
                                message
                            }
                        }
                    }
                `,
                { id: encode(shippingMethodId) },
            )
        ).setOrderShippingMethod;
        expect(shipping.errorCode, shipping.message).toBeUndefined();
    }
    const email = 'synthetic-' + randomUUID() + '@example.invalid';
    if (!authenticatedClient) {
        const customer = (
            await query(
                client,
                gql`
                    mutation ($input: CreateCustomerInput!) {
                        setCustomerForOrder(input: $input) {
                            ... on Order {
                                id
                            }
                            ... on ErrorResult {
                                errorCode
                                message
                            }
                        }
                    }
                `,
                { input: { firstName: 'Synthetic', lastName: 'Digital', emailAddress: email } },
            )
        ).setCustomerForOrder;
        expect(customer.errorCode, customer.message).toBeUndefined();
    }
    await query(
        client,
        gql`
            mutation ($input: SetActiveOrderDeliveryEmailInput!) {
                setActiveOrderDeliveryEmail(input: $input) {
                    id
                }
            }
        `,
        { input: { emailAddress: email, confirmEmailAddress: email, saveToAddressBook: false } },
    );
    const beginPayment = gql`
        mutation {
            transitionOrderToState(state: "ArrangingPayment") {
                ... on Order {
                    id
                    state
                }
                ... on ErrorResult {
                    errorCode
                    message
                }
                ... on OrderStateTransitionError {
                    transitionError
                }
            }
        }
    `;
    let transition = (await query(client, beginPayment)).transitionOrderToState;
    const riskCode = transition.transitionError?.match(/（(FR-[A-Z0-9]+)）/)?.[1];
    if (riskCode) {
        // Guest risk review is a real production precondition, never a disabled guard or SQL bypass.
        const cases = (
            await query(
                adminClient,
                gql`
                    query {
                        fraudRiskCases(options: { take: 100 }) {
                            items {
                                id
                                caseCode
                                status
                            }
                        }
                    }
                `,
            )
        ).fraudRiskCases.items;
        const review = cases.find((item: any) => item.caseCode === riskCode);
        expect(review?.id, 'The blocked guest order must retain a reviewable fraud case').toBeDefined();
        const released = (
            await query(
                adminClient,
                gql`
                    mutation ($input: ReviewFraudRiskCaseInput!) {
                        reviewFraudRiskCase(input: $input) {
                            id
                            status
                        }
                    }
                `,
                {
                    input: {
                        id: review.id,
                        action: 'RELEASE',
                        reason: 'Synthetic local API order explicitly verified',
                        idempotencyKey: 'synthetic-guest-risk-release:' + String(review.id),
                    },
                },
            )
        ).reviewFraudRiskCase;
        expect(released.status).toBe('APPROVED');
        transition = (await query(client, beginPayment)).transitionOrderToState;
    }
    expect(transition.state, transition.transitionError ?? transition.message).toBe('ArrangingPayment');
    const paid =
        provider === 'referral-balance'
            ? (
                  await query(
                      client,
                      gql`
                          mutation ($amount: Money!) {
                              useMyReferralBalance(amount: $amount) {
                                  order {
                                      id
                                      state
                                  }
                              }
                          }
                      `,
                      { amount: quantity * 1000 },
                  )
              ).useMyReferralBalance.order
            : (
                  await query(
                      client,
                      gql`
                          mutation ($input: PaymentInput!) {
                              addPaymentToOrder(input: $input) {
                                  ... on Order {
                                      id
                                      state
                                  }
                                  ... on ErrorResult {
                                      errorCode
                                      message
                                  }
                              }
                          }
                      `,
                      { input: { method: provider, metadata: {} } },
                  )
              ).addPaymentToOrder;
    expect(paid.errorCode, paid.message).toBeUndefined();
    const order = await connection.getEntityOrThrow(own, Order, decode(result.id), {
        relations: [
            'lines',
            'lines.productVariant',
            'payments',
            'payments.refunds',
            'payments.refunds.lines',
            'fulfillments',
            'fulfillments.lines',
        ],
    });
    const token = server.app.get(OrderConfirmationTokenService).createForDigitalReceipt(own, order).token;
    const line = order.lines.find(item => String(item.productVariantId) === String(productVariantId));
    if (!line) throw new Error('Synthetic digital order line missing');
    return { order, line, payment: order.payments[0], client, token };
}
type PaidFixture = Awaited<ReturnType<typeof checkout>>;
function receiptVariables(fixture: PaidFixture) {
    return { orderId: encode(fixture.order.id), confirmationToken: fixture.token };
}
async function status(fixture: PaidFixture) {
    return (await query(fixture.client, getContents, receiptVariables(fixture))).myDigitalDeliveryContents[0];
}
async function claim(fixture: PaidFixture) {
    return (
        await query(fixture.client, claimContents, {
            ...receiptVariables(fixture),
            orderLineId: encode(fixture.line.id),
        })
    ).claimDigitalDelivery;
}
async function manualFixture(quantity = 2, provider = settledProvider.code, mixed = false) {
    const product = await variant('manual_service');
    const physical = mixed ? await physicalVariant() : undefined;
    const paid = await checkout(product.id, quantity, provider, physical?.id);
    const delivery = await connection
        .getRepository(own, ManualDigitalDelivery)
        .findOneByOrFail({ orderLineId: paid.line.id });
    return { ...paid, product, delivery };
}
async function publish(fixture: Awaited<ReturnType<typeof manualFixture>>, quantity = fixture.line.quantity) {
    return (
        await query(adminClient, publishManual, {
            input: { id: encode(fixture.delivery.id), packages: packages(quantity) },
        })
    ).publishManualDigitalDelivery;
}
async function refund(fixture: PaidFixture, quantity: number, compensation = false) {
    return (
        await query(adminClient, refundMutation, {
            input: {
                paymentId: encode(fixture.payment.id),
                amount: compensation
                    ? 100
                    : Math.floor((fixture.line.proratedLinePriceWithTax * quantity) / fixture.line.quantity),
                idempotencyKey: 'synthetic-digital-refund:' + randomUUID(),
                reasonType: compensation ? 'COMPENSATION' : 'ITEMS',
                ...(compensation ? {} : { lines: [{ orderLineId: encode(fixture.line.id), quantity }] }),
            },
        })
    ).refundOrder;
}
async function uploadVersion(text: string) {
    const filePath = path.join(fixtureRoot, 'upload-' + randomUUID() + '.txt');
    await writeFile(filePath, text, { mode: 0o600 });
    return (
        await adminClient.fileUploadMutation({
            mutation: gql`
                mutation UploadSyntheticDigitalFile($file: Upload!) {
                    uploadDigitalDeliveryFile(file: $file) {
                        id
                        fileName
                        size
                    }
                }
            `,
            filePaths: [filePath],
            mapVariables: () => ({ file: null }),
        })
    ).uploadDigitalDeliveryFile;
}
async function simulateNotificationFailure(deliveryId: ID) {
    // External notification only: actual result subscriber persists the failure, no SMTP or delivery mock.
    await server.app.get(EventBus).publish(
        new EmailSendEvent(
            own,
            {
                from: 'synthetic-sender@example.invalid',
                recipient: 'synthetic-recipient@example.invalid',
                subject: 'Synthetic local notification',
                body: 'No SMTP delivery attempted',
                attachments: [],
            },
            false,
            new Error('Synthetic local notification failure'),
            { type: 'manual-digital-delivery', deliveryId: String(deliveryId) },
        ),
    );
    await expect
        .poll(
            async () =>
                (
                    await connection
                        .getRepository(own, ManualDigitalDelivery)
                        .findOneByOrFail({ id: deliveryId })
                ).state,
        )
        .toBe('EMAIL_FAILED');
}
describe('digital order closure through real local API and SQLjs', () => {
    it('settles a placed fiat order top-up only after solidified USDT receipt and creates a fresh request for the next equal amount', async () => {
        const product = await variant('manual_service');
        const fixture = await checkout(product.id, 1);
        const method = await connection
            .getRepository(platformContext, PaymentMethod)
            .findOneByOrFail({ code: 'usdt-trc20' });
        await server.app
            .get(ChannelService)
            .assignToChannels(platformContext, PaymentMethod, method.id, [own.channelId]);
        await server.app.get(PaymentMethodService).setStorePaymentOptionEnabled(own, method.id, true);
        const increase = async (quantity: number) => {
            await query(
                adminClient,
                gql`
                    mutation ($id: ID!) {
                        transitionOrderToState(id: $id, state: "Modifying") {
                            ... on Order {
                                id
                                state
                            }
                            ... on ErrorResult {
                                message
                            }
                        }
                    }
                `,
                { id: encode(fixture.order.id) },
            );
            const result = (
                await query(
                    adminClient,
                    gql`
                        mutation ($input: ModifyOrderInput!) {
                            modifyOrder(input: $input) {
                                ... on Order {
                                    id
                                    state
                                }
                                ... on ErrorResult {
                                    errorCode
                                    message
                                }
                            }
                        }
                    `,
                    {
                        input: {
                            orderId: encode(fixture.order.id),
                            dryRun: false,
                            adjustOrderLines: [{ orderLineId: encode(fixture.line.id), quantity }],
                        },
                    },
                )
            ).modifyOrder;
            expect(result.errorCode, result.message).toBeUndefined();
            expect(
                (
                    await query(
                        adminClient,
                        gql`
                            mutation ($id: ID!) {
                                finishOrderModification(orderId: $id) {
                                    id
                                    state
                                }
                            }
                        `,
                        { id: encode(fixture.order.id) },
                    )
                ).finishOrderModification.state,
            ).toBe('ArrangingAdditionalPayment');
        };
        const create = gql`
            mutation ($input: ModifiedOrderUsdtQuoteInput!) {
                createModifiedOrderUsdtQuote(input: $input) {
                    id
                    fiatAmount
                    usdtAmount
                    receivingAddress
                    network
                    paymentStatus
                }
            }
        `;
        const request = {
            orderId: encode(fixture.order.id),
            confirmationToken: fixture.token,
            expectedAmount: 1000,
        };
        await increase(2);
        await expect(
            query(shop(), create, { input: { ...request, confirmationToken: undefined } }),
        ).rejects.toThrow();
        const first = (await query(fixture.client, create, { input: request })).createModifiedOrderUsdtQuote;
        const intent = await connection
            .getRepository(own, StorefrontUsdtPaymentIntent)
            .findOneByOrFail({ quoteId: decode(first.id) });
        expect(intent.expectedUsdtAmount).toBe(Number(first.usdtAmount).toFixed(6));
        expect(first).toMatchObject({ fiatAmount: 1000, paymentStatus: 'PENDING', network: 'TRC20' });
        expect(
            (await query(fixture.client, create, { input: request })).createModifiedOrderUsdtQuote.id,
        ).toBe(first.id);
        expect(
            (await connection.getEntityOrThrow(own, Order, fixture.order.id, { relations: ['payments'] }))
                .payments,
        ).toHaveLength(1);
        const chain = server.app.get(UsdtTrc20Client);
        const scanner = server.app.get(UsdtPaymentService);
        const scanScoped = vi.spyOn(chain, 'scanIncomingTransfers').mockResolvedValue({
            complete: true,
            transfers: [
                {
                    transactionId: 'a'.repeat(64),
                    from: first.receivingAddress,
                    to: first.receivingAddress,
                    amount: Number(first.usdtAmount).toFixed(6),
                    blockTimestamp: new Date(),
                },
            ],
        });
        const solidified = vi.spyOn(chain, 'solidifiedTransaction').mockResolvedValue(null);
        try {
            const transfers = (
                await chain.scanIncomingTransfers(first.receivingAddress, new Date(), new Date())
            ).transfers;
            expect(transfers[0].to).toBe(intent.receivingAddress);
            expect(transfers[0].amount).toBe(intent.expectedUsdtAmount);
            expect(transfers[0].blockTimestamp.getTime()).toBeGreaterThanOrEqual(
                intent.createdAt.getTime() - 60000,
            );
            expect(transfers[0].blockTimestamp.getTime()).toBeLessThanOrEqual(
                intent.expiresAt.getTime() + 60000,
            );
            expect(findMatchingTransfer(intent, transfers)).toBeDefined();
            expect((await scanner.scanPendingPayments(platformContext)).settledCount).toBe(0);
            expect(
                (await connection.getEntityOrThrow(own, Order, fixture.order.id, { relations: ['payments'] }))
                    .payments,
            ).toHaveLength(1);
            solidified.mockResolvedValue({ blockNumber: 123 } as any);
            const result = await scanner.scanPendingPayments(platformContext);
            expect(solidified).toHaveBeenCalledTimes(2);
            expect(result, JSON.stringify(result)).toMatchObject({ settledCount: 1, manualReviewCount: 0 });
            const paid = await connection.getEntityOrThrow(own, Order, fixture.order.id, {
                relations: ['payments'],
            });
            expect(paid.active).toBe(false);
            expect(paid.state).not.toBe('ArrangingAdditionalPayment');
            expect(paid.payments.filter(payment => payment.state === 'Settled')).toHaveLength(2);
            expect(paid.payments.find(payment => payment.method === 'usdt-trc20')?.amount).toBe(1000);
            await scanner.scanPendingPayments(platformContext);
            expect(
                (await connection.getEntityOrThrow(own, Order, fixture.order.id, { relations: ['payments'] }))
                    .payments,
            ).toHaveLength(2);
            await increase(3);
            const second = (await query(fixture.client, create, { input: request }))
                .createModifiedOrderUsdtQuote;
            expect(second.id).not.toBe(first.id);
            expect(second).toMatchObject({ fiatAmount: 1000, paymentStatus: 'PENDING' });
        } finally {
            scanScoped.mockRestore();
            solidified.mockRestore();
        }
    });
    it('captures repeatable partial wallet top-ups, rejects stale concurrent requests and refunds only the correct source', async () => {
        const email = 'synthetic-wallet-' + randomUUID() + '@example.invalid';
        const password = 'Aa1!' + randomBytes(24).toString('base64url');
        const buyer = await server.app.get(CustomerService).create(
            own,
            {
                firstName: 'Synthetic',
                lastName: 'Wallet',
                emailAddress: email,
            },
            password,
        );
        if ('errorCode' in buyer) throw new Error(buyer.message);
        await connection.getRepository(own, User).update({ identifier: email }, { verified: true });
        const client = shop();
        const loggedIn = await client.asUserWithCredentials(email, password);
        expect(loggedIn.identifier).toBe(email);
        client.setChannelToken(own.channel.token);
        await connection.withTransaction(own, tx =>
            server.app
                .get(ReferralService)
                .adjustBalance(tx, buyer.id, own.currencyCode, 4000, 'Synthetic local acceptance credit'),
        );
        const method = await connection
            .getRepository(platformContext, PaymentMethod)
            .findOneByOrFail({ code: 'referral-balance' });
        await server.app
            .get(ChannelService)
            .assignToChannels(platformContext, PaymentMethod, method.id, [own.channelId]);
        await server.app.get(PaymentMethodService).setStorePaymentOptionEnabled(own, method.id, true);
        const product = await variant('manual_service');
        const fixture = await checkout(product.id, 1, 'referral-balance', undefined, client);
        const wallet = () =>
            connection.getRepository(own, ReferralWallet).findOneByOrFail({
                channelId: own.channelId,
                customerId: buyer.id,
                currencyCode: own.currencyCode,
            });
        expect((await wallet()).availableBalance).toBe(3000);
        const increase = async (quantity: number) => {
            await query(
                adminClient,
                gql`
                    mutation ($id: ID!) {
                        transitionOrderToState(id: $id, state: "Modifying") {
                            ... on Order {
                                id
                                state
                            }
                            ... on ErrorResult {
                                message
                            }
                        }
                    }
                `,
                { id: encode(fixture.order.id) },
            );
            const adjusted = (
                await query(
                    adminClient,
                    gql`
                        mutation ($input: ModifyOrderInput!) {
                            modifyOrder(input: $input) {
                                ... on Order {
                                    id
                                    state
                                }
                                ... on ErrorResult {
                                    message
                                    errorCode
                                }
                            }
                        }
                    `,
                    {
                        input: {
                            orderId: encode(fixture.order.id),
                            dryRun: false,
                            adjustOrderLines: [{ orderLineId: encode(fixture.line.id), quantity }],
                        },
                    },
                )
            ).modifyOrder;
            expect(adjusted.errorCode, adjusted.message).toBeUndefined();
            expect(
                (
                    await query(
                        adminClient,
                        gql`
                            mutation ($id: ID!) {
                                finishOrderModification(orderId: $id) {
                                    id
                                    state
                                }
                            }
                        `,
                        { id: encode(fixture.order.id) },
                    )
                ).finishOrderModification.state,
            ).toBe('ArrangingAdditionalPayment');
        };
        const pay = gql`
            mutation ($input: ModifiedOrderBalanceInput!) {
                useModifiedOrderReferralBalance(input: $input) {
                    id
                    state
                    active
                }
            }
        `;
        const input = (amount: number, expectedAmount: number, key: string) => ({
            orderId: encode(fixture.order.id),
            amount,
            expectedAmount,
            idempotencyKey: key,
        });
        await increase(2);
        await expect(query(shop(), pay, { input: input(200, 1000, 'guest-forgery') })).rejects.toThrow();
        const parallel = await Promise.allSettled([
            query(client, pay, { input: input(200, 1000, 'wallet-partial') }),
            query(client, pay, { input: input(200, 1000, 'wallet-partial') }),
        ]);
        expect(parallel.filter(item => item.status === 'fulfilled')).toHaveLength(1);
        expect((await wallet()).availableBalance).toBe(2800);
        expect((await wallet()).reservedBalance).toBe(0);
        await query(client, pay, { input: input(800, 800, 'wallet-complete') });
        expect((await wallet()).availableBalance).toBe(2000);
        await increase(3);
        await query(client, pay, { input: input(1000, 1000, 'wallet-second-modification') });
        const order = await connection.getEntityOrThrow(own, Order, fixture.order.id, {
            relations: ['payments'],
        });
        expect(order.active).toBe(false);
        expect(order.state).not.toBe('ArrangingAdditionalPayment');
        expect(order.payments.filter(payment => payment.state === 'Settled')).toHaveLength(4);
        const usages = (
            await connection.getRepository(own, ReferralWalletUsage).find({
                where: {
                    resourceType: 'ORDER_ADDITIONAL_PAYMENT',
                    channelId: own.channelId,
                },
            })
        ).filter(usage => usage.metadata?.orderId === String(order.id));
        expect(usages).toHaveLength(3);
        expect(usages.every(usage => usage.status === 'CAPTURED')).toBe(true);
        const source = requireFixture(order.payments.find(payment => payment.amount === 200));
        const refundScopedValue = {
            paymentId: encode(source.id),
            amount: 200,
            reasonType: 'COMPENSATION',
            idempotencyKey: 'wallet-original-source-refund',
            reason: 'Synthetic source refund',
        };
        const first = (await query(adminClient, refundMutation, { input: refundScopedValue })).refundOrder;
        expect(first.errorCode, first.message).toBeUndefined();
        expect(first.state).toBe('Settled');
        expect((await query(adminClient, refundMutation, { input: refundScopedValue })).refundOrder.id).toBe(
            first.id,
        );
        expect((await wallet()).availableBalance).toBe(1200);
        const cancelled = (
            await query(
                adminClient,
                gql`
                    mutation ($input: CancelOrderInput!) {
                        cancelOrder(input: $input) {
                            ... on Order {
                                id
                                state
                            }
                            ... on ErrorResult {
                                errorCode
                                message
                            }
                        }
                    }
                `,
                { input: { orderId: encode(order.id), reason: 'Synthetic stop delivery without refund' } },
            )
        ).cancelOrder;
        expect(cancelled.errorCode, cancelled.message).toBeUndefined();
        expect(cancelled.state).toBe('Cancelled');
        expect((await wallet()).availableBalance).toBe(1200);
    });
    it('prevents a confirmation proof from exposing another customer account, addresses or other orders', async () => {
        const createBuyer = async () => {
            const password = 'Aa1!' + randomBytes(24).toString('base64url');
            const emailAddress = 'synthetic-buyer-' + randomUUID() + '@example.invalid';
            const customer = await server.app.get(CustomerService).create(
                own,
                {
                    firstName: 'Synthetic',
                    lastName: 'Boundary',
                    emailAddress,
                },
                password,
            );
            if ('errorCode' in customer) throw new Error(customer.message);
            // Shared addresses are maintained by the platform/customer, never a store operator.
            await server.app.get(CustomerService).createAddress(platformContext, customer.id, {
                fullName: 'Synthetic Boundary',
                streetLine1: 'A private synthetic address',
                city: 'London',
                postalCode: 'SW1A 1AA',
                countryCode: 'GB',
                defaultShippingAddress: true,
            });
            const client = shop();
            let loggedIn;
            try {
                loggedIn = await client.asUserWithCredentials(emailAddress, password);
            } catch (error) {
                // Surface server frames only; never serialize ClientError.request credentials or tokens.
                const failure = (
                    error as {
                        response?: {
                            errors?: Array<{
                                message: string;
                                extensions?: {
                                    stacktrace?: string[];
                                    exception?: {
                                        stacktrace?: string[];
                                    };
                                };
                            }>;
                        };
                    }
                ).response?.errors?.[0];
                const frames =
                    failure?.extensions?.stacktrace ?? failure?.extensions?.exception?.stacktrace ?? [];
                throw new Error(
                    (failure?.message ?? 'Synthetic customer login failed') +
                        '\n' +
                        (frames.length
                            ? frames.join('\n')
                            : (authorizationFrames[authorizationFrames.length - 1] ??
                              'No server frames recorded')),
                );
            }
            expect(loggedIn.identifier).toBe(emailAddress);
            client.setChannelToken(own.channel.token);
            return { customer, client };
        };
        const buyerA = await createBuyer();
        const buyerB = await createBuyer();
        const product = await variant('manual_service');
        const fixture = await checkout(product.id, 1, settledProvider.code, undefined, buyerA.client);
        const delivery = await connection
            .getRepository(own, ManualDigitalDelivery)
            .findOneByOrFail({ orderLineId: fixture.line.id });
        await query(adminClient, publishManual, {
            input: { id: encode(delivery.id), packages: packages(1) },
        });
        await expect(
            query(buyerB.client, claimContents, {
                orderId: encode(fixture.order.id),
                orderLineId: encode(fixture.line.id),
            }),
        ).rejects.toThrow(/无权/);
        // A valid signed receipt is a bearer capability for this order, never for the customer's account.
        expect(
            (
                await query(buyerB.client, claimContents, {
                    ...receiptVariables(fixture),
                    orderLineId: encode(fixture.line.id),
                })
            ).claimDigitalDelivery.packages,
        ).toHaveLength(1);
        expect(
            (
                await query(buyerA.client, claimContents, {
                    orderId: encode(fixture.order.id),
                    orderLineId: encode(fixture.line.id),
                })
            ).claimDigitalDelivery.packages,
        ).toHaveLength(1);
        const document = gql`
            query ($token: String!) {
                storefrontOrderByConfirmationToken(token: $token) {
                    id
                    customer {
                        id
                        orders {
                            totalItems
                            items {
                                id
                            }
                        }
                        addresses {
                            id
                            streetLine1
                        }
                        user {
                            id
                            identifier
                        }
                    }
                }
            }
        `;
        const nestedA = (await query(buyerA.client, document, { token: fixture.token }))
            .storefrontOrderByConfirmationToken.customer;
        expect(nestedA.user.identifier).toBe(buyerA.customer.emailAddress);
        expect(nestedA.orders.totalItems).toBeGreaterThan(0);
        expect(nestedA.addresses).toHaveLength(1);
        const nestedB = (await query(buyerB.client, document, { token: fixture.token }))
            .storefrontOrderByConfirmationToken.customer;
        expect(nestedB.id).toBe(encode(buyerA.customer.id));
        expect(nestedB).toMatchObject({ orders: { totalItems: 0, items: [] }, addresses: [], user: null });
        const adminNested = gql`
            query ($id: ID!) {
                order(id: $id) {
                    customer {
                        id
                        orders {
                            totalItems
                        }
                        addresses {
                            id
                        }
                        user {
                            id
                            identifier
                        }
                    }
                }
            }
        `;
        const restricted = (await query(reader, adminNested, { id: encode(fixture.order.id) })).order
            .customer;
        expect(restricted).toMatchObject({ orders: { totalItems: 0 }, addresses: [], user: null });
        const allowed = (await query(adminClient, adminNested, { id: encode(fixture.order.id) })).order
            .customer;
        expect(allowed.user.identifier).toBe(buyerA.customer.emailAddress);
        expect(allowed.orders.totalItems).toBeGreaterThan(0);
        expect(allowed.addresses).toHaveLength(1);
    });
    it('keeps ordinary ReadOrder GET metadata-only and requires audited explicit manual reveal', async () => {
        const fixture = await manualFixture();
        await publish(fixture);
        const before = await connection
            .getRepository(own, ManualDigitalDeliveryEvent)
            .count({ where: { deliveryId: fixture.delivery.id } });
        const result = await scan(reader, readManual, { id: encode(fixture.delivery.id) });
        expect(result.manualDigitalDelivery).toMatchObject({ hasContent: true, packages: [] });
        expect(JSON.stringify(result)).not.toContain('SYNTHETIC-CONTENT');
        expect(JSON.stringify(await scan(reader, readOrder, { id: encode(fixture.order.id) }))).not.toContain(
            'SYNTHETIC-CONTENT',
        );
        expect(
            await connection
                .getRepository(own, ManualDigitalDeliveryEvent)
                .count({ where: { deliveryId: fixture.delivery.id } }),
        ).toBe(before);
        await expect(query(reader, revealManual, { id: encode(fixture.delivery.id) })).rejects.toThrow();
        const revealed = (await query(revealer, revealManual, { id: encode(fixture.delivery.id) }))
            .revealMyManualDigitalDelivery;
        expect(revealed.packages).toHaveLength(2);
        expect(revealed.packages[0].fields.find((field: any) => field.secret).value).toBe(
            'SYNTHETIC-CONTENT-0',
        );
        const audit = await connection
            .getRepository(own, ManualDigitalDeliveryEvent)
            .find({ where: { deliveryId: fixture.delivery.id }, order: { createdAt: 'ASC', id: 'ASC' } });
        expect(audit).toHaveLength(before + 1);
        expect(audit[audit.length - 1]).toMatchObject({ type: 'CONTENT_VIEWED', actorType: 'ADMIN' });
        revealer.setChannelToken(foreign.channel.token);
        try {
            await expect(
                query(revealer, revealManual, { id: encode(fixture.delivery.id) }),
            ).rejects.toThrow();
        } finally {
            revealer.setChannelToken(own.channel.token);
        }
    });
    it('publishes exactly the remaining manual units after a Pending per-item refund', async () => {
        const fixture = await manualFixture(2, pendingProvider.code);
        expect((await refund(fixture, 1)).state).toBe('Pending');
        await expect(publish(fixture, 2)).rejects.toThrow(/份|数量/);
        await publish(fixture, 1);
        expect(await status(fixture)).toMatchObject({
            state: 'READY',
            eligibleQuantity: 1,
            readyQuantity: 1,
        });
        expect((await claim(fixture)).packages).toHaveLength(1);
        const fulfilled = await connection
            .getRepository(own, Fulfillment)
            .find({ where: { orders: { id: fixture.order.id } }, relations: ['lines'] });
        expect(fulfilled.flatMap(item => item.lines).reduce((sum, line) => sum + line.quantity, 0)).toBe(1);
        expect(
            notices.filter(item => item.kind === 'manual' && item.deliveryId === String(fixture.delivery.id)),
        ).toHaveLength(1);
    });
    it('does not claim or decrypt on scanner GET and keeps explicit parallel claims idempotent', async () => {
        const fixture = await manualFixture();
        const expired = server.app
            .get(OrderConfirmationTokenService)
            .createForSettledOrder(own, fixture.order, Date.now() - 31 * 24 * 60 * 60 * 1000).token;
        await publish(fixture);
        for (let count = 0; count < 2; count++) {
            const scanned = await scan(fixture.client, getContents, receiptVariables(fixture));
            expect(scanned.myDigitalDeliveryContents[0]).toMatchObject({
                state: 'READY',
                claimedQuantity: 0,
                packages: [],
                downloadUrl: null,
            });
        }
        expect(
            await connection
                .getRepository(own, DigitalReceiptAccess)
                .count({ where: { orderLineId: fixture.line.id } }),
        ).toBe(0);
        const [first, second] = await Promise.all([claim(fixture), claim(fixture)]);
        expect(first.packages).toEqual(second.packages);
        expect(first.claimedQuantity).toBe(2);
        expect(
            await connection
                .getRepository(own, DigitalReceiptAccess)
                .count({ where: { orderLineId: fixture.line.id } }),
        ).toBe(1);
        expect(await status(fixture)).toMatchObject({ claimedQuantity: 2, packages: [] });
        const outsider = shop();
        await expect(query(outsider, getContents, { orderId: encode(fixture.order.id) })).rejects.toThrow(
            /无权/,
        );
        await expect(
            query(outsider, getContents, { orderId: encode(fixture.order.id), confirmationToken: expired }),
        ).rejects.toThrow(/无权/);
        await expect(
            query(outsider, claimContents, {
                orderId: encode(fixture.order.id),
                orderLineId: encode(fixture.line.id),
                confirmationToken: expired,
            }),
        ).rejects.toThrow(/无权/);
        outsider.setChannelToken(foreign.channel.token);
        await expect(query(outsider, getContents, receiptVariables(fixture))).rejects.toThrow();
        await expect(
            query(outsider, claimContents, {
                ...receiptVariables(fixture),
                orderLineId: encode(fixture.line.id),
            }),
        ).rejects.toThrow();
    });
    it('preserves published content and delivery rights after a settled price compensation', async () => {
        const fixture = await manualFixture();
        await publish(fixture);
        const first = await claim(fixture);
        expect((await refund(fixture, 0, true)).state).toBe('Settled');
        expect(await status(fixture)).toMatchObject({
            state: 'READY',
            eligibleQuantity: 2,
            readyQuantity: 2,
        });
        expect((await claim(fixture)).packages).toEqual(first.packages);
    });
    it('rejects preview and submitted quantity increases after a settled item refund without reviving published units', async () => {
        const fixture = await manualFixture(2, settledProvider.code, true);
        await publish(fixture);
        const first = await claim(fixture);
        expect(first.packages).toHaveLength(2);
        expect((await refund(fixture, 1)).state).toBe('Settled');
        expect((await claim(fixture)).packages).toHaveLength(1);
        const before = (await query(adminClient, readOrder, { id: encode(fixture.order.id) })).order;
        await query(
            adminClient,
            gql`
                mutation ($id: ID!) {
                    transitionOrderToState(id: $id, state: "Modifying") {
                        ... on Order {
                            id
                            state
                        }
                        ... on ErrorResult {
                            message
                        }
                    }
                }
            `,
            { id: encode(fixture.order.id) },
        );
        const mutation = gql`
            mutation ($input: ModifyOrderInput!) {
                modifyOrder(input: $input) {
                    ... on Order {
                        id
                        state
                    }
                    ... on ErrorResult {
                        errorCode
                        message
                    }
                }
            }
        `;
        for (const dryRun of [true, false]) {
            let rejection: string | undefined;
            try {
                const result = (
                    await query(adminClient, mutation, {
                        input: {
                            orderId: encode(fixture.order.id),
                            dryRun,
                            adjustOrderLines: [{ orderLineId: encode(fixture.line.id), quantity: 3 }],
                        },
                    })
                ).modifyOrder;
                if (result.errorCode) rejection = result.message;
            } catch (error) {
                rejection = error instanceof Error ? error.message : 'Unexpected error';
            }
            expect(rejection, 'Refunded units must be rejected before modification or new payment').toMatch(
                /退款|售后/,
            );
            const unchanged = await connection.getEntityOrThrow(own, Order, fixture.order.id, {
                relations: ['lines', 'payments'],
            });
            expect(
                requireFixture(unchanged.lines.find(line => String(line.id) === String(fixture.line.id)))
                    .quantity,
            ).toBe(2);
            expect(unchanged.totalWithTax).toBe(before.totalWithTax);
            expect(unchanged.payments).toHaveLength(before.payments.length);
        }
        await query(
            adminClient,
            gql`
                mutation ($id: ID!) {
                    finishOrderModification(orderId: $id) {
                        id
                        state
                    }
                }
            `,
            { id: encode(fixture.order.id) },
        );
        const stillOne = await claim(fixture);
        expect(stillOne.packages).toHaveLength(1);
        expect(JSON.stringify(stillOne.packages)).not.toContain('SYNTHETIC-CONTENT-1');
    });
    it('allows an unrefunded mixed manual order to increase from two to three and appends only one new unit', async () => {
        const fixture = await manualFixture(2, settledProvider.code, true);
        await publish(fixture);
        const original = await claim(fixture);
        await simulateNotificationFailure(fixture.delivery.id);
        const initial = (await query(adminClient, readOrder, { id: encode(fixture.order.id) })).order;
        expect(initial.state).toBe('PartiallyDelivered');
        await query(
            adminClient,
            gql`
                mutation ($id: ID!) {
                    transitionOrderToState(id: $id, state: "Modifying") {
                        ... on Order {
                            id
                            state
                        }
                        ... on ErrorResult {
                            message
                        }
                    }
                }
            `,
            { id: encode(fixture.order.id) },
        );
        const adjusted = (
            await query(
                adminClient,
                gql`
                    mutation ($input: ModifyOrderInput!) {
                        modifyOrder(input: $input) {
                            ... on Order {
                                id
                                state
                            }
                            ... on ErrorResult {
                                errorCode
                                message
                            }
                        }
                    }
                `,
                {
                    input: {
                        orderId: encode(fixture.order.id),
                        dryRun: false,
                        adjustOrderLines: [{ orderLineId: encode(fixture.line.id), quantity: 3 }],
                    },
                },
            )
        ).modifyOrder;
        expect(adjusted.errorCode, adjusted.message).toBeUndefined();
        const finished = (
            await query(
                adminClient,
                gql`
                    mutation ($id: ID!) {
                        finishOrderModification(orderId: $id) {
                            id
                            state
                        }
                    }
                `,
                { id: encode(fixture.order.id) },
            )
        ).finishOrderModification;
        expect(finished.state).toBe('ArrangingAdditionalPayment');
        const payment = (
            await query(
                adminClient,
                gql`
                    mutation ($input: ManualPaymentInput!) {
                        addManualPaymentToOrder(input: $input) {
                            ... on Order {
                                id
                                state
                            }
                            ... on ErrorResult {
                                errorCode
                                message
                            }
                        }
                    }
                `,
                {
                    input: {
                        orderId: encode(fixture.order.id),
                        method: settledProvider.code,
                        transactionId: 'LOCAL-MANUAL-INCREASE-' + String(fixture.order.id),
                        metadata: {},
                    },
                },
            )
        ).addManualPaymentToOrder;
        expect(payment.errorCode, payment.message).toBeUndefined();
        expect(payment.state, 'Fully registered additional payment must resume order processing').not.toBe(
            'ArrangingAdditionalPayment',
        );
        const payable = (
            await query(
                adminClient,
                gql`
                    query ($id: ID!) {
                        order(id: $id) {
                            state
                            processingSummary {
                                outstandingAmount
                                nextAction {
                                    code
                                    enabled
                                }
                                remainingDigitalQuantity
                            }
                        }
                    }
                `,
                { id: encode(fixture.order.id) },
            )
        ).order;
        expect(payable.processingSummary).toMatchObject({
            outstandingAmount: 0,
            remainingDigitalQuantity: 1,
            nextAction: { code: 'PREPARE_DELIVERY', enabled: true },
        });
        const extra = [
            {
                note: 'Synthetic appended third unit',
                fields: [
                    { key: 'account', label: '账号', value: 'synthetic-account-extra', secret: false },
                    { key: 'password', label: '密码', value: 'SYNTHETIC-EXTRA-CONTENT', secret: true },
                ],
            },
        ];
        await query(
            adminClient,
            gql`
                mutation ($input: SaveManualDigitalDeliveryInput!) {
                    appendManualDigitalDelivery(input: $input) {
                        id
                        quantity
                        hasContent
                    }
                }
            `,
            { input: { id: encode(fixture.delivery.id), packages: extra } },
        );
        const received = await claim(fixture);
        expect(received.packages).toHaveLength(3);
        expect(received.packages.slice(0, 2)).toEqual(original.packages);
        expect(JSON.stringify(received.packages[2])).toContain('SYNTHETIC-EXTRA-CONTENT');
        const actual = (await query(adminClient, readOrder, { id: encode(fixture.order.id) })).order;
        const rows = actual.fulfillments.flatMap((item: any) => item.lines);
        expect(rows.reduce((sum: number, line: any) => sum + line.quantity, 0)).toBe(3);
        expect(actual.fulfillments).toHaveLength(initial.fulfillments.length + 1);
        const reservation = await connection
            .getRepository(own, DigitalOrderReservation)
            .findOneByOrFail({ orderLineId: fixture.line.id });
        expect(reservation).toMatchObject({ quantity: 3, consumedQuantity: 3 });
    });
    it('suspends, restores and revokes only refunded units across actual Pending, Failed and Settled callbacks', async () => {
        const fixture = await manualFixture(2, pendingProvider.code);
        await publish(fixture);
        const requested = await refund(fixture, 1);
        expect(requested.state).toBe('Pending');
        expect(await status(fixture)).toMatchObject({ eligibleQuantity: 1, readyQuantity: 1 });
        expect((await claim(fixture)).packages).toHaveLength(1);
        const callback = gql`
            mutation ($id: ID!, $state: String!) {
                syntheticDigitalRefundCallback(refundId: $id, state: $state) {
                    id
                    state
                }
            }
        `;
        await query(adminClient, callback, { id: requested.id, state: 'Failed' });
        expect(await status(fixture)).toMatchObject({
            state: 'READY',
            eligibleQuantity: 2,
            readyQuantity: 2,
        });
        expect((await claim(fixture)).packages).toHaveLength(2);
        const retry = await query(
            adminClient,
            gql`
                mutation ($input: RetryRefundInput!) {
                    retryRefund(input: $input) {
                        ... on Refund {
                            id
                            state
                        }
                        ... on ErrorResult {
                            message
                        }
                    }
                }
            `,
            { input: { refundId: requested.id, idempotencyKey: 'synthetic-digital-retry:' + randomUUID() } },
        );
        expect(retry.retryRefund).toMatchObject({ id: requested.id, state: 'Pending' });
        expect(await status(fixture)).toMatchObject({ eligibleQuantity: 1, readyQuantity: 1 });
        await query(adminClient, callback, { id: requested.id, state: 'Settled' });
        expect(await status(fixture)).toMatchObject({
            state: 'READY',
            eligibleQuantity: 1,
            readyQuantity: 1,
        });
        expect((await claim(fixture)).packages).toHaveLength(1);
    });
    it('pins paid private files to their purchased version and checks real download and refund authorization', async () => {
        const original = await uploadVersion('SYNTHETIC-FILE-VERSION-A');
        const later = await uploadVersion('SYNTHETIC-FILE-VERSION-B');
        const product = await variant('file_download', original.id);
        const fixture = await checkout(product.id, 1, pendingProvider.code);
        const reservation = await connection
            .getRepository(own, DigitalOrderReservation)
            .findOneByOrFail({ orderLineId: fixture.line.id });
        expect(encode(requireFixture(reservation.fileVersionId))).toBe(original.id);
        const scanned = await scan(fixture.client, getContents, receiptVariables(fixture));
        expect(scanned.myDigitalDeliveryContents[0]).toMatchObject({
            state: 'READY',
            packages: [],
            downloadUrl: null,
            claimedQuantity: 0,
        });
        const claimed = await claim(fixture);
        expect(claimed.downloadUrl).toMatch(/^\/digital-delivery\//);
        const fileTokens = server.app.get(DigitalDeliveryTokenService);
        const signed = requireFixture(
            fileTokens.verifyToken(decodeURIComponent(claimed.downloadUrl.split('/').pop())),
        );
        const { expiresAt: _expiresAt, ...scope } = signed;
        const expiredLink = fileTokens.createToken(scope, Date.now() - 16 * 60 * 1000).token;
        expect(
            (await fixture.client.fetch(apiOrigin + '/digital-delivery/' + encodeURIComponent(expiredLink)))
                .status,
        ).toBe(404);
        await query(
            adminClient,
            gql`
                mutation ($input: UpdateDigitalVariantConfigInput!) {
                    updateDigitalVariantConfig(input: $input) {
                        id
                        fileVersionId
                    }
                }
            `,
            {
                input: {
                    productVariantId: encode(product.id),
                    deliveryMode: 'file_download',
                    stockPolicy: 'unlimited',
                    fileVersionId: later.id,
                },
            },
        );
        const response = await fixture.client.fetch(apiOrigin + claimed.downloadUrl);
        expect(response.status).toBe(200);
        expect(response.headers.get('cache-control')).toContain('no-store');
        expect(await response.text()).toBe('SYNTHETIC-FILE-VERSION-A');
        const afterProductChange = await claim(fixture);
        expect(await (await fixture.client.fetch(apiOrigin + afterProductChange.downloadUrl)).text()).toBe(
            'SYNTHETIC-FILE-VERSION-A',
        );
        expect(
            (
                await fixture.client.fetch(apiOrigin + claimed.downloadUrl, {
                    headers: { 'x-forwarded-host': 'wrong-store.example.invalid' },
                })
            ).status,
        ).toBe(404);
        const requested = await refund(fixture, 1);
        expect(requested.state).toBe('Pending');
        expect(await status(fixture)).toMatchObject({ state: 'UNAVAILABLE', eligibleQuantity: 0 });
        expect((await fixture.client.fetch(apiOrigin + claimed.downloadUrl)).status).toBe(404);
        await expect(claim(fixture)).rejects.toThrow(/退款|停止|准备/);
        await query(
            adminClient,
            gql`
                mutation ($id: ID!, $state: String!) {
                    syntheticDigitalRefundCallback(refundId: $id, state: $state) {
                        id
                        state
                    }
                }
            `,
            { id: requested.id, state: 'Failed' },
        );
        expect((await fixture.client.fetch(apiOrigin + claimed.downloadUrl)).status).toBe(200);
        const retried = (
            await query(
                adminClient,
                gql`
                    mutation ($input: RetryRefundInput!) {
                        retryRefund(input: $input) {
                            ... on Refund {
                                id
                                state
                            }
                            ... on ErrorResult {
                                message
                            }
                        }
                    }
                `,
                { input: { refundId: requested.id, idempotencyKey: 'synthetic-file-retry:' + randomUUID() } },
            )
        ).retryRefund;
        expect(retried.state).toBe('Pending');
        await query(
            adminClient,
            gql`
                mutation ($id: ID!, $state: String!) {
                    syntheticDigitalRefundCallback(refundId: $id, state: $state) {
                        id
                        state
                    }
                }
            `,
            { id: requested.id, state: 'Settled' },
        );
        expect((await fixture.client.fetch(apiOrigin + claimed.downloadUrl)).status).toBe(404);
        await expect(claim(fixture)).rejects.toThrow();
    });
    it('exits file modification without duplicating old fulfillment and fulfills only an actually paid increase', async () => {
        const file = await uploadVersion('SYNTHETIC-FILE-MODIFICATION');
        const product = await variant('file_download', file.id);
        const physical = await physicalVariant();
        const fixture = await checkout(product.id, 1, settledProvider.code, physical.id);
        const initial = (await query(adminClient, readOrder, { id: encode(fixture.order.id) })).order;
        expect(initial.state).toBe('PartiallyDelivered');
        const begin = gql`
            mutation ($id: ID!) {
                transitionOrderToState(id: $id, state: "Modifying") {
                    ... on Order {
                        id
                        state
                    }
                    ... on ErrorResult {
                        message
                    }
                }
            }
        `;
        const finish = gql`
            mutation ($id: ID!) {
                finishOrderModification(orderId: $id) {
                    id
                    state
                }
            }
        `;
        await query(adminClient, begin, { id: encode(fixture.order.id) });
        await query(adminClient, finish, { id: encode(fixture.order.id) });
        const unchanged = (await query(adminClient, readOrder, { id: encode(fixture.order.id) })).order;
        expect(unchanged.state).toBe('PartiallyDelivered');
        expect(unchanged.fulfillments.map((item: any) => item.id)).toEqual(
            initial.fulfillments.map((item: any) => item.id),
        );
        await query(adminClient, begin, { id: encode(fixture.order.id) });
        await query(
            adminClient,
            gql`
                mutation ($input: ModifyOrderInput!) {
                    modifyOrder(input: $input) {
                        ... on Order {
                            id
                            state
                        }
                        ... on ErrorResult {
                            message
                        }
                    }
                }
            `,
            {
                input: {
                    orderId: encode(fixture.order.id),
                    dryRun: false,
                    adjustOrderLines: [{ orderLineId: encode(fixture.line.id), quantity: 2 }],
                },
            },
        );
        expect(
            (await query(adminClient, finish, { id: encode(fixture.order.id) })).finishOrderModification
                .state,
        ).toBe('ArrangingAdditionalPayment');
        await expect(claim(fixture)).rejects.toThrow();
        const additionalQuote = (
            await query(
                fixture.client,
                gql`
                    query ($id: ID!, $token: String) {
                        orderAdditionalPaymentQuote(orderId: $id, confirmationToken: $token) {
                            outstandingAmount
                            blockedReason
                            methods {
                                code
                                isEligible
                            }
                        }
                    }
                `,
                { id: encode(fixture.order.id), token: fixture.token },
            )
        ).orderAdditionalPaymentQuote;
        expect(additionalQuote.blockedReason).toBeNull();
        expect(additionalQuote.outstandingAmount).toBeGreaterThan(0);
        const payModified = gql`
            mutation ($input: OrderAdditionalPaymentInput!) {
                addPaymentToModifiedOrder(input: $input) {
                    ... on Order {
                        id
                        state
                    }
                    ... on ErrorResult {
                        errorCode
                        message
                    }
                }
            }
        `;
        const paymentInput = {
            orderId: encode(fixture.order.id),
            confirmationToken: fixture.token,
            expectedAmount: additionalQuote.outstandingAmount,
            payment: { method: settledProvider.code, metadata: {} },
        };
        await expect(
            query(fixture.client, payModified, { input: { ...paymentInput, confirmationToken: undefined } }),
        ).rejects.toThrow();
        await expect(
            query(fixture.client, payModified, {
                input: { ...paymentInput, expectedAmount: additionalQuote.outstandingAmount + 1 },
            }),
        ).rejects.toThrow('金额已变化');
        const beforePayment = await connection.getEntityOrThrow(own, Order, fixture.order.id, {
            relations: ['payments'],
        });
        const submitted = await Promise.allSettled([
            query(fixture.client, payModified, { input: paymentInput }),
            query(fixture.client, payModified, { input: paymentInput }),
        ]);
        const completed = submitted.filter(
            (result): result is PromiseFulfilledResult<any> => result.status === 'fulfilled',
        );
        expect(completed).toHaveLength(1);
        expect(submitted.filter(result => result.status === 'rejected')).toHaveLength(1);
        const payment = completed[0].value.addPaymentToModifiedOrder;
        expect(payment.errorCode, payment.message).toBeUndefined();
        expect(payment.state, 'Successful Shop additional payment must resume order processing').not.toBe(
            'ArrangingAdditionalPayment',
        );
        const increased = (await query(adminClient, readOrder, { id: encode(fixture.order.id) })).order;
        expect(increased.payments).toHaveLength(beforePayment.payments.length + 1);
        const rows = increased.fulfillments.flatMap((item: any) => item.lines);
        expect(rows.reduce((sum: number, line: any) => sum + line.quantity, 0)).toBe(2);
        expect(increased.fulfillments.every((item: any) => item.state === 'Delivered')).toBe(true);
        expect(await status(fixture)).toMatchObject({ state: 'READY', eligibleQuantity: 2 });
        const reservation = await connection
            .getRepository(own, DigitalOrderReservation)
            .findOneByOrFail({ orderLineId: fixture.line.id });
        expect(reservation.quantity).toBe(2);
        expect(reservation.consumedQuantity).toBe(2);
    });
    it('reveals sold cards only with the dedicated permission and audits same-store access', async () => {
        const product = await variant('auto_card');
        await addCards(product.id, 2);
        const fixture = await checkout(product.id, 2);
        const delivery = await connection
            .getRepository(own, AutoCardDelivery)
            .findOneByOrFail({ orderLineId: fixture.line.id });
        await expect(query(reader, revealCards, { id: encode(delivery.id) })).rejects.toThrow();
        const before = await connection
            .getRepository(own, AutoCardDeliveryEvent)
            .count({ where: { deliveryId: delivery.id } });
        const result = (await query(revealer, revealCards, { id: encode(delivery.id) }))
            .revealMyOrderAutoCards;
        expect(result).toHaveLength(2);
        expect(result[0].find((field: any) => field.secret).value).toBe('SYNTHETIC-PASSWORD');
        expect(
            await connection
                .getRepository(own, AutoCardDeliveryEvent)
                .count({ where: { deliveryId: delivery.id, type: 'SECRET_REVEALED' } }),
        ).toBe(1);
        expect(
            await connection
                .getRepository(own, AutoCardDeliveryEvent)
                .count({ where: { deliveryId: delivery.id } }),
        ).toBe(before + 1);
        revealer.setChannelToken(foreign.channel.token);
        try {
            await expect(query(revealer, revealCards, { id: encode(delivery.id) })).rejects.toThrow();
        } finally {
            revealer.setChannelToken(own.channel.token);
        }
    });
    it('restores a legacy paid card shortage by import and resends the original allocation without taking new cards', async () => {
        const product = await variant('auto_card');
        await addCards(product.id, 2);
        const orders = server.app.get(OrderService);
        // Historical paid order with no checkout hold: a legitimate recovery case for WAITING_STOCK.
        const order = await orders.create(own);
        const added = await orders.addItemToOrder(own, order.id, product.id, 2);
        if ('errorCode' in added) throw new Error(added.message);
        const pool = (
            await query(
                adminClient,
                gql`
                    query ($id: ID!) {
                        autoCardPoolItems(productVariantId: $id) {
                            items {
                                id
                                state
                            }
                        }
                    }
                `,
                { id: encode(product.id) },
            )
        ).autoCardPoolItems.items;
        for (const item of pool)
            await query(
                adminClient,
                gql`
                    mutation ($id: ID!) {
                        setAutoCardPoolItemEnabled(
                            id: $id
                            enabled: false
                            reason: "Synthetic historical shortage"
                        ) {
                            id
                            state
                        }
                    }
                `,
                { id: item.id },
            );
        const line = await connection
            .getRepository(own, OrderLine)
            .findOneByOrFail({ order: { id: order.id } });
        await connection.getRepository(own, OrderLine).update(line.id, {
            orderPlacedQuantity: 2,
            customFields: {
                fulfillmentTypeSnapshot: 'digital',
                digitalDeliveryModeSnapshot: 'auto_card',
            },
        });
        await connection.getRepository(own, Order).update(order.id, {
            active: false,
            state: 'PaymentSettled',
            orderPlacedAt: new Date(),
            customFields: { deliveryEmail: 'synthetic-shortage@example.invalid' },
        });
        await connection.getRepository(own, Payment).save(
            new Payment({
                order,
                state: 'Settled',
                amount: added.totalWithTax,
                method: settledProvider.code,
                transactionId: 'LOCAL-LEGACY-PAYMENT-' + String(order.id),
                metadata: {},
            }),
        );
        await connection.withTransaction(own, async ctx => {
            const current = await connection.getEntityOrThrow(ctx, Order, order.id, {
                relations: ['lines', 'lines.productVariant', 'payments'],
            });
            await server.app.get(AutoCardService).allocateSettledOrder(ctx, current);
        });
        const waiting = await connection
            .getRepository(own, AutoCardDelivery)
            .findOneByOrFail({ orderLineId: line.id });
        expect(waiting.state).toBe('WAITING_STOCK');
        expect((await addCards(product.id, 3)).importedCount).toBe(3);
        const allocated = await connection
            .getRepository(own, AutoCardDelivery)
            .findOneOrFail({ where: { id: waiting.id }, relations: ['poolItems'] });
        expect(allocated.poolItems).toHaveLength(2);
        const originalIds = allocated.poolItems.map(item => String(item.id)).sort();
        // Simulate an external notification failure without changing allocation or delivery rights.
        await connection.getRepository(own, AutoCardDelivery).update(waiting.id, {
            state: 'MANUAL_REVIEW',
            lastError: 'Synthetic notification failure',
            lastDispatchedAt: new Date(0),
        });
        await query(
            adminClient,
            gql`
                mutation ($id: ID!) {
                    retryAutoCardDelivery(id: $id) {
                        id
                        state
                    }
                }
            `,
            { id: encode(waiting.id) },
        );
        const resent = await connection
            .getRepository(own, AutoCardDelivery)
            .findOneOrFail({ where: { id: waiting.id }, relations: ['poolItems'] });
        expect(resent.poolItems.map(item => String(item.id)).sort()).toEqual(originalIds);
        expect(
            await connection
                .getRepository(own, AutoCardPoolItem)
                .count({ where: { configId: resent.configId, state: 'AVAILABLE' } }),
        ).toBe(1);
        await expect
            .poll(
                () =>
                    notices.filter(item => item.kind === 'card' && item.deliveryId === String(waiting.id))
                        .length,
            )
            .toBeGreaterThanOrEqual(2);
    });
});

function requireFixture<T>(value: T | null | undefined): T {
    assert(value !== null && value !== undefined, 'Required synthetic fixture is missing');
    return value;
}

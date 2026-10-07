import { CatalogManagementPlugin } from '@vendure/catalog-management-plugin';
import { GlobalFlag } from '@vendure/common/lib/generated-types';
import { ContentTranslationPlugin } from '@vendure/content-translation-plugin';
import {
    Administrator,
    ChannelService,
    CurrencyCode,
    Customer,
    LanguageCode,
    mergeConfig,
    Order,
    OrderService,
    ProductService,
    ProductVariantService,
    RequestContextService,
    Role,
    RoleService,
    StockLocationService,
    TransactionalConnection,
} from '@vendure/core';
import { OperationsDashboardPlugin } from '@vendure/operations-dashboard-plugin';
import { StoreDomain, StoreDomainPlugin } from '@vendure/store-domain-plugin';
import { StoreManagementPlugin } from '@vendure/store-management-plugin';
import { StorefrontCartPlugin } from '@vendure/storefront-cart-plugin';
import { createTestEnvironment, testConfig } from '@vendure/testing';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

import { initialData } from '../../../../e2e-common/e2e-initial-data';
import { StoreProfile } from '../../../store-management-plugin/src/entities/store-profile.entity';
import { StoreCouponLifecycleService } from '../../../store-management-plugin/src/promotion/store-coupon-lifecycle.service';
import { StorePromotionCampaignService } from '../../../store-management-plugin/src/promotion/store-promotion-campaign.service';
import { CommerceFulfillmentPlugin } from '../../src/commerce-fulfillment.plugin';
import { closureDatabase } from '../order-closure-db';

const output = resolve(
    __dirname,
    '../../../../docs/public-preview-closure-20261006/authorized-execution-20261007/legacy-mysql-fixture',
    randomUUID(),
);
const names = [
    'DIGITAL_DELIVERY_STORAGE_DIR',
    'DIGITAL_DELIVERY_SIGNING_SECRET',
    'AUTO_CARD_ENCRYPTION_KEY',
] as const;
const prior = new Map(names.map(name => [name, process.env[name]]));
process.env.DIGITAL_DELIVERY_STORAGE_DIR = resolve(output, 'digital');
process.env.DIGITAL_DELIVERY_SIGNING_SECRET = randomBytes(32).toString('base64url');
process.env.AUTO_CARD_ENCRYPTION_KEY = randomBytes(32).toString('base64url');
const { server } = createTestEnvironment(
    mergeConfig(testConfig, {
        apiOptions: { port: 37490, hostname: '127.0.0.1' },
        dbConnectionOptions: closureDatabase(output),
        authOptions: { requireVerification: false },
        plugins: [
            OperationsDashboardPlugin,
            CatalogManagementPlugin,
            StoreDomainPlugin,
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
            StoreManagementPlugin.init({
                enabled: false,
                signingSecret: randomBytes(32).toString('base64url'),
            }),
            CommerceFulfillmentPlugin.init({
                testPaymentsEnabled: true,
                evidenceStorage: { rootDirectory: resolve(output, 'evidence'), signingSecret: randomUUID() },
            }),
        ],
    }),
);

export async function initializeLegacyFixture() {
    mkdirSync(output, { recursive: true });
    await server.init({
        initialData: { ...initialData, collections: [], paymentMethods: [] },
        customerCount: 1,
    });
    const connection = server.app.get(TransactionalConnection);
    const contexts = server.app.get(RequestContextService);
    const administrator = await connection.rawConnection.getRepository(Administrator).findOneOrFail({
        where: {},
        relations: ['user', 'user.roles', 'user.roles.channels'],
    });
    const platform = await contexts.create({ apiType: 'admin', user: administrator.user });
    const channel = await server.app.get(ChannelService).create(platform, {
        code: 'synthetic-legacy-compensation',
        token: 'synthetic-legacy-compensation',
        defaultLanguageCode: LanguageCode.en,
        currencyCode: CurrencyCode.GBP,
        pricesIncludeTax: false,
        defaultTaxZoneId: platform.channel.defaultTaxZone?.id ?? '',
        defaultShippingZoneId: platform.channel.defaultShippingZone?.id ?? '',
        customFields: { commerceMode: 'HYBRID' },
    });
    if (!('id' in channel)) throw new Error(channel.message);
    if (String(channel.id) !== '2')
        throw new Error('Synthetic whitelist fixture requires its fresh channel 2');
    const role = await server.app.get(RoleService).getSuperAdminRole(platform);
    await connection
        .getRepository(platform, Role)
        .createQueryBuilder()
        .relation(Role, 'channels')
        .of(role.id)
        .add(channel.id);
    const customer = await connection
        .getRepository(platform, Customer)
        .findOneOrFail({ where: {}, relations: ['user', 'user.roles', 'user.roles.channels'] });
    if (!customer.user) throw new Error('Synthetic customer account missing');
    await server.app.get(ChannelService).assignToChannels(platform, Customer, customer.id, [channel.id]);
    const ctx = await contexts.create({
        apiType: 'shop',
        channelOrToken: channel.token,
        user: customer.user,
    });
    const freshAdministrator = await connection.getRepository(platform, Administrator).findOneByOrFail({
        id: administrator.id,
    });
    const adminUser = await connection.rawConnection.getRepository(Administrator).findOneOrFail({
        where: { id: freshAdministrator.id },
        relations: ['user', 'user.roles', 'user.roles.channels'],
    });
    const adminCtx = await contexts.create({
        apiType: 'admin',
        channelOrToken: channel.token,
        user: adminUser.user,
    });
    const readonlyAdminCtx = await contexts.create({
        apiType: 'admin',
        channelOrToken: channel.token,
        user: customer.user,
    });
    await connection.getRepository(adminCtx, StoreProfile).save(
        new StoreProfile({
            channelId: channel.id,
            status: 'DRAFT',
            isPublished: true,
            sortOrder: 0,
            descriptionZh: '',
            descriptionEn: '',
        }),
    );
    await connection.getRepository(adminCtx, StoreDomain).save(
        new StoreDomain({
            channelId: channel.id,
            domain: 'synthetic-legacy.example.invalid',
            status: 'ACTIVE',
            isPrimary: true,
            primaryChannelId: channel.id,
            verifiedAt: new Date(),
            verificationToken: randomUUID(),
        }),
    );
    const location = await server.app
        .get(StockLocationService)
        .create(adminCtx, { name: 'Synthetic original warehouse' });
    const product = await server.app.get(ProductService).create(adminCtx, {
        translations: [
            {
                languageCode: LanguageCode.en,
                name: 'Synthetic legacy physical',
                slug: 'synthetic-legacy-physical',
                description: 'Disposable local historical compensation fixture',
            },
            {
                languageCode: LanguageCode.zh_Hans,
                name: '合成历史实物',
                slug: 'synthetic-legacy-physical',
                description: '本地隔离历史补偿验证',
            },
        ],
        customFields: { fulfillmentType: 'physical' },
    });
    const [variant] = await server.app.get(ProductVariantService).create(adminCtx, [
        {
            productId: product.id,
            sku: 'SYNTHETIC-LEGACY-PHYSICAL',
            price: 1000,
            trackInventory: GlobalFlag.TRUE,
            stockLevels: [{ stockLocationId: location.id, stockOnHand: 1000 }],
            translations: [
                { languageCode: LanguageCode.en, name: 'Synthetic legacy physical' },
                { languageCode: LanguageCode.zh_Hans, name: '合成历史实物规格' },
            ],
        },
    ]);
    const campaign = await server.app.get(StorePromotionCampaignService).createCoupon(adminCtx, {
        name: 'Synthetic legacy coupon',
        kind: 'ORDER_FIXED',
        discountAmount: 100,
        minimumSpend: 0,
        validityDays: 7,
        issueLimit: 100,
    });
    const orders = server.app.get(OrderService);
    // Keep native service-generated shells outside the exact production repair whitelist.
    const shell = await orders.create(ctx, customer.user.id);
    await connection.getRepository(ctx, Order).update(shell.id, { active: false });
    const sequence = new Order();
    for (const column of connection.rawConnection.getMetadata(Order).columns) {
        column.setEntityValue(sequence, column.getEntityValue(shell));
    }
    Object.assign(sequence, { id: 1000, code: 'synthetic-legacy-sequence', active: false });
    sequence.channels = await orders.getOrderChannels(ctx, shell);
    await connection.getRepository(ctx, Order).save(sequence);
    return {
        server,
        connection,
        ctx,
        adminCtx,
        readonlyAdminCtx,
        platform,
        customer,
        orders,
        coupons: server.app.get(StoreCouponLifecycleService),
        location,
        physicalId: variant.id,
        productId: product.id,
        couponCampaignId: campaign.id,
        output,
    };
}

export async function destroyLegacyFixture() {
    await server.destroy();
    for (const name of names) {
        const value = prior.get(name);
        if (value == null) delete process.env[name];
        else process.env[name] = value;
    }
}

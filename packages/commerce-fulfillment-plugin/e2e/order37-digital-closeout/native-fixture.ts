import { GlobalFlag } from '@vendure/common/lib/generated-types';
import {
    Administrator,
    ChannelService,
    CurrencyCode,
    Customer,
    LanguageCode,
    Product,
    ProductService,
    ProductVariant,
    ProductVariantService,
    RequestContextService,
    Role,
    RoleService,
    StockLevel,
    StockLocation,
    StockLocationService,
} from '@vendure/core';
import { StoreDomain } from '@vendure/store-domain-plugin';
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

import { StoreProfile } from '../../../store-management-plugin/src/entities/store-profile.entity';
import { StorePromotionCampaignService } from '../../../store-management-plugin/src/promotion/store-promotion-campaign.service';
import { destroyLegacyFixture, initializeLegacyFixture } from '../legacy-preview-compensation/native-fixture';

/** Fresh, synthetic channel 5. Never connects to a production database or provider. */
export async function initializeOrder37Fixture() {
    const base = await initializeLegacyFixture();
    const { server, connection, platform, customer } = base;
    const channels = server.app.get(ChannelService);
    let channel = platform.channel;
    for (const index of [3, 4, 5]) {
        const created = await channels.create(platform, {
            code: `synthetic-order37-channel-${index}`,
            token: `synthetic-order37-channel-${index}`,
            defaultLanguageCode: LanguageCode.en,
            currencyCode: CurrencyCode.GBP,
            pricesIncludeTax: false,
            defaultTaxZoneId: platform.channel.defaultTaxZone?.id ?? '',
            defaultShippingZoneId: platform.channel.defaultShippingZone?.id ?? '',
            customFields: { commerceMode: 'HYBRID' },
        });
        if (!('id' in created)) throw new Error(created.message);
        if (String(created.id) !== String(index))
            throw new Error('Fresh synthetic channel sequence mismatch');
        channel = created;
    }
    const role = await server.app.get(RoleService).getSuperAdminRole(platform);
    await connection
        .getRepository(platform, Role)
        .createQueryBuilder()
        .relation(Role, 'channels')
        .of(role.id)
        .add(channel.id);
    await channels.assignToChannels(platform, Customer, customer.id, [channel.id]);
    const administrator = await connection.rawConnection.getRepository(Administrator).findOneOrFail({
        where: {},
        relations: ['user', 'user.roles', 'user.roles.channels'],
    });
    const contexts = server.app.get(RequestContextService);
    const adminCtx = await contexts.create({
        apiType: 'admin',
        channelOrToken: channel.token,
        user: administrator.user,
    });
    const ctx = await contexts.create({
        apiType: 'shop',
        channelOrToken: channel.token,
        user: customer.user,
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
            domain: 'synthetic-order37.example.invalid',
            status: 'ACTIVE',
            isPrimary: true,
            primaryChannelId: channel.id,
            verifiedAt: new Date(),
            verificationToken: randomUUID(),
        }),
    );
    if (connection.rawConnection.options.type !== 'mysql')
        throw new Error('The exact historical fixture requires its owned UUID MySQL database');
    // Advance fresh fixture sequences before native creation, preserving all native FKs,
    // translations and channel price rows. These ALTERs never run on an existing database.
    for (const [entity, nextId] of [
        [StockLocation, 10],
        [Product, 5907],
        [ProductVariant, 1093],
    ] as const) {
        const table = connection.rawConnection.getMetadata(entity).tableName;
        if (!/^[a-z_]+$/.test(table)) throw new Error('Unexpected native fixture table name');
        await connection.rawConnection.query(`ALTER TABLE \`${table}\` AUTO_INCREMENT = ${nextId}`);
    }
    const location = await server.app
        .get(StockLocationService)
        .create(adminCtx, { name: 'Synthetic order37 original warehouse' });
    const product = await server.app.get(ProductService).create(adminCtx, {
        translations: [
            {
                languageCode: LanguageCode.en,
                name: 'Synthetic historical digital manual service',
                slug: 'synthetic-order37-digital',
                description: 'Disposable local historical digital closure fixture',
            },
            {
                languageCode: LanguageCode.zh_Hans,
                name: '合成历史数字人工服务',
                slug: 'synthetic-order37-digital',
                description: '隔离验证',
            },
        ],
        customFields: { fulfillmentType: 'digital' },
    });
    const [variant] = await server.app.get(ProductVariantService).create(adminCtx, [
        {
            productId: product.id,
            sku: 'SYNTHETIC-ORDER37-DIGITAL',
            price: 50,
            translations: [
                { languageCode: LanguageCode.en, name: 'Synthetic order37 manual service' },
                { languageCode: LanguageCode.zh_Hans, name: '合成历史人工数字规格' },
            ],
            customFields: { digitalDeliveryMode: 'manual_service', digitalStockPolicy: 'limited' },
        },
    ]);
    // Model the genuine historical digital + warehouse-allocation shape. This fixture-only
    // write must never be performed by the closeout executor against a live variant.
    await connection
        .getRepository(adminCtx, ProductVariant)
        .update(variant.id, { trackInventory: GlobalFlag.TRUE });
    // Native APIs correctly prohibit creating new warehouse stock for digital products.
    // Seed only the already-existing historical row; native flow/release must then use it.
    await connection.getRepository(adminCtx, StockLevel).save(
        new StockLevel({
            productVariantId: variant.id,
            stockLocationId: location.id,
            stockOnHand: 100,
            stockAllocated: 0,
        }),
    );
    const campaign = await server.app.get(StorePromotionCampaignService).createCoupon(adminCtx, {
        name: 'Synthetic order37 historical coupon',
        kind: 'ORDER_FIXED',
        discountAmount: 10,
        minimumSpend: 0,
        validityDays: 7,
        issueLimit: 100,
    });
    const output = resolve(
        __dirname,
        '../../../../docs/public-preview-closure-20261006/authorized-execution-20261007/order37-digital-fixture',
        randomUUID(),
    );
    mkdirSync(output, { recursive: true });
    return {
        ...base,
        ctx,
        adminCtx,
        readonlyAdminCtx,
        location,
        digitalId: variant.id,
        productId: product.id,
        couponCampaignId: campaign.id,
        output,
    };
}

export { destroyLegacyFixture as destroyOrder37Fixture };

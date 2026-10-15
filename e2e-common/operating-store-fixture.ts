import type { INestApplication } from '@nestjs/common';
import {
    ChannelService,
    ConfigService,
    CurrencyCode,
    LanguageCode,
    Permission,
    RequestContextService,
    Role,
    RoleService,
    TransactionalConnection,
    User,
    ZoneService,
} from '@vendure/core';
import { StoreDomain } from '@vendure/store-domain-plugin';
import { StoreProfile } from '@vendure/store-management-plugin';
import { randomUUID } from 'node:crypto';

/** Synthetic operating store in the isolated E2E database, never the management Channel. */
export async function createOperatingStoreFixture(
    app: INestApplication,
    input: {
        code: string;
        currencyCode: CurrencyCode;
        defaultLanguageCode: LanguageCode;
        commerceMode: 'DIGITAL_ONLY' | 'PHYSICAL_ONLY' | 'HYBRID';
    },
) {
    const connection = app.get(TransactionalConnection);
    const contexts = app.get(RequestContextService);
    const credentials = app.get(ConfigService).authOptions.superadminCredentials;
    const admin = await connection.rawConnection.getRepository(User).findOneOrFail({
        where: { identifier: credentials.identifier },
        relations: ['roles', 'roles.channels'],
    });
    const root = await contexts.create({ apiType: 'admin', user: admin });
    const platform = await app.get(ChannelService).findOne(root, root.channelId);
    const fallbackZone =
        !platform?.defaultTaxZone || !platform.defaultShippingZone
            ? await app.get(ZoneService).create(root, { name: `${input.code} fixture zone` })
            : undefined;
    const taxZone = platform?.defaultTaxZone ?? fallbackZone;
    const shippingZone = platform?.defaultShippingZone ?? fallbackZone;
    if (!taxZone || !shippingZone) throw new Error('Operating-store fixture requires its own zones');
    const channel = await app.get(ChannelService).create(root, {
        code: input.code,
        currencyCode: input.currencyCode,
        defaultLanguageCode: input.defaultLanguageCode,
        token: input.code,
        pricesIncludeTax: false,
        availableLanguageCodes: [LanguageCode.en, LanguageCode.zh_Hans],
        defaultTaxZoneId: taxZone.id,
        defaultShippingZoneId: shippingZone.id,
        customFields: { commerceMode: input.commerceMode },
    });
    if (!('id' in channel)) throw new Error('Operating-store fixture could not create its Channel');
    await connection.getRepository(root, StoreProfile).save(
        new StoreProfile({
            channelId: channel.id,
            status: 'ACTIVE',
            isPublished: true,
            descriptionZh: '隔离测试店铺',
            descriptionEn: 'Isolated test store',
        }),
    );
    await connection.getRepository(root, StoreDomain).save(
        new StoreDomain({
            channelId: channel.id,
            domain: `${input.code}.example.invalid`,
            status: 'ACTIVE',
            isPrimary: true,
            primaryChannelId: channel.id,
            verifiedAt: new Date(),
            verificationToken: randomUUID(),
        }),
    );
    const role = admin.roles.find(item => item.permissions.includes(Permission.SuperAdmin));
    if (!role) throw new Error('Operating-store fixture requires the synthetic SuperAdmin role');
    const customerRole = await app.get(RoleService).getCustomerRole(root);
    for (const scopedRole of [role, customerRole]) {
        await connection.rawConnection
            .createQueryBuilder()
            .relation(Role, 'channels')
            .of(scopedRole.id)
            .add(channel.id);
    }
    return channel;
}

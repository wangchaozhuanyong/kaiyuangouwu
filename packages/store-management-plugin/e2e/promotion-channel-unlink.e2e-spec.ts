import { LanguageCode } from '@vendure/common/lib/generated-types';
import {
    ContentTranslationPlugin,
    type ContentTranslationProvider,
} from '@vendure/content-translation-plugin';
import {
    ConfigService,
    mergeConfig,
    Promotion,
    RequestContextService,
    TransactionalConnection,
} from '@vendure/core';
import { OperationsDashboardPlugin } from '@vendure/operations-dashboard-plugin';
import { StorefrontCartPlugin } from '@vendure/storefront-cart-plugin';
import { StorefrontContentPlugin } from '@vendure/storefront-content-plugin';
import { createTestEnvironment } from '@vendure/testing';
import gql from 'graphql-tag';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { initialData } from '../../../e2e-common/e2e-initial-data';
import { TEST_SETUP_TIMEOUT_MS, testConfig } from '../../../e2e-common/test-config';
import { StoreManagementPlugin } from '../src/store-management.plugin';

const provider: ContentTranslationProvider = {
    name: 'promotion-unlink-local-fixture',
    isConfigured: () => true,
    translate: request =>
        Promise.resolve({
            provider: 'promotion-unlink-local-fixture',
            translations: request.segments.map(s => ({ key: s.key, text: s.text })),
        }),
};
const { server, adminClient } = createTestEnvironment(
    mergeConfig(testConfig(), {
        plugins: [
            OperationsDashboardPlugin,
            StorefrontCartPlugin,
            StorefrontContentPlugin,
            ContentTranslationPlugin.init({ provider }),
            StoreManagementPlugin.init({
                enabled: false,
                signingSecret: 'promotion-unlink-disposable-test-fixture-32-chars',
            }),
        ],
    }),
);
function configuredEntityIdStrategy() {
    const strategy = server.app.get(ConfigService).entityOptions.entityIdStrategy;
    if (!strategy) throw new Error('Test ID strategy missing');
    return strategy;
}
describe('platform promotion association administration', () => {
    beforeAll(async () => {
        await server.init({
            initialData: { ...initialData, defaultLanguage: LanguageCode.zh_Hans, collections: [] },
            customerCount: 0,
        });
        await server.app.get(TransactionalConnection).rawConnection.synchronize();
        await adminClient.asSuperAdmin();
    }, TEST_SETUP_TIMEOUT_MS);
    afterAll(async () => {
        await server.destroy();
    });
    it('unlinks an ordinary promotion only as platform SuperAdmin and preserves rules and other channels', async () => {
        // Disposable local fixture for an existing legacy multi-store activity.
        const channels: Array<{ id: string; token: string }> = [];
        for (const suffix of ['a', 'b']) {
            const token = `promotion-unlink-fixture-${suffix}`;
            const result = await adminClient.query(
                gql`
                    mutation ($input: CreateChannelInput!) {
                        createChannel(input: $input) {
                            ... on Channel {
                                id
                            }
                        }
                    }
                `,
                {
                    input: {
                        code: token,
                        token,
                        defaultLanguageCode: LanguageCode.en,
                        currencyCode: 'USD',
                        pricesIncludeTax: true,
                        defaultShippingZoneId: 'T_1',
                        defaultTaxZoneId: 'T_1',
                    },
                },
            );
            channels.push({ id: result.createChannel.id, token });
        }
        const promotion = (
            await adminClient.query(
                gql`
                    mutation ($input: CreatePromotionInput!) {
                        createPromotion(input: $input) {
                            ... on Promotion {
                                id
                            }
                        }
                    }
                `,
                {
                    input: {
                        enabled: true,
                        couponCode: 'SYNTHETIC-UNLINK-ONLY',
                        conditions: [],
                        actions: [
                            {
                                code: 'order_percentage_discount',
                                arguments: [{ name: 'discount', value: '10' }],
                            },
                        ],
                        translations: [
                            {
                                languageCode: LanguageCode.zh_Hans,
                                name: 'Ordinary unlink fixture',
                                description: 'Local fixture only',
                            },
                        ],
                    },
                },
            )
        ).createPromotion;
        const strategy = configuredEntityIdStrategy();
        const repository = server.app.get(TransactionalConnection).rawConnection.getRepository(Promotion);
        const id = strategy.decodeId(promotion.id);
        await repository
            .createQueryBuilder()
            .relation('channels')
            .of(id)
            .add(channels.map(c => strategy.decodeId(c.id)));
        const stored = () =>
            repository.findOneOrFail({ where: { id }, relations: { channels: true, translations: true } });
        const rule = (value: Promotion) => ({
            enabled: value.enabled,
            couponCode: value.couponCode,
            conditions: value.conditions,
            actions: value.actions,
            startsAt: value.startsAt,
            endsAt: value.endsAt,
            usageLimit: value.usageLimit,
            perCustomerUsageLimit: value.perCustomerUsageLimit,
            translations: value.translations.map(t => ({
                id: t.id,
                languageCode: t.languageCode,
                name: t.name,
                description: t.description,
            })),
        });
        const before = await stored();
        const unlink = gql`
            mutation ($input: RemovePromotionsFromChannelInput!) {
                removePromotionsFromChannel(input: $input) {
                    id
                }
            }
        `;
        const input = { promotionIds: [promotion.id], channelId: channels[1].id };
        adminClient.setRequestHeader('vendure-token', channels[0].token);
        try {
            await expect(adminClient.query(unlink, { input })).rejects.toThrow('平台商品分配中心');
        } finally {
            adminClient.setRequestHeader('vendure-token', null);
        }
        expect((await adminClient.query(unlink, { input })).removePromotionsFromChannel).toEqual([
            { id: promotion.id },
        ]);
        const after = await stored();
        expect(after.channels.map(c => c.id).sort()).toEqual(
            before.channels
                .filter(c => String(c.id) !== String(strategy.decodeId(channels[1].id)))
                .map(c => c.id)
                .sort(),
        );
        expect(rule(after)).toEqual(rule(before));
        const platform = await server.app.get(RequestContextService).create({ apiType: 'admin' });
        await expect(
            adminClient.query(unlink, {
                input: {
                    promotionIds: [promotion.id],
                    channelId: strategy.encodeId(platform.channelId),
                },
            }),
        ).rejects.toThrow();
        expect((await stored()).channels.map(c => c.id).sort()).toEqual(after.channels.map(c => c.id).sort());
    });

    it('keeps managed coupon removal behind its dedicated lifecycle entry', async () => {
        const coupon = (
            await adminClient.query(
                gql`
                    mutation ($input: CreateStoreCouponCampaignInput!) {
                        createStoreCouponCampaign(input: $input) {
                            id
                        }
                    }
                `,
                {
                    input: {
                        name: 'Local managed coupon fixture',
                        kind: 'ORDER_FIXED',
                        minimumSpend: 0,
                        discountAmount: 100,
                        issueLimit: 1,
                        validityDays: 7,
                    },
                },
            )
        ).createStoreCouponCampaign;
        await expect(
            adminClient.query(
                gql`
                    mutation ($input: RemovePromotionsFromChannelInput!) {
                        removePromotionsFromChannel(input: $input) {
                            id
                        }
                    }
                `,
                { input: { promotionIds: [coupon.id], channelId: 'T_1' } },
            ),
        ).rejects.toThrow('优惠券管理入口');
    });
});

import { Kind, TypeNode } from 'graphql';
import { describe, expect, it } from 'vitest';

import { adminApiExtensions, shopApiExtensions } from './api-extensions';

describe('store management API extensions', () => {
    it('uses Node items for every PaginatedList implementation', () => {
        const objectTypes = adminApiExtensions.definitions.filter(
            definition => definition.kind === Kind.OBJECT_TYPE_DEFINITION,
        );
        const nodeTypes = new Set(
            objectTypes
                .filter(definition => definition.interfaces?.some(item => item.name.value === 'Node'))
                .map(definition => definition.name.value),
        );
        const paginatedLists = objectTypes.filter(definition =>
            definition.interfaces?.some(item => item.name.value === 'PaginatedList'),
        );

        for (const list of paginatedLists) {
            const items = list.fields?.find(field => field.name.value === 'items');
            const itemType = items && namedType(items.type);
            expect(itemType, `${list.name.value}.items must resolve to a Node type`).toBeTruthy();
            expect(nodeTypes, `${list.name.value}.items must implement Node`).toContain(itemType);
        }
    });

    it('exposes flash-sale names only through the Admin API', () => {
        const adminFlashSale = adminApiExtensions.definitions.find(
            definition =>
                definition.kind === Kind.OBJECT_TYPE_DEFINITION && definition.name.value === 'StoreFlashSale',
        );
        const shopFlashSale = shopApiExtensions.definitions.find(
            definition =>
                definition.kind === Kind.OBJECT_TYPE_DEFINITION && definition.name.value === 'StoreFlashSale',
        );

        expect(adminFlashSale?.kind).toBe(Kind.OBJECT_TYPE_DEFINITION);
        expect(shopFlashSale?.kind).toBe(Kind.OBJECT_TYPE_DEFINITION);
        if (
            adminFlashSale?.kind !== Kind.OBJECT_TYPE_DEFINITION ||
            shopFlashSale?.kind !== Kind.OBJECT_TYPE_DEFINITION
        ) {
            throw new Error('StoreFlashSale type is missing');
        }
        expect(adminFlashSale.fields?.map(field => field.name.value)).toContain('name');
        expect(shopFlashSale.fields?.map(field => field.name.value)).not.toContain('name');
    });

    it('exposes an admin query for a selected customer referral wallets', () => {
        const query = adminApiExtensions.definitions.find(
            definition => definition.kind === Kind.OBJECT_TYPE_EXTENSION && definition.name.value === 'Query',
        );

        expect(query?.kind).toBe(Kind.OBJECT_TYPE_EXTENSION);
        if (query?.kind !== Kind.OBJECT_TYPE_EXTENSION) {
            throw new Error('Admin Query extension is missing');
        }
        expect(query.fields?.map(field => field.name.value)).toContain('referralCustomerWallets');
    });

    it('exposes store-scoped referral poster templates and their admin mutations', () => {
        const referralProgram = adminApiExtensions.definitions.find(
            definition =>
                definition.kind === Kind.OBJECT_TYPE_DEFINITION &&
                definition.name.value === 'ReferralProgram',
        );
        const mutation = adminApiExtensions.definitions.find(
            definition =>
                definition.kind === Kind.OBJECT_TYPE_EXTENSION && definition.name.value === 'Mutation',
        );

        expect(referralProgram?.kind).toBe(Kind.OBJECT_TYPE_DEFINITION);
        if (referralProgram?.kind === Kind.OBJECT_TYPE_DEFINITION) {
            expect(referralProgram.fields?.map(field => field.name.value)).toContain('posterTemplateConfigs');
        }
        expect(mutation?.kind).toBe(Kind.OBJECT_TYPE_EXTENSION);
        if (mutation?.kind === Kind.OBJECT_TYPE_EXTENSION) {
            expect(mutation.fields?.map(field => field.name.value)).toEqual(
                expect.arrayContaining([
                    'createReferralPosterTemplate',
                    'updateReferralPosterTemplate',
                    'deleteReferralPosterTemplate',
                ]),
            );
        }
    });

    it('exposes scoped announcements and Channel USDT administration only through the Admin API', () => {
        const adminQuery = adminApiExtensions.definitions.find(
            definition => definition.kind === Kind.OBJECT_TYPE_EXTENSION && definition.name.value === 'Query',
        );
        const adminMutation = adminApiExtensions.definitions.find(
            definition =>
                definition.kind === Kind.OBJECT_TYPE_EXTENSION && definition.name.value === 'Mutation',
        );
        const announcement = adminApiExtensions.definitions.find(
            definition =>
                definition.kind === Kind.OBJECT_TYPE_DEFINITION &&
                definition.name.value === 'SystemAnnouncement',
        );
        const updateAnnouncementInput = adminApiExtensions.definitions.find(
            definition =>
                definition.kind === Kind.INPUT_OBJECT_TYPE_DEFINITION &&
                definition.name.value === 'UpdateSystemAnnouncementInput',
        );
        const shopQuery = shopApiExtensions.definitions.find(
            definition => definition.kind === Kind.OBJECT_TYPE_EXTENSION && definition.name.value === 'Query',
        );

        if (
            adminQuery?.kind !== Kind.OBJECT_TYPE_EXTENSION ||
            adminMutation?.kind !== Kind.OBJECT_TYPE_EXTENSION ||
            announcement?.kind !== Kind.OBJECT_TYPE_DEFINITION ||
            updateAnnouncementInput?.kind !== Kind.INPUT_OBJECT_TYPE_DEFINITION ||
            shopQuery?.kind !== Kind.OBJECT_TYPE_EXTENSION
        ) {
            throw new Error('Expected API extension types are missing');
        }
        expect(adminQuery.fields?.map(field => field.name.value)).toEqual(
            expect.arrayContaining([
                'myStoreUsdtWallet',
                'myStoreUsdtPaymentStats',
                'storeUsdtWallets',
                'storeUsdtPaymentStats',
                'myStorePaymentStats',
                'myStorePaymentDetails',
                'myStoreUsdtManualRefunds',
                'storePaymentStats',
                'storePaymentDetails',
                'storeUsdtManualRefunds',
            ]),
        );
        expect(adminMutation.fields?.map(field => field.name.value)).toEqual(
            expect.arrayContaining([
                'submitMyStoreUsdtWallet',
                'reviewStoreUsdtWallet',
                'recordStoreUsdtManualRefund',
            ]),
        );
        expect(announcement.fields?.map(field => field.name.value)).toEqual(
            expect.arrayContaining(['targetMode', 'channels']),
        );
        expect(announcement.fields?.map(field => field.name.value)).toHaveLength(
            new Set(announcement.fields?.map(field => field.name.value)).size,
        );
        expect(updateAnnouncementInput.fields?.map(field => field.name.value)).toEqual(
            expect.arrayContaining(['targetMode', 'channelIds']),
        );
        expect(shopQuery.fields?.map(field => field.name.value)).not.toContain('storeUsdtWallets');
    });
});

function namedType(type: TypeNode): string {
    if (type.kind === Kind.NAMED_TYPE) return type.name.value;
    return namedType(type.type);
}

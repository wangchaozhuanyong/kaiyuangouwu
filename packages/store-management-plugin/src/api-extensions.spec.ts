import { DocumentNode, Kind, ObjectTypeExtensionNode, TypeNode } from 'graphql';
import { describe, expect, it } from 'vitest';

import { adminApiExtensions, shopApiExtensions } from './api-extensions';

describe('store management API extensions', () => {
    it('adds the channel-scoped branding preview only to the Admin API', () => {
        const adminFields = queryExtension(adminApiExtensions).fields ?? [];
        expect(adminFields.filter(field => field.name.value === 'storefrontPreviewBranding')).toHaveLength(1);
        expect(queryExtension(shopApiExtensions).fields?.map(field => field.name.value)).not.toContain(
            'storefrontPreviewBranding',
        );
    });

    it('exposes optional English locks on both profile update inputs', () => {
        for (const name of ['UpdateStoreProfileInput', 'UpdateMyStoreProfileInput']) {
            const definition = adminApiExtensions.definitions.find(
                value => value.kind === Kind.INPUT_OBJECT_TYPE_DEFINITION && value.name.value === name,
            );
            if (definition?.kind !== Kind.INPUT_OBJECT_TYPE_DEFINITION) throw new Error(name);
            for (const fieldName of ['storefrontNameEnLocked', 'descriptionEnLocked', 'taglineEnLocked']) {
                expect(definition.fields?.find(field => field.name.value === fieldName)?.type).toMatchObject({
                    kind: Kind.NAMED_TYPE,
                    name: { value: 'Boolean' },
                });
            }
        }
    });

    it('exposes managed legal identity fields to admins and the storefront', () => {
        const legalFields = ['legalEntityName', 'legalRegistrationCountry', 'supportEmail', 'privacyEmail'];
        const adminTypeNames = ['StoreProfile', 'UpdateStoreProfileInput', 'UpdateMyStoreProfileInput'];

        for (const name of adminTypeNames) {
            const definition = adminApiExtensions.definitions.find(
                candidate =>
                    (candidate.kind === Kind.OBJECT_TYPE_DEFINITION ||
                        candidate.kind === Kind.INPUT_OBJECT_TYPE_DEFINITION) &&
                    candidate.name.value === name,
            );
            if (
                definition?.kind !== Kind.OBJECT_TYPE_DEFINITION &&
                definition?.kind !== Kind.INPUT_OBJECT_TYPE_DEFINITION
            ) {
                throw new Error(`${name} is missing`);
            }
            expect(definition.fields?.map(field => field.name.value)).toEqual(
                expect.arrayContaining(legalFields),
            );
        }

        const branding = shopApiExtensions.definitions.find(
            definition =>
                definition.kind === Kind.OBJECT_TYPE_DEFINITION &&
                definition.name.value === 'StorefrontBranding',
        );
        if (branding?.kind !== Kind.OBJECT_TYPE_DEFINITION) {
            throw new Error('StorefrontBranding is missing');
        }
        expect(branding.fields?.map(field => field.name.value)).toEqual(expect.arrayContaining(legalFields));
    });

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

    it('exposes coupon product scopes through the Shop API', () => {
        const storefrontCoupon = shopApiExtensions.definitions.find(
            definition =>
                definition.kind === Kind.OBJECT_TYPE_DEFINITION &&
                definition.name.value === 'StorefrontCoupon',
        );

        expect(storefrontCoupon?.kind).toBe(Kind.OBJECT_TYPE_DEFINITION);
        if (storefrontCoupon?.kind !== Kind.OBJECT_TYPE_DEFINITION) {
            throw new Error('StorefrontCoupon type is missing');
        }
        expect(storefrontCoupon.fields?.map(field => field.name.value)).toEqual(
            expect.arrayContaining(['collectionIds', 'productVariantIds']),
        );
    });

    it('exposes coupon archive metadata and the protected archive mutation through the Admin API', () => {
        const couponCampaign = adminApiExtensions.definitions.find(
            definition =>
                definition.kind === Kind.OBJECT_TYPE_DEFINITION &&
                definition.name.value === 'StoreCouponCampaign',
        );
        const mutation = adminApiExtensions.definitions.find(
            definition =>
                definition.kind === Kind.OBJECT_TYPE_EXTENSION && definition.name.value === 'Mutation',
        );

        expect(couponCampaign?.kind).toBe(Kind.OBJECT_TYPE_DEFINITION);
        expect(mutation?.kind).toBe(Kind.OBJECT_TYPE_EXTENSION);
        if (
            couponCampaign?.kind === Kind.OBJECT_TYPE_DEFINITION &&
            mutation?.kind === Kind.OBJECT_TYPE_EXTENSION
        ) {
            expect(couponCampaign.fields?.map(field => field.name.value)).toEqual(
                expect.arrayContaining(['createdAt', 'updatedAt', 'archivedAt']),
            );
            expect(mutation.fields?.map(field => field.name.value)).toContain('archiveStoreCouponCampaign');
        }
    });

    it('uses the generated coupon ledger list options input without a duplicate options argument', () => {
        const ledgerOptions = adminApiExtensions.definitions.find(
            definition =>
                definition.kind === Kind.INPUT_OBJECT_TYPE_DEFINITION &&
                definition.name.value === 'StoreCouponLedgerEntryListOptions',
        );
        const legacyOptions = adminApiExtensions.definitions.find(
            definition =>
                definition.kind === Kind.INPUT_OBJECT_TYPE_DEFINITION &&
                definition.name.value === 'StoreCouponLedgerListOptions',
        );
        const query = queryExtension(adminApiExtensions);

        expect(ledgerOptions?.kind).toBe(Kind.INPUT_OBJECT_TYPE_DEFINITION);
        expect(legacyOptions).toBeUndefined();
        expect(query?.kind).toBe(Kind.OBJECT_TYPE_EXTENSION);
        if (
            ledgerOptions?.kind !== Kind.INPUT_OBJECT_TYPE_DEFINITION ||
            query?.kind !== Kind.OBJECT_TYPE_EXTENSION
        ) {
            throw new Error('Coupon ledger schema definitions are missing');
        }
        expect(ledgerOptions.fields?.map(field => field.name.value)).toEqual(
            expect.arrayContaining(['skip', 'take', 'campaignId', 'customerId', 'orderId', 'eventType']),
        );

        const ledgerQuery = query.fields?.find(field => field.name.value === 'storeCouponLedger');
        const optionsArguments = ledgerQuery?.arguments?.filter(
            argument => argument.name.value === 'options',
        );

        expect(optionsArguments).toHaveLength(1);
        expect(optionsArguments?.[0] && namedType(optionsArguments[0].type)).toBe(
            'StoreCouponLedgerEntryListOptions',
        );
    });

    it('exposes an admin query for a selected customer referral wallets', () => {
        const query = queryExtension(adminApiExtensions);

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

    it('exposes customer avatar access only through the Shop API', () => {
        const query = shopApiExtensions.definitions.find(
            definition => definition.kind === Kind.OBJECT_TYPE_EXTENSION && definition.name.value === 'Query',
        );
        const mutation = shopApiExtensions.definitions.find(
            definition =>
                definition.kind === Kind.OBJECT_TYPE_EXTENSION && definition.name.value === 'Mutation',
        );

        expect(query?.kind).toBe(Kind.OBJECT_TYPE_EXTENSION);
        expect(mutation?.kind).toBe(Kind.OBJECT_TYPE_EXTENSION);
        if (query?.kind !== Kind.OBJECT_TYPE_EXTENSION || mutation?.kind !== Kind.OBJECT_TYPE_EXTENSION) {
            throw new Error('Shop API extension is missing');
        }
        expect(query.fields?.map(field => field.name.value)).toContain('myCustomerAvatar');
        expect(mutation.fields?.map(field => field.name.value)).toContain('setCustomerAvatar');
    });

    it('exposes scoped announcements and Channel USDT administration only through the Admin API', () => {
        const adminQuery = queryExtension(adminApiExtensions);
        const adminMutation = adminApiExtensions.definitions.find(
            definition =>
                definition.kind === Kind.OBJECT_TYPE_EXTENSION && definition.name.value === 'Mutation',
        );
        const announcement = adminApiExtensions.definitions.find(
            definition =>
                definition.kind === Kind.OBJECT_TYPE_DEFINITION &&
                definition.name.value === 'SystemAnnouncement',
        );
        const usdtWallet = adminApiExtensions.definitions.find(
            definition =>
                definition.kind === Kind.OBJECT_TYPE_DEFINITION &&
                definition.name.value === 'StoreUsdtWallet',
        );
        const updateAnnouncementInput = adminApiExtensions.definitions.find(
            definition =>
                definition.kind === Kind.INPUT_OBJECT_TYPE_DEFINITION &&
                definition.name.value === 'UpdateSystemAnnouncementInput',
        );
        const shopQuery = queryExtension(shopApiExtensions);

        if (
            adminQuery?.kind !== Kind.OBJECT_TYPE_EXTENSION ||
            adminMutation?.kind !== Kind.OBJECT_TYPE_EXTENSION ||
            announcement?.kind !== Kind.OBJECT_TYPE_DEFINITION ||
            usdtWallet?.kind !== Kind.OBJECT_TYPE_DEFINITION ||
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
            expect.arrayContaining(['targetMode', 'channels', 'titleEnLocked', 'contentEnLocked']),
        );
        expect(usdtWallet.fields?.map(field => field.name.value)).toContain('canReview');
        expect(announcement.fields?.map(field => field.name.value)).toHaveLength(
            new Set(announcement.fields?.map(field => field.name.value)).size,
        );
        expect(updateAnnouncementInput.fields?.map(field => field.name.value)).toEqual(
            expect.arrayContaining(['targetMode', 'channelIds', 'titleEnLocked', 'contentEnLocked']),
        );
        expect(shopQuery.fields?.map(field => field.name.value)).not.toContain('storeUsdtWallets');
    });
});

function namedType(type: TypeNode): string {
    if (type.kind === Kind.NAMED_TYPE) return type.name.value;
    return namedType(type.type);
}

// GraphQL merges every extension of Query, including imported feature schemas.
function queryExtension(document: DocumentNode): ObjectTypeExtensionNode {
    const extensions = document.definitions.filter(
        (definition): definition is ObjectTypeExtensionNode =>
            definition.kind === Kind.OBJECT_TYPE_EXTENSION && definition.name.value === 'Query',
    );
    if (!extensions.length) throw new Error('Query extension is missing');
    return { ...extensions[0], fields: extensions.flatMap(extension => extension.fields ?? []) };
}

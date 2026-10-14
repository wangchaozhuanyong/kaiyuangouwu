import type { RequestContext } from '@vendure/core';
import { describe, expect, it, vi } from 'vitest';

import { ReferralShopResolver } from './referral.resolver';
import { ReferralService } from './referral.service';

const ctx = { apiType: 'shop', channelId: 'store-b' } as RequestContext;
const input = { emailAddress: ' Fixture@Example.Invalid ', firstName: 'Fixture', lastName: 'Customer' };
const consent = { termsAccepted: true, privacyAcknowledged: true, locale: 'en' };
const snapshots = {
    terms: { version: 'terms-fixture', digest: 'terms-digest' },
    privacy: { version: 'privacy-fixture', digest: 'privacy-digest' },
    locale: 'en',
};

function serviceHarness(outcome: object, withInviter = false) {
    const query = {
        innerJoin: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        andWhere: vi.fn().mockReturnThis(),
        getOne: vi.fn().mockResolvedValue({ id: 'created-customer' }),
    };
    const repository = { createQueryBuilder: vi.fn(() => query) };
    const customerService = { registerCustomerAccountWithOutcome: vi.fn().mockResolvedValue(outcome) };
    const bindRelationship = vi.fn().mockResolvedValue(undefined);
    const getRepository = vi.fn(() => repository);
    const service = Object.assign(Object.create(ReferralService.prototype), {
        connection: { getRepository },
        customerService,
        getConfig: vi.fn().mockResolvedValue({ enabled: withInviter }),
        findAccountByCode: vi.fn().mockResolvedValue({ id: 'inviter' }),
        bindRelationship,
    }) as ReferralService;
    return { service, query, customerService, bindRelationship, getRepository };
}

describe('native registration creation evidence', () => {
    it.each(['same-store verified duplicate', 'another-store global identity', 'concurrent losing request'])(
        'does not guess a customer or bind referrals for a %s',
        async () => {
            const outcome = { result: { success: true } };
            const { service, getRepository, bindRelationship, customerService } = serviceHarness(
                outcome,
                true,
            );
            await expect(
                service.registerCustomerWithReferralWithOutcome(ctx, input, 'ABC123'),
            ).resolves.toEqual(outcome);
            expect(customerService.registerCustomerAccountWithOutcome).toHaveBeenCalledWith(ctx, {
                ...input,
                emailAddress: 'fixture@example.invalid',
            });
            expect(getRepository).not.toHaveBeenCalled();
            expect(bindRelationship).not.toHaveBeenCalled();
        },
    );

    it('binds only the exact customer created by this transaction in the active store', async () => {
        const outcome = { result: { success: true }, createdCustomerId: 'created-customer' };
        const { service, query, bindRelationship } = serviceHarness(outcome, true);
        await expect(
            service.registerCustomerWithReferralWithOutcome(ctx, input, 'ABC123', 'LINK'),
        ).resolves.toEqual(outcome);
        expect(query.where).toHaveBeenCalledWith('registrationChannel.id = :channelId', {
            channelId: 'store-b',
        });
        expect(query.andWhere).toHaveBeenCalledWith('customer.id = :customerId', {
            customerId: 'created-customer',
        });
        expect(bindRelationship).toHaveBeenCalledWith(
            ctx,
            { id: 'inviter' },
            { id: 'created-customer' },
            'LINK',
        );
    });

    it('keeps the original public service result free of creation evidence', async () => {
        const { service } = serviceHarness({ result: { success: true }, createdCustomerId: 'private-id' });
        await expect(service.registerCustomerWithReferral(ctx, input)).resolves.toEqual({ success: true });
    });

    it('keeps identity conflicts generic and discards any creation evidence', async () => {
        const { service } = serviceHarness({
            result: {
                __typename: 'EmailAddressConflictError',
                errorCode: 'EMAIL_ADDRESS_CONFLICT_ERROR',
                message: 'Synthetic email identity conflict',
            },
        });
        await expect(service.registerCustomerWithReferralWithOutcome(ctx, input)).resolves.toEqual({
            result: { success: true },
        });
    });
});

describe('registration consent follows the actual creation outcome', () => {
    function resolverHarness(outcome: object) {
        const referrals = { registerCustomerWithReferralWithOutcome: vi.fn().mockResolvedValue(outcome) };
        const consents = {
            assertRegistrationConsent: vi.fn().mockResolvedValue(snapshots),
            recordRegistrationForCustomer: vi.fn().mockResolvedValue(undefined),
        };
        return {
            resolver: new ReferralShopResolver(referrals as never, consents as never),
            referrals,
            consents,
        };
    }

    it.each(['existing current-store account', 'existing account in another store', 'concurrent loser'])(
        'preserves the safe no-op for %s without attempting consent writes',
        async () => {
            const { resolver, consents } = resolverHarness({ result: { success: true } });
            await expect(resolver.registerCustomerWithReferral(ctx, input, consent)).resolves.toEqual({
                success: true,
            });
            expect(consents.recordRegistrationForCustomer).not.toHaveBeenCalled();
        },
    );

    it('records consent for the winning newly created customer and returns only the public result', async () => {
        const { resolver, consents } = resolverHarness({
            result: { success: true },
            createdCustomerId: 'created-customer',
        });
        await expect(resolver.registerCustomerWithReferral(ctx, input, consent)).resolves.toEqual({
            success: true,
        });
        expect(consents.recordRegistrationForCustomer).toHaveBeenCalledTimes(1);
        expect(consents.recordRegistrationForCustomer).toHaveBeenCalledWith(
            ctx,
            'created-customer',
            'REGISTRATION',
            snapshots,
        );
    });

    it('propagates a real consent write failure instead of acknowledging a partial registration', async () => {
        const { resolver, consents } = resolverHarness({
            result: { success: true },
            createdCustomerId: 'created-customer',
        });
        consents.recordRegistrationForCustomer.mockRejectedValue(
            new Error('Synthetic consent write failure'),
        );
        await expect(resolver.registerCustomerWithReferral(ctx, input, consent)).rejects.toThrow(
            'Synthetic consent write failure',
        );
    });
});

import { describe, expect, it } from 'vitest';
import { decorationPreviewAccountData } from './storefront-preview-account';

describe('decoration preview account read boundary', () => {
    it('serves synthetic private reads, including aliases, without a customer session', () => {
        expect(
            decorationPreviewAccountData('query { buyer: activeCustomer { id } myCustomerAvatar { id } }'),
        ).toEqual({ buyer: null, myCustomerAvatar: null });
        expect(
            decorationPreviewAccountData('query { myReferralOverview { wallets { availableBalance } } }')
                ?.myReferralOverview,
        ).toMatchObject({ wallets: [], invitees: [], ledger: [] });
        expect(
            decorationPreviewAccountData('query { myAfterSalesRequests { id } activeOrder { id } }'),
        ).toEqual({ myAfterSalesRequests: [], activeOrder: null });
    });
    it('does not turn public data failures or unsupported reads into synthetic success', () => {
        expect(decorationPreviewAccountData('query { storefrontContent { id } }')).toBeUndefined();
        expect(
            decorationPreviewAccountData('query { activeCustomer { id } storefrontContent { id } }'),
        ).toBeUndefined();
        expect(decorationPreviewAccountData('mutation { removeAllOrderLines { id } }')).toBeUndefined();
        expect(
            decorationPreviewAccountData('query A { activeCustomer { id } } query B { activeOrder { id } }'),
        ).toBeUndefined();
    });
});

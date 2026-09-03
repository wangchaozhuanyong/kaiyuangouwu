import { print } from 'graphql';
import { describe, expect, it } from 'vitest';

import { COUPON_LEDGER_QUERY, UPDATE_REFERRAL_PROGRAM_MUTATION } from './marketing.graphql';

describe('marketing GraphQL documents', () => {
    it('uses the coupon ledger options input accepted by the store management API', () => {
        const query = print(COUPON_LEDGER_QUERY);

        expect(query).toContain('$options: StoreCouponLedgerEntryListOptions');
        expect(query).not.toContain('$options: StoreCouponLedgerListOptions');
    });

    it('includes posterTemplates in update referral program mutation', () => {
        const mutation = print(UPDATE_REFERRAL_PROGRAM_MUTATION);
        expect(mutation).toContain('posterTemplates');
        expect(mutation).toContain('defaultPosterTemplate');
    });
});

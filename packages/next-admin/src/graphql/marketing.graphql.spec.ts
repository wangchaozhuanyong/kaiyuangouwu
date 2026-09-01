import { print } from 'graphql';
import { describe, expect, it } from 'vitest';

import { COUPON_LEDGER_QUERY } from './marketing.graphql';

describe('marketing GraphQL documents', () => {
    it('uses the coupon ledger options input accepted by the store management API', () => {
        const query = print(COUPON_LEDGER_QUERY);

        expect(query).toContain('$options: StoreCouponLedgerEntryListOptions');
        expect(query).not.toContain('$options: StoreCouponLedgerListOptions');
    });
});

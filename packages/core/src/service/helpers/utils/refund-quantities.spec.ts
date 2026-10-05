import { describe, expect, it } from 'vitest';

import { effectiveRefundLines } from './refund-quantities';
const unit = { orderLineId: 'line', quantity: 1 };
function fragment(state: string, anchor: boolean) {
    return {
        state,
        lines: anchor ? [unit] : [],
        metadata: { refundRequest: { quantityGroup: { key: 'group', anchor } } },
    };
}
describe('quantity reservation of split original-payment refunds', () => {
    it.each(['Pending', 'Settled'])(
        'keeps quantities reserved when the anchor failed but another fragment is %s',
        state => {
            expect(effectiveRefundLines([fragment('Failed', true), fragment(state, false)])).toEqual([unit]);
        },
    );
    it('restores quantities only when every fragment explicitly failed', () => {
        expect(effectiveRefundLines([fragment('Failed', true), fragment('Failed', false)])).toEqual([]);
    });
    it('excludes the original group while validating a retry on its original record', () => {
        expect(effectiveRefundLines([fragment('Failed', true), fragment('Settled', false)], 'group')).toEqual(
            [],
        );
    });
    it('preserves ordinary refunds and ignores failed requests and monetary compensation', () => {
        expect(
            effectiveRefundLines([
                { state: 'Failed', lines: [unit] },
                { state: 'Settled', lines: [] },
                { state: 'Pending', lines: [unit] },
            ]),
        ).toEqual([unit]);
    });
});

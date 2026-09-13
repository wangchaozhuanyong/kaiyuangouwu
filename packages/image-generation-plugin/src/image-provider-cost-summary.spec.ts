import { describe, expect, it } from 'vitest';

import { summarizeProviderCosts } from './image-provider-cost-summary';

describe('supplier cost completeness', () => {
    it('keeps unknown amounts separate from explicit zero charges', () => {
        expect(summarizeProviderCosts([{ actualCostMicrounits: 0, costCurrency: 'USD' }])).toMatchObject({
            costCompleteness: 'COMPLETE',
            actualCostMicrounits: 0,
        });
        expect(summarizeProviderCosts([{}])).toMatchObject({
            costCompleteness: 'UNKNOWN',
            actualCostMicrounits: null,
            missingCostCount: 1,
        });
    });
    it('shows a partial known subtotal without representing it as the full cost', () => {
        expect(
            summarizeProviderCosts([{ actualCostMicrounits: 1000, costCurrency: 'USD' }, {}]),
        ).toMatchObject({
            costCompleteness: 'PARTIAL',
            actualCostMicrounits: null,
            costBreakdown: [{ currency: 'USD', amount: 0.001 }],
        });
    });
    it('does not add different currencies or invent missing currencies', () => {
        const cost = summarizeProviderCosts([
            { actualCostMicrounits: 1000, costCurrency: 'USD' },
            { actualCostMicrounits: 2000, costCurrency: 'CNY' },
            { actualCostMicrounits: 3000 },
        ]);
        expect(cost.actualCostMicrounits).toBeNull();
        expect(cost.costBreakdown).toEqual([
            { currency: 'USD', amount: 0.001 },
            { currency: 'CNY', amount: 0.002 },
        ]);
        expect(cost.missingCostCount).toBe(1);
    });
    it('never claims complete historical costs without a complete attempt range', () => {
        expect(
            summarizeProviderCosts([{ actualCostMicrounits: 200, costCurrency: 'USD' }], false)
                .costCompleteness,
        ).toBe('PARTIAL');
        expect(summarizeProviderCosts([], false).costCompleteness).toBe('UNKNOWN');
    });
});

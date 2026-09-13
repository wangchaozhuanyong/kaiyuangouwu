export interface CostObservation {
    actualCostMicrounits?: number | null;
    costCurrency?: string | null;
}

export function summarizeProviderCosts(observations: readonly CostObservation[], rangeComplete = true) {
    const amounts = new Map<string, number>();
    let missingCostCount = 0;
    for (const observation of observations) {
        const amount = observation.actualCostMicrounits;
        const currency = observation.costCurrency?.toUpperCase();
        if (
            amount == null ||
            !Number.isSafeInteger(amount) ||
            amount < 0 ||
            !currency ||
            !/^[A-Z]{3}$/u.test(currency)
        ) {
            missingCostCount += 1;
            continue;
        }
        const total = (amounts.get(currency) ?? 0) + amount;
        if (!Number.isSafeInteger(total)) throw new Error('供应商费用合计超出安全整数范围');
        amounts.set(currency, total);
    }
    const costBreakdown = [...amounts].map(([currency, amount]) => ({
        currency,
        amount: amount / 1_000_000,
    }));
    const complete = rangeComplete && missingCostCount === 0;
    const single = complete && amounts.size === 1 ? [...amounts][0] : undefined;
    return {
        costBreakdown,
        costCompleteness: complete ? 'COMPLETE' : amounts.size ? 'PARTIAL' : 'UNKNOWN',
        missingCostCount,
        missingCost: !complete,
        costCurrency: single?.[0] ?? null,
        actualCostMicrounits: single && single[1] <= 2_147_483_647 ? single[1] : null,
    };
}

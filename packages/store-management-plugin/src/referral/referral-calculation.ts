export interface ReferralRewardCalculationInput {
    productNet: number;
    settledTotal: number;
    externalSettled: number;
    rewardRateBps: number;
    minimumOrderAmount: number;
    maxRewardPerOrder?: number | null;
}

export function calculateReferralReward(input: ReferralRewardCalculationInput): {
    eligibleAmount: number;
    rewardAmount: number;
} {
    const cashRatio = Math.min(1, Math.max(0, input.externalSettled) / Math.max(1, input.settledTotal));
    const eligibleAmount = Math.round(Math.max(0, input.productNet) * cashRatio);
    if (eligibleAmount < input.minimumOrderAmount) return { eligibleAmount, rewardAmount: 0 };
    const uncappedReward = Math.round((eligibleAmount * input.rewardRateBps) / 10_000);
    const rewardAmount =
        input.maxRewardPerOrder == null ? uncappedReward : Math.min(uncappedReward, input.maxRewardPerOrder);
    return { eligibleAmount, rewardAmount: Math.max(0, rewardAmount) };
}

export function calculateReferralClawback(
    rewardAmount: number,
    settledRefundTotal: number,
    orderTotalWithTax: number,
): number {
    if (rewardAmount <= 0 || settledRefundTotal <= 0) return 0;
    return Math.min(
        rewardAmount,
        Math.round((rewardAmount * settledRefundTotal) / Math.max(1, orderTotalWithTax)),
    );
}

export function calculateEligibleReferralRefund(input: {
    items: number;
    shipping: number;
    adjustment: number;
    total: number;
}): number {
    const hasItemizedBreakdown = input.items !== 0 || input.shipping !== 0 || input.adjustment !== 0;
    if (!hasItemizedBreakdown) return Math.max(0, input.total);
    return Math.min(Math.max(0, input.total), Math.max(0, input.items + input.adjustment));
}

export function referralRewardStatusAfterClawback(input: {
    rewardAmount: number;
    clawedBackAmount: number;
    releasedAmount: number;
}): 'PENDING' | 'PARTIALLY_REVERSED' | 'REVERSED' {
    if (input.clawedBackAmount >= input.rewardAmount) return 'REVERSED';
    return input.releasedAmount > 0 ? 'PARTIALLY_REVERSED' : 'PENDING';
}

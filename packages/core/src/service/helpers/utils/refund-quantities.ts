/** One item refund can return money through several original payments. Its
 * quantities stay reserved once while any fragment is pending or settled. */
export function effectiveRefundLines<T extends { orderLineId: unknown; quantity: number }>(
    refunds: ReadonlyArray<{ state: string; lines?: readonly T[]; metadata?: Record<string, any> }>,
    excludingGroup?: string,
): T[] {
    const activeGroups = new Set(
        refunds
            .filter(refund => ['Pending', 'Settled'].includes(refund.state))
            .map(refund => refund.metadata?.refundRequest?.quantityGroup?.key)
            .filter((key): key is string => typeof key === 'string'),
    );
    return refunds
        .filter(refund => {
            const group = refund.metadata?.refundRequest?.quantityGroup?.key;
            if (group && group === excludingGroup) return false;
            return group ? activeGroups.has(group) : ['Pending', 'Settled'].includes(refund.state);
        })
        .flatMap(refund => refund.lines ?? []);
}

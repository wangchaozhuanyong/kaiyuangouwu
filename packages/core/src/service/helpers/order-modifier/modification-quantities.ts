/**
 * Retain all previously sold units when an edit adds quantities, including units
 * already canceled or refunded. Decreases keep their historical sold baseline.
 */
export function orderPlacedQuantityAfterModification(
    placedQuantity: number,
    currentQuantity: number,
    nextQuantity: number,
): number {
    if (nextQuantity <= currentQuantity) return placedQuantity;
    return (placedQuantity || currentQuantity) + nextQuantity - currentQuantity;
}

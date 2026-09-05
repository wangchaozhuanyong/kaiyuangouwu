export function calculateDraftMargin(sellingPrice: string, purchaseCost: string): number | null {
    if (!sellingPrice.trim() || !purchaseCost.trim()) return null;
    const price = Number(sellingPrice);
    const cost = Number(purchaseCost);
    return Number.isFinite(price) && Number.isFinite(cost) && price > 0 ? (price - cost) / price : null;
}

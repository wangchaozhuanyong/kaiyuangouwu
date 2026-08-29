import type { ProductVariant, StorefrontLanguage } from './types';

export interface ProductAvailability {
    stock: number | null;
    soldOut: boolean;
    unlimited: boolean;
}

export function productAvailability(variant?: ProductVariant | null): ProductAvailability {
    if (!variant) return { stock: 0, soldOut: true, unlimited: false };

    const autoCard =
        variant.customFields.fulfillmentType === 'digital' &&
        variant.customFields.digitalDeliveryMode === 'auto_card';
    if (autoCard) {
        const stock = normalizeStock(variant.autoCardAvailableStock, 0);
        return { stock, soldOut: stock < 1, unlimited: false };
    }

    if (variant.saleableStockLevel == null) {
        if (variant.saleableStockLevel === undefined && variant.stockLevel === 'OUT_OF_STOCK') {
            return { stock: 0, soldOut: true, unlimited: false };
        }
        return { stock: null, soldOut: false, unlimited: true };
    }

    const stock = normalizeStock(variant.saleableStockLevel, 0);
    return { stock, soldOut: stock < 1, unlimited: false };
}

export function productAvailabilityLabel(
    availability: ProductAvailability,
    language: StorefrontLanguage,
): string {
    if (availability.soldOut) return language === 'zh' ? '已售罄' : 'Sold out';
    if (availability.unlimited) return language === 'zh' ? '不限库存' : 'Unlimited stock';
    return language === 'zh' ? `库存 ${availability.stock}` : `${availability.stock} in stock`;
}

export function variantCanIncreaseQuantity(variant: ProductVariant, quantity: number): boolean {
    const availability = productAvailability(variant);
    return availability.unlimited || (!availability.soldOut && quantity < (availability.stock ?? 0));
}

function normalizeStock(value: number | null | undefined, fallback: number): number {
    if (value == null || !Number.isFinite(value)) return fallback;
    return Math.max(0, Math.floor(value));
}

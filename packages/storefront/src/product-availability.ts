import type { ProductVariant, StorefrontCart, StorefrontLanguage } from './types';

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
        const autoCardStock = normalizeStock(variant.autoCardAvailableStock, 0);
        return { stock: autoCardStock, soldOut: autoCardStock < 1, unlimited: false };
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

export function variantHasStock(variant: ProductVariant | null | undefined, quantity: number): boolean {
    const availability = productAvailability(variant);
    return (
        Number.isInteger(quantity) &&
        quantity > 0 &&
        (availability.unlimited || quantity <= (availability.stock ?? 0))
    );
}

export function cartLineCanSelect(line: StorefrontCart['lines'][number]): boolean {
    return line.available && variantHasStock(line.productVariant, line.quantity);
}

export function cartSelectionState(lines: StorefrontCart['lines']): StorefrontCart['selectionState'] {
    const selectable = lines.filter(cartLineCanSelect);
    if (!lines.some(line => line.selected)) return 'NONE';
    return selectable.length > 0 &&
        selectable.every(line => line.selected) &&
        lines.every(line => !line.selected || cartLineCanSelect(line))
        ? 'ALL'
        : 'PARTIAL';
}

export function quantityStockMessage(
    variant: ProductVariant | null | undefined,
    quantity: number,
    language: StorefrontLanguage,
): string | null {
    if (variantHasStock(variant, quantity)) return null;
    const { stock, soldOut } = productAvailability(variant);
    if (soldOut) return language === 'zh' ? '已售罄，暂时无法购买' : 'Sold out; currently unavailable';
    return language === 'zh'
        ? `库存不足，当前最多可购买 ${stock} 件，请调整数量`
        : `Not enough stock. Up to ${stock} available; please reduce the quantity`;
}

import type { OptionGroupItem, ProductVariantState } from './product-editor-types';

const blankVariant = (
    productName: string,
    optionIds: string[],
    optionNames: string[],
): ProductVariantState => ({
    sku: '',
    name: `${productName.trim()} ${optionNames.join(' / ')}`.trim(),
    price: '',
    costPrice: '',
    stockOnHand: '',
    stockAllocated: 0,
    enabled: true,
    digitalDeliveryMode: 'manual_service',
    digitalStockPolicy: 'limited',
    optionIds,
    isNew: true,
});

export function applyNewOptionGroupToVariants(
    variants: ProductVariantState[],
    newGroup: OptionGroupItem,
    productName: string,
): ProductVariantState[] {
    if (newGroup.options.length === 0) return variants;
    if (variants.length === 0) {
        return newGroup.options.map(option => blankVariant(productName, [option.id], [option.name]));
    }

    const [firstOption, ...remainingOptions] = newGroup.options;
    if (variants.length === 1 && variants[0].optionIds.length === 0) {
        const current = variants[0];
        const firstVariant = {
            ...current,
            optionIds: [firstOption.id],
            name: current.name.trim()
                ? `${current.name.trim()} (${firstOption.name})`
                : `${productName.trim()} ${firstOption.name}`.trim(),
        };
        return [
            firstVariant,
            ...remainingOptions.map(option => blankVariant(productName, [option.id], [option.name])),
        ];
    }

    return variants.flatMap(variant => {
        const baseName = variant.name.trim() || productName.trim();
        const firstVariant: ProductVariantState = {
            ...variant,
            optionIds: [...variant.optionIds, firstOption.id],
            name: `${baseName} (${firstOption.name})`,
        };
        const generated = remainingOptions.map((option): ProductVariantState => ({
            ...variant,
            id: undefined,
            sku: '',
            name: `${baseName} (${option.name})`,
            stockOnHand: '',
            stockAllocated: 0,
            optionIds: [...variant.optionIds, option.id],
            isNew: true,
        }));
        return [firstVariant, ...generated];
    });
}

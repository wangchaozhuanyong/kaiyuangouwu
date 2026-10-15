import type { ShippingMethod } from '../types';
import type { CartCheckoutApi } from './cart-checkout';

interface ShippingSelection {
    selectedShippingMethodId?: string;
    selectedShippingMethodIds?: string[];
    preferredShippingCode?: string;
    defaultShippingCode?: string;
}

export function selectShippingMethods(
    available: ShippingMethod[],
    input: ShippingSelection,
): ShippingMethod[] {
    const groups = [...new Set(available.map(method => method.metadata?.shippingGroupId ?? 'default'))];
    return groups
        .map(group => {
            const methods = available.filter(
                method => (method.metadata?.shippingGroupId ?? 'default') === group,
            );
            return selectShippingMethod(methods, {
                ...input,
                selectedShippingMethodId:
                    input.selectedShippingMethodIds?.find(id => methods.some(m => m.id === id)) ??
                    input.selectedShippingMethodId,
            });
        })
        .filter((method): method is ShippingMethod => Boolean(method));
}

function selectShippingMethod(
    methods: ShippingMethod[],
    input: {
        selectedShippingMethodId?: string;
        selectedShippingMethodIds?: string[];
        preferredShippingCode?: string;
        defaultShippingCode?: string;
    },
): ShippingMethod | undefined {
    return (
        methods.find(method => method.id === input.selectedShippingMethodId) ??
        methods.find(method => method.code === input.preferredShippingCode) ??
        methods.find(method => method.code === input.defaultShippingCode) ??
        methods.find(method => method.priceWithTax === 0) ??
        [...methods].sort((left, right) => left.priceWithTax - right.priceWithTax)[0]
    );
}

export async function prepareLegacyShipping(
    api: Pick<
        CartCheckoutApi,
        'setShippingAddress' | 'eligibleShippingMethods' | 'setShippingMethod' | 'cart'
    >,
    input: Parameters<CartCheckoutApi['prepareShipping']>[0],
): ReturnType<CartCheckoutApi['prepareShipping']> {
    await api.setShippingAddress(input.shippingAddress);
    const fallbackMethods = await api.eligibleShippingMethods();
    const selectedMethods = selectShippingMethods(fallbackMethods, input);
    const selected = selectedMethods[0];
    if (selected)
        await api.setShippingMethod(
            selectedMethods.length > 1 ? selectedMethods.map(m => m.id) : selected.id,
        );
    const cart = await api.cart();
    if (!cart.checkoutOrder) throw new Error('No active checkout order.');
    return {
        cart,
        order: cart.checkoutOrder,
        shippingMethods: fallbackMethods,
        selectedShippingMethodId: selected?.id ?? null,
        ...(selectedMethods.length > 1 ? { selectedShippingMethodIds: selectedMethods.map(m => m.id) } : {}),
    };
}

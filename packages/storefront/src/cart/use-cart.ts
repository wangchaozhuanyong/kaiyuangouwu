import { useSyncExternalStore } from 'react';

import { CartController } from './cart-controller';

export function useCart(controller: CartController) {
    return useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
}

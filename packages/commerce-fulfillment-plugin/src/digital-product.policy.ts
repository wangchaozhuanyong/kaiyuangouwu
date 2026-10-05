import { DigitalDeliveryMode } from './auto-card.constants';
import { DigitalStockPolicy } from './types';

export const physicalVariantFields = [
    'barcode',
    'purchaseUnit',
    'saleUnit',
    'packageQuantity',
    'shelfLifeDays',
] as const;

export function digitalStockPolicy(
    mode: DigitalDeliveryMode,
    policy?: DigitalStockPolicy,
): DigitalStockPolicy {
    return mode === 'auto_card' ? 'pool_derived' : policy === 'limited' ? 'limited' : 'unlimited';
}

export function releasableDigitalQuantity(
    reservation: {
        quantity: number;
        consumedQuantity: number;
        releasedQuantity: number;
    },
    requested: number,
): number {
    return Math.max(
        0,
        Math.min(
            requested,
            reservation.quantity - reservation.consumedQuantity - reservation.releasedQuantity,
        ),
    );
}

export function validateDigitalQuantity(value: number): number {
    if (!Number.isSafeInteger(value) || value < 0 || value > 2_147_483_647) {
        throw new Error('可售份数必须是 0 到 2147483647 的整数');
    }
    return value;
}

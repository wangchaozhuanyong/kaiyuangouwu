import { describe, expect, it } from 'vitest';
import { inventoryStockStatus } from './InventoryWarehouseModule';

describe('warehouse inventory status', () => {
    it.each([true, false])('does not mark explicitly untracked SKUs as sold out (global=%s)', global => {
        expect(inventoryStockStatus('FALSE', global, 0, 0)).toBe('NOT_TRACKED');
    });
    it('respects disabled inherited stock tracking', () => {
        expect(inventoryStockStatus('INHERIT', false, 0, 5)).toBe('NOT_TRACKED');
    });
    it.each(['TRUE', 'INHERIT'] as const)('keeps tracked stock boundaries (%s)', track => {
        expect(inventoryStockStatus(track, true, 0, 5)).toBe('OUT_OF_STOCK');
        expect(inventoryStockStatus(track, true, 3, 5)).toBe('LOW_STOCK');
        expect(inventoryStockStatus(track, true, 6, 5)).toBe('NORMAL');
    });
    it('keeps explicit tracking when global tracking is disabled', () => {
        expect(inventoryStockStatus('TRUE', false, 0, 0)).toBe('OUT_OF_STOCK');
    });
});

import { QueryRunner, Table } from 'typeorm';
import { describe, expect, it, vi } from 'vitest';

import { CommerceFulfillment1786514145999 } from './1786514145999-commerce-fulfillment';

describe('CommerceFulfillment migration', () => {
    it('skips custom fields until the Vendure base tables exist', async () => {
        const addColumn = vi.fn();
        const queryRunner = {
            getTable: vi.fn().mockResolvedValue(undefined),
            addColumn,
        } as unknown as QueryRunner;

        await new CommerceFulfillment1786514145999().up(queryRunner);

        expect(addColumn).not.toHaveBeenCalled();
    });

    it('adds each missing custom field when its base table exists', async () => {
        const tables = new Map([
            ['order_line', new Table({ name: 'order_line', columns: [] })],
            ['product_variant', new Table({ name: 'product_variant', columns: [] })],
        ]);
        const addColumn = vi.fn().mockResolvedValue(undefined);
        const queryRunner = {
            getTable: vi.fn((name: string) => Promise.resolve(tables.get(name))),
            addColumn,
        } as unknown as QueryRunner;

        await new CommerceFulfillment1786514145999().up(queryRunner);

        expect(addColumn).toHaveBeenCalledTimes(2);
        expect(addColumn.mock.calls.map(call => call[0])).toEqual(['order_line', 'product_variant']);
    });
});

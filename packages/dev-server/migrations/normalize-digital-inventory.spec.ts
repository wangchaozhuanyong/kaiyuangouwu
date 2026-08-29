import { describe, expect, it, vi } from 'vitest';

import { NormalizeDigitalInventory1787796000000 } from './1787796000000-normalize-digital-inventory';

function queryRunner(columns: string[], type: 'mysql' | 'sqlite' = 'mysql') {
    return {
        connection: { options: { type } },
        getTable: vi.fn().mockResolvedValue({
            findColumnByName: (name: string) => (columns.includes(name) ? { name } : undefined),
        }),
        query: vi.fn().mockResolvedValue(undefined),
    };
}

describe('NormalizeDigitalInventory1787796000000', () => {
    it('disables Vendure inventory tracking only for digital product variants', async () => {
        const runner = queryRunner(['customFieldsFulfillmenttype', 'trackInventory']);

        await new NormalizeDigitalInventory1787796000000().up(runner as any);

        expect(runner.query).toHaveBeenCalledOnce();
        expect(runner.query).toHaveBeenCalledWith(
            "UPDATE `product_variant` SET `trackInventory` = 'FALSE' " +
                "WHERE `customFieldsFulfillmenttype` = 'digital' " +
                "AND (`trackInventory` IS NULL OR `trackInventory` <> 'FALSE')",
        );
    });

    it('uses portable quoting for SQLite releases', async () => {
        const runner = queryRunner(['customFieldsFulfillmenttype', 'trackInventory'], 'sqlite');

        await new NormalizeDigitalInventory1787796000000().up(runner as any);

        expect(runner.query).toHaveBeenCalledWith(
            'UPDATE "product_variant" SET "trackInventory" = \'FALSE\' ' +
                'WHERE "customFieldsFulfillmenttype" = \'digital\' ' +
                'AND ("trackInventory" IS NULL OR "trackInventory" <> \'FALSE\')',
        );
    });

    it('does nothing when the fulfillment metadata is unavailable', async () => {
        const runner = queryRunner(['trackInventory']);

        await new NormalizeDigitalInventory1787796000000().up(runner as any);

        expect(runner.query).not.toHaveBeenCalled();
    });
});

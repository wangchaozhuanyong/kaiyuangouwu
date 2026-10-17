import { describe, expect, it, vi } from 'vitest';

import { Populator } from './populator';

describe('Populator shipping configuration transaction', () => {
    function harness() {
        const outer = { channelId: 'synthetic-store' };
        const tx = { ...outer, transaction: 'synthetic-transaction' };
        const create = vi.fn((ctx: unknown) =>
            ctx === tx
                ? Promise.resolve()
                : Promise.reject(new Error('Shipping configuration requires the transaction context')),
        );
        const withTransaction = vi.fn(async (_ctx: unknown, work: (ctx: unknown) => Promise<void>) =>
            work(tx),
        );
        const populator = Object.assign(Object.create(Populator.prototype), {
            connection: { withTransaction },
            shippingMethodService: { create },
        });
        return { outer, tx, create, withTransaction, populator };
    }

    it('creates standalone initial shipping methods using one transactional context', async () => {
        const test = harness();
        await test.populator.populateShippingMethods(test.outer, [
            { name: 'Synthetic standard', price: 100 },
            { name: 'Synthetic express', price: 200 },
        ]);
        expect(test.withTransaction).toHaveBeenCalledTimes(1);
        expect(test.withTransaction).toHaveBeenCalledWith(test.outer, expect.any(Function));
        expect(test.create.mock.calls.map(call => call[0])).toEqual([test.tx, test.tx]);
    });

    it('propagates a creation failure to the transaction boundary and stops the batch', async () => {
        const test = harness();
        test.create.mockRejectedValueOnce(new Error('Synthetic shipping write failed'));
        await expect(
            test.populator.populateShippingMethods(test.outer, [
                { name: 'Synthetic first', price: 100 },
                { name: 'Synthetic second', price: 200 },
            ]),
        ).rejects.toThrow('Synthetic shipping write failed');
        expect(test.create).toHaveBeenCalledTimes(1);
    });

    it('does not start a transaction when no shipping methods are requested', async () => {
        const test = harness();
        await test.populator.populateShippingMethods(test.outer, []);
        expect(test.withTransaction).not.toHaveBeenCalled();
        expect(test.create).not.toHaveBeenCalled();
    });
});

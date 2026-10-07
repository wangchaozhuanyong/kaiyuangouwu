import { DataSource, EntitySchema } from 'typeorm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PromotionService } from './promotion.service';

const id = { type: String, primary: true } as const;
const promotion = new EntitySchema<any>({ name: 'UsagePromotion', columns: { id } });
const order = new EntitySchema<any>({
    name: 'UsageOrder',
    columns: {
        id,
        state: { type: String },
        active: { type: Boolean },
        type: { type: String },
        customer: { type: String },
    },
    relations: {
        promotions: { type: 'many-to-many', target: 'UsagePromotion', joinTable: true },
        payments: { type: 'one-to-many', target: 'UsagePayment', inverseSide: 'order' },
    },
});
const payment = new EntitySchema<any>({
    name: 'UsagePayment',
    columns: { id, method: { type: String }, state: { type: String }, metadata: { type: 'simple-json' } },
    relations: { order: { type: 'many-to-one', target: 'UsageOrder', joinColumn: true } },
});

describe('promotion usage counts with controlled simulation evidence', () => {
    let db: DataSource;
    let service: PromotionService;
    const ctx = {} as any;

    beforeEach(async () => {
        db = await new DataSource({
            type: 'sqljs',
            entities: [order, promotion, payment],
            synchronize: true,
        }).initialize();
        service = Object.assign(Object.create(PromotionService.prototype), {
            connection: { getRepository: () => db.getRepository(order) },
        });
        await db.getRepository(promotion).save([{ id: 'campaign' }, { id: 'simulation-only' }]);
        const simulated = {
            state: 'Settled',
            method: 'controlled-test-payment-store',
            metadata: { public: { testPayment: true } },
        };
        const real = { state: 'Settled', method: 'real-payment', metadata: {} };
        const fixtures = [
            { id: 'real', payments: [real] },
            { id: 'simulation', payments: [simulated], secondPromotion: true },
            { id: 'missing-marker', payments: [{ ...simulated, metadata: {} }] },
            { id: 'marker-only', payments: [{ ...real, metadata: simulated.metadata }] },
            { id: 'mixed-real', payments: [simulated, real] },
            { id: 'unknown', payments: [simulated, { ...real, state: 'Created' }] },
            { id: 'unknown-error', payments: [simulated, { ...real, state: 'Error' }] },
            {
                id: 'review',
                payments: [
                    { ...simulated, metadata: { ...simulated.metadata, manualReview: { required: true } } },
                ],
            },
            { id: 'later-live', payments: [simulated], state: 'Delivered' },
            { id: 'other-customer', payments: [real], customer: 'bob' },
            { id: 'pending', payments: [], state: 'ArrangingPayment', active: true },
            { id: 'cancelled', payments: [real], state: 'Cancelled' },
            { id: 'draft', payments: [real], state: 'Draft' },
            { id: 'seller', payments: [real], type: 'Seller' },
        ];
        for (const fixture of fixtures) {
            await db.getRepository(order).save({
                id: fixture.id,
                state: fixture.state ?? 'PaymentSettled',
                active: fixture.active ?? false,
                type: fixture.type ?? 'Regular',
                customer: fixture.customer ?? 'alice',
                promotions: [
                    { id: 'campaign' },
                    ...(fixture.secondPromotion ? [{ id: 'simulation-only' }] : []),
                ],
            });
            await db.getRepository(payment).save(
                fixture.payments.map((record, index) => ({
                    ...record,
                    id: `${fixture.id}-${index}`,
                    order: { id: fixture.id },
                })),
            );
        }
    });

    afterEach(async () => {
        await db?.destroy();
    });

    it('preserves SQL aggregate counts while excluding only confirmed simulations for each campaign', async () => {
        expect(await (service as any).getUsageCountsBatch(ctx, ['campaign', 'simulation-only'])).toEqual(
            new Map([['campaign', 8]]),
        );
        expect(await (service as any).getUsageCountsBatch(ctx, ['campaign'], 'alice')).toEqual(
            new Map([['campaign', 7]]),
        );
    });

    it('retains pending reservations and mixed or unknown payment usages in total limits', async () => {
        expect(await (service as any).countPromotionUsages(ctx, 'campaign')).toBe(9);
        expect(await (service as any).countPromotionUsages(ctx, 'campaign', 'pending')).toBe(8);
        expect(await (service as any).countPromotionUsages(ctx, 'campaign', 'simulation')).toBe(9);
    });

    it('uses the same evidence for per-customer limits and excluded-order validation', async () => {
        expect(await (service as any).countPromotionUsagesForCustomer(ctx, 'campaign', 'alice')).toBe(8);
        expect(await (service as any).countPromotionUsagesForCustomer(ctx, 'campaign', 'alice', 'real')).toBe(
            7,
        );
        expect(await (service as any).countPromotionUsagesForCustomer(ctx, 'campaign', 'bob')).toBe(1);
    });

    it('does not subtract a concurrently placed simulation from already counted real usages', async () => {
        const simulationOrders = service as unknown as {
            confirmedSimulationOrderIds: (...args: unknown[]) => Promise<Array<string | number>>;
        };
        const original = simulationOrders.confirmedSimulationOrderIds.bind(service);
        vi.spyOn(simulationOrders, 'confirmedSimulationOrderIds').mockImplementationOnce(
            async (...args: unknown[]) => {
                const excluded = await original(...args);
                await db.getRepository(order).save({
                    id: 'concurrent-simulation',
                    state: 'PaymentSettled',
                    active: false,
                    type: 'Regular',
                    customer: 'alice',
                    promotions: [{ id: 'campaign' }],
                });
                await db.getRepository(payment).save({
                    id: 'concurrent-payment',
                    state: 'Settled',
                    method: 'controlled-test-payment-store',
                    metadata: { public: { testPayment: true } },
                    order: { id: 'concurrent-simulation' },
                });
                return excluded;
            },
        );
        expect(await (service as any).getUsageCountsBatch(ctx, ['campaign'])).toEqual(
            new Map([['campaign', 9]]),
        );
        expect(await (service as any).getUsageCountsBatch(ctx, ['campaign'])).toEqual(
            new Map([['campaign', 8]]),
        );
    });
});

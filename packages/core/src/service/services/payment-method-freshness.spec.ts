import 'reflect-metadata';
import { expect, it } from 'vitest';

import { PaymentMethod } from '../../entity/payment-method/payment-method.entity';
import { StorePaymentMethodState } from '../../entity/payment-method/store-payment-method-state.entity';

import { PaymentMethodService } from './payment-method.service';

function fixture() {
    const platform = { id: 'platform', code: '__default_channel__' };
    const method = {
        id: 'method',
        code: 'test-payment',
        name: '测试支付',
        description: '',
        enabled: true,
        channels: [platform],
        handler: { code: 'test-handler', args: [] },
        checker: null,
        customFields: {},
    };
    const states = [
        { channelId: 'a', paymentMethodId: method.id, enabled: true },
        { channelId: 'b', paymentMethodId: method.id, enabled: false },
    ];
    const handler = { code: 'test-handler' };
    const repository = (type: unknown) => ({
        find: ({ where }: any) =>
            Promise.resolve(
                type === StorePaymentMethodState
                    ? states.filter(
                          row =>
                              row.channelId === where.channelId &&
                              (!('enabled' in where) || row.enabled === where.enabled),
                      )
                    : [method].filter(
                          row =>
                              row.enabled === where.enabled &&
                              row.channels.some(channel => channel.id === where.channels.id),
                      ),
            ),
        findOne: ({ where }: any) =>
            Promise.resolve(
                type === PaymentMethod &&
                    method.code === where.code &&
                    method.channels.some(channel => channel.id === where.channels.id)
                    ? method
                    : null,
            ),
    });
    const service = new PaymentMethodService(
        {
            platformStoreGovernanceEnabled: true,
            getRepository: (_ctx: unknown, type: unknown) => repository(type),
        } as any,
        {} as any,
        {} as any,
        {} as any,
        {} as any,
        { getByCode: () => handler } as any,
        { getDefaultChannel: () => Promise.resolve(platform) } as any,
        {} as any,
        {} as any,
        { translate: (row: unknown) => row } as any,
    );
    const context = (id: string) =>
        ({ channelId: id, channel: id === 'platform' ? platform : { id, code: `store-${id}` } }) as any;
    return { service, method, states, handler, context };
}

it('store shutdown is checked again after an older eligible-payment response', async () => {
    const { service, states, context, handler } = fixture();
    const ctx = context('a');
    expect(await service.getEligiblePaymentMethods(ctx, {} as any)).toMatchObject([
        { code: 'test-payment', isEligible: true },
    ]);
    states[0].enabled = false;
    expect(await service.getEligiblePaymentMethods(ctx, {} as any)).toEqual([]);
    await expect(service.getMethodAndOperations(ctx, 'test-payment')).rejects.toThrow();
    // Existing payments retain their original handler; no gateway action is performed here.
    expect((await service.getMethodAndOperations(ctx, 'test-payment', true)).handler).toBe(handler);
});

it('platform shutdown prevents new store payment selection while preserving accepted-payment resolution', async () => {
    const { service, method, context, handler } = fixture();
    const ctx = context('a');
    await service.getMethodAndOperations(ctx, 'test-payment');
    method.enabled = false;
    expect(await service.getEligiblePaymentMethods(ctx, {} as any)).toEqual([]);
    await expect(service.getMethodAndOperations(ctx, 'test-payment')).rejects.toThrow();
    expect((await service.getMethodAndOperations(ctx, 'test-payment', true)).handler).toBe(handler);
});

it('one store enabling payment does not enable another store or the platform sales context', async () => {
    const { service, context } = fixture();
    expect(await service.getEligiblePaymentMethods(context('a'), {} as any)).toHaveLength(1);
    expect(await service.getEligiblePaymentMethods(context('b'), {} as any)).toEqual([]);
    expect(await service.getEligiblePaymentMethods(context('platform'), {} as any)).toEqual([]);
    await expect(service.getMethodAndOperations(context('b'), 'test-payment')).rejects.toThrow();
});

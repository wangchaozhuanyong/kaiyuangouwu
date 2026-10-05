import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';

import { defaultRefundProcess } from '../../../config/refund/default-refund-process';

import { RefundStateMachine } from './refund-state-machine';

describe('explicit refund retry transition', () => {
    it('keeps Failed terminal for generic transitions while the dedicated retry runs configured hooks', async () => {
        const hook = vi.fn();
        const machine = new RefundStateMachine({
            paymentOptions: {
                refundProcess: [
                    {
                        transitions: defaultRefundProcess.transitions,
                        onTransitionEnd: hook,
                    },
                ],
            },
        } as any);
        const refund = { state: 'Failed' } as any;
        const ctx = {} as any;
        const order = { id: 'order-1' } as any;
        expect(machine.getNextStates(refund)).toEqual([]);
        await expect(machine.transition(ctx, order, refund, 'Pending')).rejects.toThrow();
        expect(refund.state).toBe('Failed');
        const result = await machine.transitionForRetry(ctx, order, refund);
        expect(refund.state).toBe('Pending');
        await result.finalize();
        expect(hook).toHaveBeenCalledWith('Failed', 'Pending', { ctx, order, refund });
        expect(machine.getNextStates({ state: 'Failed' } as any)).toEqual([]);
    });

    it('refuses a dedicated retry for an unresolved Pending record', async () => {
        const machine = new RefundStateMachine({
            paymentOptions: {
                refundProcess: [
                    {
                        transitions: defaultRefundProcess.transitions,
                    },
                ],
            },
        } as any);
        await expect(
            machine.transitionForRetry({} as any, {} as any, { state: 'Pending' } as any),
        ).rejects.toThrow('只有已明确失败');
    });
});

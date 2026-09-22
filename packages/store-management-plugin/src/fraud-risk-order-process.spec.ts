import { beforeEach, describe, expect, it, vi } from 'vitest';

import { fraudRiskOrderProcess } from './fraud-risk-order-process';

describe('fraudRiskOrderProcess', () => {
    const risk = { evaluateOrder: vi.fn() };

    beforeEach(async () => {
        vi.clearAllMocks();
        risk.evaluateOrder.mockResolvedValue({ blocked: false, caseCode: null });
        await fraudRiskOrderProcess.init?.({ get: vi.fn(() => risk) } as never);
    });

    it('blocks payment entry until a flagged order is released', async () => {
        risk.evaluateOrder.mockResolvedValueOnce({ blocked: true, caseCode: 'FR-REVIEW123' });

        const result = await fraudRiskOrderProcess.onTransitionStart?.('AddingItems', 'ArrangingPayment', {
            ctx: { channelId: 'channel-1' },
            order: { id: 'order-risk' },
        } as never);

        expect(result).toContain('FR-REVIEW123');
    });

    it('does not evaluate transitions outside payment entry', async () => {
        await fraudRiskOrderProcess.onTransitionStart?.('ArrangingPayment', 'PaymentSettled', {
            ctx: { channelId: 'channel-1' },
            order: { id: 'order-safe' },
        } as never);

        expect(risk.evaluateOrder).not.toHaveBeenCalled();
    });
});

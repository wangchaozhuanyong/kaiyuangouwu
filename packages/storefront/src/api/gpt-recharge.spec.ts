import { describe, expect, it, vi } from 'vitest';

import { GptRechargeApi } from './gpt-recharge';

describe('GPT recharge challenge initialization', () => {
    it('reads an opaque task reference and real stage with cancellation, without submitting recharge', async () => {
        const task = { id: '11111111-1111-4111-8111-111111111111', stage: 'payment_details' };
        const request = vi.fn().mockResolvedValue({ gptRechargeTask: task });
        const api = new GptRechargeApi({ request });
        const signal = new AbortController().signal;
        await expect(api.task(task.id, 'synthetic-proof', signal)).resolves.toEqual(task);
        expect(request).toHaveBeenCalledExactlyOnceWith(
            expect.stringContaining('$id: ID!'),
            { id: task.id, credential: 'synthetic-proof' },
            signal,
        );
        expect(request.mock.calls[0][0]).toContain('status stage updatedAt');
        expect(request.mock.calls[0][0]).not.toContain('mutation');
    });
    it('binds the supplied context during construction and preserves the standalone challenge method', async () => {
        const challenge = {
            id: 'synthetic-proof',
            imageDataUrl: 'data:image/png;base64,iVBORw0KGgo=',
            expiresAt: '2099-01-01T00:00:00Z',
        };
        const request = vi.fn().mockResolvedValue({ createShopAbuseChallenge: challenge });
        const api = new GptRechargeApi({ request });
        const createChallenge = api.createShopAbuseChallenge;
        const signal = new AbortController().signal;
        await expect(createChallenge('RECHARGE_CODE', 'synthetic-code', signal)).resolves.toEqual(challenge);
        expect(request).toHaveBeenCalledExactlyOnceWith(
            expect.stringContaining('createShopAbuseChallenge'),
            { action: 'RECHARGE_CODE', target: 'synthetic-code' },
            signal,
        );
    });
});

import { describe, expect, it, vi } from 'vitest';

import { GptRechargeApi } from './gpt-recharge';

describe('GPT recharge challenge initialization', () => {
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

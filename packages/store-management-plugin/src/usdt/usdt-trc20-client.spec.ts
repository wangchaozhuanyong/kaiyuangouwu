import { afterEach, describe, expect, it, vi } from 'vitest';

import { USDT_TRC20_CONTRACT_ADDRESS } from './usdt-payment.constants';
import { UsdtTrc20Client } from './usdt-trc20-client';

describe('TRC20 scan completeness', () => {
    afterEach(() => vi.unstubAllGlobals());
    const client = new UsdtTrc20Client({ tronGridHeaders: () => ({}) } as never);
    const record = {
        transaction_id: 'a'.repeat(64),
        from: 'test-sender',
        to: USDT_TRC20_CONTRACT_ADDRESS,
        token_info: { address: USDT_TRC20_CONTRACT_ADDRESS, symbol: 'USDT', decimals: 6 },
        type: 'Transfer',
        value: '1000001',
        block_timestamp: 1000,
    };
    const response = (data: unknown) => ({ ok: true, json: () => Promise.resolve(data) });

    it('pins the upper time bound and only marks an exhausted cursor complete', async () => {
        const fetch = vi
            .fn()
            .mockResolvedValueOnce(response({ data: [record], meta: { fingerprint: 'next' } }))
            .mockResolvedValueOnce(response({ data: [record], meta: {} }));
        vi.stubGlobal('fetch', fetch);
        const result = await client.scanIncomingTransfers(
            USDT_TRC20_CONTRACT_ADDRESS,
            new Date(0),
            new Date(2000),
        );
        expect(result.complete).toBe(true);
        expect(result.transfers).toHaveLength(1);
        expect(result.transfers[0].amount).toBe('1.000001');
        for (const [url] of fetch.mock.calls)
            expect((url as URL).searchParams.get('max_timestamp')).toBe('2000');
        expect((fetch.mock.calls[1][0] as URL).searchParams.get('fingerprint')).toBe('next');
    });

    it('does not authorize recycling when the page limit is reached', async () => {
        const fetch = vi.fn().mockResolvedValue(response({ data: [record], meta: { fingerprint: 'more' } }));
        vi.stubGlobal('fetch', fetch);
        expect((await client.scanIncomingTransfers(USDT_TRC20_CONTRACT_ADDRESS, new Date(0))).complete).toBe(
            false,
        );
        expect(fetch).toHaveBeenCalledTimes(5);
    });

    it('treats an empty page with a remaining cursor as incomplete', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn().mockResolvedValue(response({ data: [], meta: { fingerprint: 'more' } })),
        );
        expect((await client.scanIncomingTransfers(USDT_TRC20_CONTRACT_ADDRESS, new Date(0))).complete).toBe(
            false,
        );
    });

    it('rejects malformed pages and HTTP errors', async () => {
        vi.stubGlobal(
            'fetch',
            vi
                .fn()
                .mockResolvedValueOnce(response({ success: true }))
                .mockResolvedValueOnce({ ok: false, status: 503 }),
        );
        await expect(client.scanIncomingTransfers(USDT_TRC20_CONTRACT_ADDRESS, new Date(0))).rejects.toThrow(
            'incomplete transfer page',
        );
        await expect(client.scanIncomingTransfers(USDT_TRC20_CONTRACT_ADDRESS, new Date(0))).rejects.toThrow(
            '503',
        );
    });
});

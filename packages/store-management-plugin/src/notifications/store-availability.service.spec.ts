import { describe, expect, it, vi } from 'vitest';

import { certificateThreshold, StoreAvailabilityService } from './store-availability.service';
describe('dynamic store availability and TLS notices', () => {
    it('uses the 14/7/3-day boundary and detects expired certificates', () => {
        const now = new Date('2026-10-02T00:00:00Z');
        for (const days of [14, 7, 3, 0])
            expect(certificateThreshold(new Date(now.getTime() + days * 86400000), now)).toBe(days);
        expect(certificateThreshold(new Date(now.getTime() + 15 * 86400000), now)).toBeNull();
    });
    it('classifies failed probes as unavailable monitoring, and follows new stores from actual domains', async () => {
        const now = new Date('2026-10-02T00:00:00Z');
        const notice = { upsertIncident: vi.fn(), resolveIncident: vi.fn(), enqueueOneOff: vi.fn() };
        const service = new StoreAvailabilityService(
            {
                rawConnection: {
                    getRepository: () => ({
                        find: () =>
                            Promise.resolve([
                                { id: 1, channelId: 2, domain: 'new-shop.example', channel: { id: 2 } },
                            ]),
                    }),
                },
            } as never,
            { create: () => Promise.resolve({ channelId: 2 }) } as never,
            notice as never,
            { count: () => Promise.resolve({ count: 2 }), reset: () => Promise.resolve(undefined) } as never,
            { get: () => Promise.resolve({ enabled: true, notifySecurityEvents: true }) } as never,
        );
        const probe = vi.fn(async () => {
            await Promise.resolve();
            throw new Error('network failure with private details');
        });
        await service.reconcile(now, probe);
        expect(probe).toHaveBeenCalledWith('new-shop.example');
        expect(notice.upsertIncident).toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({
                eventType: 'system.monitor.unavailable',
                payload: expect.objectContaining({ reason: expect.stringContaining('暂不能区分') }),
            }),
        );
        notice.upsertIncident.mockClear();
        await service.reconcile(now, () =>
            Promise.resolve({
                healthy: true,
                certificateValid: true,
                certificateEnd: new Date(now.getTime() + 3 * 86400000),
            }),
        );
        expect(notice.upsertIncident).not.toHaveBeenCalled();
        expect(notice.resolveIncident).toHaveBeenCalledWith(
            expect.anything(),
            'store.monitor:2',
            expect.anything(),
        );
        expect(notice.enqueueOneOff).toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({ dedupKey: expect.stringContaining(':3'), silent: true }),
        );
    });
});

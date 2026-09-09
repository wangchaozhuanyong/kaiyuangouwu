import { describe, expect, it, vi } from 'vitest';

import { createManualDeliveryEmailGuard } from './manual-delivery-email-guard';

function fixture() {
    const current = {
        recipientEmail: 'fixture@example.invalid',
        packages: [{ note: 'synthetic' }],
        attachments: [{ filename: 'fixture.txt', source: 'fixture.txt' }],
    };
    const queuedEmailPayload = vi.fn().mockResolvedValue(current);
    const injector = { get: () => ({ queuedEmailPayload }) } as any;
    const email: any = {
        type: 'manual-digital-delivery',
        recipient: current.recipientEmail,
        metadata: { deliveryId: '1' },
        templateVars: { deliveryId: '1', packages: current.packages },
        attachments: [{ filename: 'fixture.txt', path: '/synthetic-assets/fixture.txt' }],
    };
    return {
        current,
        queuedEmailPayload,
        injector,
        email,
        guard: createManualDeliveryEmailGuard('/synthetic-assets'),
    };
}

describe('Manual delivery send-time authorization', () => {
    it('accepts a current task and its current attachments', async () => {
        const f = fixture();
        await expect(f.guard(f.injector, {} as any, f.email)).resolves.toBeUndefined();
        expect(f.queuedEmailPayload).toHaveBeenCalledWith({}, '1');
    });
    it.each(['recipient', 'attachment', 'content', 'packages', 'identifier', 'path'])(
        'rejects changed %s',
        async kind => {
            const f = fixture();
            if (kind === 'recipient') f.email.recipient = 'other@example.invalid';
            if (kind === 'attachment') f.email.attachments[0].path = '/synthetic-assets/other.txt';
            if (kind === 'content') f.email.attachments[0].content = '"unverified contents"';
            if (kind === 'packages') f.email.templateVars.packages = [];
            if (kind === 'identifier') f.email.metadata.deliveryId = 'different';
            if (kind === 'path') f.current.attachments[0].source = '../outside.txt';
            await expect(f.guard(f.injector, {} as any, f.email)).rejects.toThrow();
        },
    );
    it('propagates a revoked channel grant before transport', async () => {
        const f = fixture();
        f.queuedEmailPayload.mockRejectedValue(new Error('synthetic revoked grant'));
        await expect(f.guard(f.injector, {} as any, f.email)).rejects.toThrow('revoked grant');
    });
    it('leaves other email handlers unchanged', async () => {
        const f = fixture();
        f.email.type = 'email-verification';
        await f.guard(f.injector, {} as any, f.email);
        expect(f.queuedEmailPayload).not.toHaveBeenCalled();
    });
});

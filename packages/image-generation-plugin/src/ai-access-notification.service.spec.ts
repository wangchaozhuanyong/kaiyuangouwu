import { describe, expect, it, vi } from 'vitest';

import { AiAccessNotificationService } from './ai-access-notification.service';
import { ImageProviderCredentialModel } from './entities/image-provider-credential-model.entity';
import { ImageProviderCredential } from './entities/image-provider-credential.entity';
function fixture() {
    const update = vi.fn(() => Promise.resolve({ affected: 1 }));
    const notices = {
        upsertIncident: vi.fn(() => Promise.resolve({ id: 1 })),
        resolveIncident: vi.fn(() => Promise.resolve(true)),
    };
    const connection = {
        rawConnection: {
            getRepository: () => ({
                find: () =>
                    Promise.resolve([
                        {
                            channelId: 2,
                            promptOptimizationEnabled: true,
                            channel: { id: 2, code: 'shop-b', customFields: { storefrontNameZh: '乙店' } },
                        },
                    ]),
            }),
        },
        getRepository: (_ctx: any, entity: any) => ({
            update,
            find: () =>
                Promise.resolve(
                    entity === ImageProviderCredentialModel
                        ? []
                        : entity === ImageProviderCredential
                          ? []
                          : [{ id: 8, enabled: true }],
                ),
        }),
    };
    return {
        update,
        notices,
        service: new AiAccessNotificationService(
            connection as never,
            notices as never,
            {} as never,
            {} as never,
        ),
    };
}
describe('durable AI access incidents', () => {
    it('treats a confirmed balance error as a key fault even on HTTP 402, and never emits raw key data', async () => {
        const test = fixture();
        await test.service.result(
            { channelId: 2 } as never,
            '7',
            'IMAGE',
            { httpStatus: 402, accessFailure: 'BALANCE' },
            false,
        );
        expect(test.update).toHaveBeenCalledWith(
            { id: '7' },
            expect.objectContaining({ healthStatus: 'UNHEALTHY' }),
        );
        expect(test.notices.upsertIncident).toHaveBeenCalledWith(
            null,
            expect.objectContaining({
                fingerprint: 'ai.access:IMAGE:7',
                payload: expect.objectContaining({
                    accessId: '7',
                    purpose: '图片生成',
                    affectedStores: ['乙店'],
                    reason: expect.stringContaining('余额不足'),
                }),
            }),
        );
        expect(JSON.stringify(test.notices.upsertIncident.mock.calls)).not.toMatch(
            /apiKeyLast4|encryptedApiKey|requestBody|promptBody/,
        );
    });
    it('ignores unconfirmed rate limiting, model permission problems and timeouts', async () => {
        const test = fixture();
        for (const status of [429, 403, 408])
            await test.service.result({} as never, '7', 'IMAGE', { httpStatus: status }, false);
        expect(test.update).not.toHaveBeenCalled();
        expect(test.notices.upsertIncident).not.toHaveBeenCalled();
    });
    it('resolves each independently managed key only after a real success or an existing connection test', async () => {
        const test = fixture();
        await test.service.result({ channelId: 2 } as never, '9', 'PROMPT', {}, true);
        expect(test.notices.resolveIncident).toHaveBeenCalledWith(
            expect.anything(),
            'ai.access:PROMPT:9',
            expect.objectContaining({ reason: expect.stringContaining('真实上游调用') }),
        );
        expect(test.notices.upsertIncident).not.toHaveBeenCalled();
    });
});

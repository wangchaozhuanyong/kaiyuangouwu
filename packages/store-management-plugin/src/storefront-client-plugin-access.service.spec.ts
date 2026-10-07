import { RequestContext } from '@vendure/core';
import { describe, expect, it, vi } from 'vitest';

import { StorefrontClientPluginAccessService } from './storefront-client-plugin-access.service';

function fixture() {
    const enabled = new Map([
        ['shop-a', true],
        ['shop-b', false],
    ]);
    const contexts = {
        create: vi.fn((options: any) =>
            Promise.resolve({
                channelId: options.channelOrToken.id,
                languageCode: options.languageCode,
                setReplicationMode: vi.fn(),
            }),
        ),
    };
    const content = {
        findPublished: vi.fn((requestContext: any) =>
            Promise.resolve(
                enabled.get(requestContext.channelId)
                    ? [
                          {
                              type: 'CLIENT_PLUGINS',
                              items: [{ enabled: true, settings: { pluginCode: 'ai-image-studio-entry' } }],
                          },
                      ]
                    : [],
            ),
        ),
    };
    const service = new StorefrontClientPluginAccessService(contexts as any, content as any);
    const ctx = {
        apiType: 'shop',
        channelId: 'shop-a',
        channel: { id: 'shop-a' },
        languageCode: 'zh_Hans',
        currencyCode: 'CNY',
        oldTransactionSnapshot: true,
    } as unknown as RequestContext;
    return { service, contexts, content, enabled, ctx };
}
describe('fresh published client-plugin admission', () => {
    it('does not admit a retained or direct request after the plugin is turned off, then allows re-enable', async () => {
        const f = fixture();
        await expect(f.service.assertEnabled(f.ctx, 'ai-image-studio-entry')).resolves.toBeUndefined();
        f.enabled.set('shop-a', false);
        await expect(f.service.assertEnabled(f.ctx, 'ai-image-studio-entry')).rejects.toThrow('尚未开启');
        const direct = { ...f.ctx } as RequestContext;
        await expect(f.service.assertEnabled(direct, 'ai-image-studio-entry')).rejects.toThrow();
        f.enabled.set('shop-a', true);
        await expect(f.service.assertEnabled(f.ctx, 'ai-image-studio-entry')).resolves.toBeUndefined();
        expect(f.contexts.create).toHaveBeenCalledTimes(4);
        expect(f.content.findPublished.mock.calls.every(([ctx]) => !('oldTransactionSnapshot' in ctx))).toBe(
            true,
        );
        for (const [ctx] of f.content.findPublished.mock.calls) {
            expect(ctx.setReplicationMode).toHaveBeenCalledWith('master');
        }
    });

    it('uses current Channel content, rejects absent/disabled entries and never broadens from other plugin codes', async () => {
        const f = fixture();
        expect(
            await f.service.isEnabled(
                { ...f.ctx, channelId: 'shop-b', channel: { id: 'shop-b' } } as any,
                'ai-image-studio-entry',
            ),
        ).toBe(false);
        f.content.findPublished.mockResolvedValue([
            {
                type: 'CLIENT_PLUGINS',
                items: [
                    { enabled: false, settings: { pluginCode: 'ai-image-studio-entry' } },
                    { enabled: true, settings: { pluginCode: 'category-support-entry' } },
                ],
            },
        ]);
        expect(await f.service.isEnabled(f.ctx, 'ai-image-studio-entry')).toBe(false);
    });

    it('fails closed without exposing private read errors and leaves Admin/worker work outside the Shop gate', async () => {
        const f = fixture();
        f.content.findPublished.mockRejectedValue(new Error('private database error'));
        await expect(f.service.isEnabled(f.ctx, 'ai-image-studio-entry')).rejects.toThrow(
            '店铺插件配置读取失败，请重试',
        );
        expect(
            await f.service.isEnabled({ ...f.ctx, apiType: 'admin' } as any, 'ai-image-studio-entry'),
        ).toBe(true);
        expect(f.content.findPublished).toHaveBeenCalledTimes(1);
    });
});

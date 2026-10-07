import { RequestContext } from '@vendure/core';
import { StorefrontClientPluginAccessService } from '@vendure/store-management-plugin';
import { describe, expect, it, vi } from 'vitest';

import { ImageGenerationConfig } from './entities/image-generation-config.entity';
import { ImageGenerationJob } from './entities/image-generation-job.entity';
import { ImageGenerationConfigService } from './image-generation-config.service';
import { ImageGenerationCreation } from './image-generation-creation';
import { ImageGenerationJobViews } from './image-generation-job-views';
import { ImageGenerationReferences } from './image-generation-references';
import { ImagePromptEngineService } from './prompt/image-prompt-engine.service';

function fixture() {
    let enabled = false;
    const contexts = {
        create: vi.fn(() => Promise.resolve({ channelId: 'shop-a', setReplicationMode: vi.fn() })),
    };
    const content = {
        findPublished: vi.fn(() =>
            Promise.resolve(
                enabled
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
    const gate = new StorefrontClientPluginAccessService(contexts as any, content as any);
    const config = new ImageGenerationConfigService(
        {},
        {} as any,
        {} as any,
        {} as any,
        {} as any,
        {} as any,
        {} as any,
    );
    Reflect.set(config, 'clientPluginAccess', gate);
    const jobRepo = {
        findOne: vi.fn().mockResolvedValue(null),
        count: vi.fn().mockResolvedValue(0),
        save: vi.fn(),
    };
    const configRepo = { findOne: vi.fn().mockResolvedValue({ enabled: true }) };
    const connection = {
        rawConnection: { options: { type: 'sqljs' } },
        getRepository: vi.fn((_ctx, entity) =>
            entity === ImageGenerationJob ? jobRepo : entity === ImageGenerationConfig ? configRepo : {},
        ),
        withTransaction: vi.fn((requestContext, callback) =>
            Promise.resolve().then(() => callback(requestContext)),
        ),
    };
    const storage = {
        storeReference: vi.fn(),
        signedUrl: vi.fn((_ctx, _asset, _customer, download) => (download ? 'new-download' : 'preview')),
    };
    const quota = { consumeAttempt: vi.fn() };
    const wallet = { reserve: vi.fn() };
    const provider = { optimizePrompt: vi.fn() };
    const ctx = {
        apiType: 'shop',
        activeUserId: 'customer-user',
        channelId: 'shop-a',
        channel: { id: 'shop-a' },
        languageCode: 'zh_Hans',
    } as unknown as RequestContext;
    const views = new ImageGenerationJobViews(connection as any, storage as any, request =>
        config.isStorefrontEntryEnabled(request),
    );
    const creation = new ImageGenerationCreation(
        {
            connection,
            configService: config,
            activeCustomer: () => Promise.resolve({ id: 'customer' }),
            quota,
            walletSpend: wallet,
            storage,
        } as any,
        { validateCreateInput: () => ({ idempotencyKey: 'request-key' }) } as any,
        views,
    );
    const references = new ImageGenerationReferences(
        {
            connection,
            configService: config,
            storage,
            activeCustomer: () => Promise.resolve({ id: 'customer' }),
        } as any,
        views,
    );
    const engine = new ImagePromptEngineService(
        connection as any,
        { findOneByUserId: () => Promise.resolve({ id: 'customer' }) } as any,
        {} as any,
        config,
        quota as any,
        wallet as any,
        provider as any,
        {} as any,
        storage as any,
    );
    vi.spyOn(engine, 'assertSafe').mockImplementation(() => undefined);
    return {
        config,
        gate,
        content,
        ctx,
        views,
        creation,
        references,
        engine,
        connection,
        jobRepo,
        quota,
        wallet,
        storage,
        provider,
        setEnabled: (value: boolean) => {
            enabled = value;
        },
    };
}
describe('AI client-plugin execution boundary', () => {
    it('rejects direct generation, upload, prompt optimization and recommendation before business effects when closed', async () => {
        const f = fixture();
        await expect(f.creation.create(f.ctx, {} as any)).rejects.toThrow('尚未开启');
        await expect(f.references.uploadReference(f.ctx, Promise.resolve({} as any), true)).rejects.toThrow(
            '尚未开启',
        );
        await expect(f.engine.optimize(f.ctx, { prompt: '绘制一张绿色森林插画' } as any)).rejects.toThrow(
            '尚未开启',
        );
        await expect(f.engine.recommend(f.ctx, '绘制一张绿色森林插画')).rejects.toThrow('尚未开启');
        expect(f.connection.withTransaction).not.toHaveBeenCalled();
        expect(f.storage.storeReference).not.toHaveBeenCalled();
        expect(f.quota.consumeAttempt).not.toHaveBeenCalled();
        expect(f.wallet.reserve).not.toHaveBeenCalled();
        expect(f.provider.optimizePrompt).not.toHaveBeenCalled();
    });

    it('checks published content again inside admission rather than trusting an earlier enabled result', async () => {
        const f = fixture();
        f.setEnabled(true);
        expect(await f.config.isStorefrontEntryEnabled(f.ctx)).toBe(true);
        vi.spyOn(f.config, 'shopConfig').mockImplementationOnce(() => {
            f.setEnabled(false);
            return Promise.resolve({ enabled: true } as any);
        });
        await expect(f.creation.create(f.ctx, {} as any)).rejects.toThrow('尚未开启');
        expect(f.connection.withTransaction).toHaveBeenCalledOnce();
        expect(f.jobRepo.save).not.toHaveBeenCalled();
        expect(f.quota.consumeAttempt).not.toHaveBeenCalled();
        expect(f.wallet.reserve).not.toHaveBeenCalled();
    });

    it('keeps historical output readable but issues no new download signature after close or a failed read', async () => {
        const f = fixture();
        const job = { outputs: [{ id: 'output', asset: { id: 'asset', width: 100, height: 100 } }] } as any;
        f.setEnabled(true);
        expect((await f.views.jobView(f.ctx, job, 'customer')).outputs[0].downloadUrl).toBe('new-download');
        f.setEnabled(false);
        const view = await f.views.jobView(f.ctx, job, 'customer');
        expect(view.outputs[0]).toMatchObject({ id: 'output', imageUrl: 'preview', downloadUrl: null });
        f.content.findPublished.mockRejectedValue(new Error('read failed'));
        await expect(f.views.jobView(f.ctx, job, 'customer')).rejects.toThrow('配置读取失败');
        expect(f.storage.signedUrl.mock.calls.filter(call => call[3] === true)).toHaveLength(1);
    });
});

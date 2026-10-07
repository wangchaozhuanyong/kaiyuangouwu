import { RequestContext } from '@vendure/core';
import { describe, expect, it, vi } from 'vitest';

import { ImageGenerationConfig } from './entities/image-generation-config.entity';
import { ImageCapabilityReadinessService } from './image-capability-readiness.service';

vi.mock('@vendure/store-management-plugin', () => ({
    AdminCapabilitiesService: class {},
    StorefrontClientPluginAccessService: class {},
}));

function fixture() {
    const config = { findOne: vi.fn().mockResolvedValue({ enabled: true }), save: vi.fn() };
    const models = { find: vi.fn().mockResolvedValue([]), save: vi.fn() };
    const connection = {
        getRepository: vi.fn((_ctx, entity) => (entity === ImageGenerationConfig ? config : models)),
    };
    const router = { hasAvailable: vi.fn().mockResolvedValue(true) };
    const capabilities = { registerImageReadiness: vi.fn() };
    const service = new ImageCapabilityReadinessService(
        connection as any,
        router as any,
        capabilities as any,
    );
    const ctx = { channelId: 'store-a' } as RequestContext;
    return { service, config, models, connection, router, capabilities, ctx };
}

describe('read-only image capability readiness', () => {
    it('registers a reader and does not create missing settings or models', async () => {
        const f = fixture();
        f.config.findOne.mockResolvedValue(null);
        f.service.onModuleInit();
        const reader = f.capabilities.registerImageReadiness.mock.calls[0][0];
        expect(await reader(f.ctx)).toEqual({ enabled: false, configured: false });
        expect(f.config.findOne).toHaveBeenCalledWith({ where: { channelId: 'store-a' } });
        expect(f.models.find).not.toHaveBeenCalled();
        expect(f.config.save).not.toHaveBeenCalled();
        expect(f.models.save).not.toHaveBeenCalled();
    });

    it('uses only current-store healthy models and the existing global provider eligibility check', async () => {
        const f = fixture();
        f.models.find.mockResolvedValue([
            {
                id: 'healthy',
                enabled: true,
                healthStatus: 'HEALTHY',
                protocol: 'OPENAI_IMAGES',
                providerModelId: 'gpt-image-1',
            },
            {
                id: 'unhealthy',
                enabled: true,
                healthStatus: 'FAILED',
                protocol: 'OPENAI_IMAGES',
                providerModelId: 'gpt-image-1',
            },
        ]);
        expect(await f.service.read(f.ctx)).toEqual({ enabled: true, configured: true });
        expect(f.models.find).toHaveBeenCalledWith({ where: { channelId: 'store-a', enabled: true } });
        expect(f.router.hasAvailable).toHaveBeenCalledExactlyOnceWith(f.ctx, {
            scope: 'OPENAI',
            purpose: 'IMAGE',
            modelConfigId: 'healthy',
        });
        expect(f.models.save).not.toHaveBeenCalled();
    });

    it('keeps disabled distinct from configured and does not expose private records', async () => {
        const f = fixture();
        f.config.findOne.mockResolvedValue({ enabled: false, termsZh: 'private configuration' });
        f.models.find.mockResolvedValue([
            {
                id: 'model',
                enabled: true,
                healthStatus: 'HEALTHY',
                protocol: 'GEMINI_NATIVE',
                providerModelId: 'gemini-image',
            },
        ]);
        expect(await f.service.read(f.ctx)).toEqual({ enabled: false, configured: true });
        expect(f.router.hasAvailable).toHaveBeenCalledWith(f.ctx, {
            scope: 'GEMINI',
            purpose: 'IMAGE',
            modelConfigId: 'model',
        });
    });

    it('does not claim configuration when the provider cannot serve an otherwise healthy model', async () => {
        const f = fixture();
        f.models.find.mockResolvedValue([
            {
                id: 'model',
                enabled: true,
                healthStatus: 'HEALTHY',
                protocol: 'OPENAI_IMAGES',
                providerModelId: 'gpt-image-1',
            },
        ]);
        f.router.hasAvailable.mockResolvedValue(false);
        expect(await f.service.read(f.ctx)).toEqual({ enabled: true, configured: false });
    });

    it('propagates read failures so bootstrap can fail closed and offer retry', async () => {
        const f = fixture();
        f.config.findOne.mockRejectedValue(new Error('database read failed'));
        await expect(f.service.read(f.ctx)).rejects.toThrow('database read failed');
        expect(f.config.save).not.toHaveBeenCalled();
    });
});

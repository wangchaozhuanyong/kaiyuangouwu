import { describe, expect, it, vi } from 'vitest';

import { ImageModelConfig } from './entities/image-model-config.entity';
import { ImagePromptSkillRelease } from './entities/image-prompt-skill-release.entity';
import { ImageProviderCredentialModel } from './entities/image-provider-credential-model.entity';
import { ImageProviderCredential } from './entities/image-provider-credential.entity';
import {
    ImageGenerationConfigService,
    modelReady,
    providerScopeForModel,
} from './image-generation-config.service';

describe('providerScopeForModel', () => {
    it('routes native Gemini models to the Gemini credential', () => {
        expect(providerScopeForModel('GEMINI_NATIVE', 'gemini-3.1-flash-image')).toBe('GEMINI');
        expect(providerScopeForModel('GEMINI_NATIVE_STREAM', 'gemini-3.1-flash-image')).toBe('GEMINI');
        expect(providerScopeForModel('GEMINI_INTERACTIONS', 'relay-image-model')).toBe('GEMINI');
    });

    it('routes Gemini-compatible chat model IDs to the Gemini credential', () => {
        expect(providerScopeForModel('OPENAI_COMPATIBLE_CHAT', 'models/gemini-3-pro-image')).toBe('GEMINI');
        expect(providerScopeForModel('OPENAI_COMPATIBLE_CHAT', 'imagen-4.0-generate-001')).toBe('GEMINI');
    });

    it('routes OpenAI image models to the OpenAI credential', () => {
        expect(providerScopeForModel('OPENAI_IMAGES', 'gpt-image-2')).toBe('OPENAI');
        expect(providerScopeForModel('OPENAI_RESPONSES_IMAGE', 'gpt-image-1')).toBe('OPENAI');
    });
});

describe('modelReady', () => {
    it('keeps a healthy model ready without expiring its last test timestamp', () => {
        expect(
            modelReady({
                healthStatus: 'HEALTHY',
                lastTestedAt: new Date('2020-01-01T00:00:00.000Z'),
            } as any),
        ).toBe(true);
        expect(modelReady({ healthStatus: 'HEALTHY', lastTestedAt: null } as any)).toBe(true);
    });

    it('still blocks untested and unhealthy models', () => {
        expect(modelReady({ healthStatus: 'UNTESTED', lastTestedAt: new Date() } as any)).toBe(false);
        expect(modelReady({ healthStatus: 'UNHEALTHY', lastTestedAt: new Date() } as any)).toBe(false);
    });
});

describe('ImageGenerationConfigService prompt Skill bootstrap', () => {
    it('promotes a newly discovered bundle when automatic activation is enabled', async () => {
        const oldRelease = release('old', 'ACTIVE', { marker: 'old' }, 1);
        const newRelease = release('new', 'INACTIVE', { marker: 'new' }, 2);
        const { service, repository, rules } = setup({
            autoActivate: true,
            currentRelease: null,
            activeRelease: oldRelease,
            savedRelease: newRelease,
        });

        await service.onApplicationBootstrap();

        expect(repository.save).toHaveBeenCalledWith(
            expect.objectContaining({ sourceHash: 'new', status: 'INACTIVE', activatedAt: null }),
        );
        expect(repository.update).toHaveBeenNthCalledWith(1, { status: 'ACTIVE' }, { status: 'INACTIVE' });
        expect(repository.update).toHaveBeenNthCalledWith(
            2,
            { id: 2 },
            expect.objectContaining({ status: 'ACTIVE', activatedAt: expect.any(Date) }),
        );
        expect(rules.activateBundle).toHaveBeenCalledWith({ marker: 'new' });
    });

    it('registers a new bundle without promoting it in manual mode', async () => {
        const oldRelease = release('old', 'ACTIVE', { marker: 'old' }, 1);
        const newRelease = release('new', 'INACTIVE', { marker: 'new' }, 2);
        const { service, repository, rules } = setup({
            autoActivate: false,
            currentRelease: null,
            activeRelease: oldRelease,
            savedRelease: newRelease,
        });

        await service.onApplicationBootstrap();

        expect(repository.update).not.toHaveBeenCalled();
        expect(rules.activateBundle).toHaveBeenCalledWith({ marker: 'old' });
    });

    it('does not let a restarted old process re-promote an existing historical bundle', async () => {
        const oldRelease = release('old', 'INACTIVE', { marker: 'old' }, 1);
        const newRelease = release('new', 'ACTIVE', { marker: 'new' }, 2);
        const { service, repository, rules } = setup({
            autoActivate: true,
            currentRelease: oldRelease,
            activeRelease: newRelease,
            savedRelease: oldRelease,
            sourceHash: 'old',
        });

        await service.onApplicationBootstrap();

        expect(repository.save).not.toHaveBeenCalled();
        expect(repository.update).not.toHaveBeenCalled();
        expect(rules.activateBundle).toHaveBeenCalledWith({ marker: 'new' });
    });
});

describe('ImageGenerationConfigService prompt provider availability', () => {
    it('keeps prompt optimization available when only Gemini has a healthy prompt Key', async () => {
        const hasAvailable = vi.fn((_ctx: unknown, input: { scope: string; purpose: string }) =>
            Promise.resolve(input.scope === 'GEMINI' && input.purpose === 'PROMPT'),
        );
        const service = new ImageGenerationConfigService(
            {},
            { rawConnection: {} } as never,
            {} as never,
            {} as never,
            {} as never,
            { hasAvailable } as never,
            { sourceHash: 'hash' } as never,
        );
        vi.spyOn(service as never, 'synchronizeActiveSkillRelease').mockResolvedValue(undefined);
        vi.spyOn(service as never, 'getConfig').mockResolvedValue({
            enabled: true,
            promptOptimizationEnabled: true,
            promptRateLimitPerMinute: 3,
            promptDailyFreeLimit: 20,
            promptDailyFreeUnlimited: false,
            paidPromptOptimizationEnabled: false,
            paidPromptOptimizationPrice: 0,
            paidPromptOptimizationCurrencyCode: 'CNY',
            defaultModelCode: 'GEMINI_FLASH',
            termsVersion: 'test',
            termsZh: 'test',
            termsEn: 'test',
        });
        vi.spyOn(service as never, 'getOrCreateModels').mockResolvedValue([]);

        const result = await service.shopConfig({ channel: { defaultCurrencyCode: 'CNY' } } as never);

        expect(result.promptOptimizationEnabled).toBe(true);
        expect(hasAvailable).toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({ scope: 'OPENAI', purpose: 'PROMPT' }),
        );
        expect(hasAvailable).toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({ scope: 'GEMINI', purpose: 'PROMPT' }),
        );
    });
});

describe('ImageGenerationConfigService admin readiness', () => {
    it('reports credential readiness only when a healthy enabled model can actually route', async () => {
        const hasAvailable = vi.fn().mockResolvedValue(false);
        const service = new ImageGenerationConfigService(
            {},
            {} as never,
            {} as never,
            {} as never,
            {} as never,
            { hasAvailable } as never,
            { sourceHash: 'hash' } as never,
        );
        vi.spyOn(service as never, 'synchronizeActiveSkillRelease').mockResolvedValue(undefined);
        vi.spyOn(service as never, 'getOrCreateConfig').mockResolvedValue({ enabled: true });
        vi.spyOn(service as never, 'getOrCreateModels').mockResolvedValue([
            {
                id: 'model-1',
                enabled: true,
                healthStatus: 'HEALTHY',
                protocol: 'OPENAI_IMAGES',
                providerModelId: 'gpt-image-2',
            },
        ]);

        const unavailable = await service.adminConfig({ channelId: 'channel-a' } as never);
        hasAvailable.mockResolvedValue(true);
        const available = await service.adminConfig({ channelId: 'channel-a' } as never);

        expect(unavailable.credentialEnabled).toBe(false);
        expect(available.credentialEnabled).toBe(true);
        expect(hasAvailable).toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({ purpose: 'IMAGE', modelConfigId: 'model-1' }),
        );
    });
});

describe('ImageGenerationConfigService provider bindings', () => {
    it('replaces only bindings owned by the active Channel', async () => {
        const { service, bindingRepository } = credentialService();

        await service.saveCredential({ channelId: 'channel-a' } as never, {
            id: 'credential-1',
            scope: 'OPENAI',
            code: 'openai-primary',
            name: 'OpenAI Primary',
            purpose: 'BOTH',
            baseUrl: 'https://relay.example.com/v1',
            apiKey: null,
            textModelId: 'gpt-text',
            enabled: true,
            priority: 10,
            weight: 1,
            modelCodes: [],
        });

        expect(bindingRepository.delete).toHaveBeenCalledWith({
            credentialId: 'credential-1',
            modelConfigId: expect.objectContaining({
                _type: 'in',
                _value: ['channel-a-model'],
            }),
        });
    });

    it('rejects changing a credential stable code after creation', async () => {
        const { service } = credentialService();

        await expect(
            service.saveCredential({ channelId: 'channel-a' } as never, {
                id: 'credential-1',
                scope: 'OPENAI',
                code: 'renamed-code',
                name: 'OpenAI Primary',
                purpose: 'BOTH',
                baseUrl: 'https://relay.example.com/v1',
                apiKey: null,
                textModelId: 'gpt-text',
                enabled: true,
                priority: 10,
                weight: 1,
                modelCodes: [],
            }),
        ).rejects.toThrow('稳定代码创建后不能修改');
    });
});

function setup(input: {
    autoActivate: boolean;
    currentRelease: ImagePromptSkillRelease | null;
    activeRelease: ImagePromptSkillRelease | null;
    savedRelease: ImagePromptSkillRelease;
    sourceHash?: string;
}) {
    const repository = {
        findOne: vi.fn(({ where }: { where: Record<string, unknown> }) =>
            Promise.resolve('sourceHash' in where ? input.currentRelease : input.activeRelease),
        ),
        save: vi.fn(() => Promise.resolve(input.savedRelease)),
        update: vi.fn(() => Promise.resolve()),
    };
    const rawConnection = {
        getRepository: vi.fn(() => repository),
        transaction: vi.fn((work: (manager: { getRepository: () => typeof repository }) => unknown) =>
            work({ getRepository: () => repository }),
        ),
    };
    const rules = {
        sourceHash: input.sourceHash ?? 'new',
        serializableBundle: { bundleVersion: 1, marker: 'new' },
        activateBundle: vi.fn(),
    };
    const service = new ImageGenerationConfigService(
        { autoActivateSkillReleases: input.autoActivate },
        { rawConnection } as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
        rules as never,
    );
    return { service, repository, rules };
}

function credentialService() {
    const credential = {
        id: 'credential-1',
        code: 'openai-primary',
        scope: 'OPENAI',
        name: 'OpenAI Primary',
        purpose: 'BOTH',
        enabled: true,
        baseUrl: 'https://relay.example.com/v1',
        textModelId: 'gpt-text',
        encryptedApiKey: 'encrypted',
        apiKeyLast4: 'test',
        healthStatus: 'HEALTHY',
        healthMessage: 'ok',
        lastTestedAt: new Date(),
        priority: 10,
        weight: 1,
        currentWeight: 0,
        consecutiveFailures: 0,
        cooldownUntil: null,
        lastUsedAt: null,
        archivedAt: null,
    };
    const credentialRepository = {
        findOne: vi.fn().mockResolvedValue(credential),
        save: vi.fn((value: unknown) => Promise.resolve(value)),
    };
    const modelRepository = {
        find: vi.fn().mockResolvedValue([{ id: 'channel-a-model' }]),
    };
    const bindingQuery = {
        innerJoinAndSelect: vi.fn(),
        where: vi.fn(),
        andWhere: vi.fn(),
        getMany: vi.fn().mockResolvedValue([]),
    };
    for (const method of ['innerJoinAndSelect', 'where', 'andWhere'] as const) {
        bindingQuery[method].mockReturnValue(bindingQuery);
    }
    const bindingRepository = {
        delete: vi.fn().mockResolvedValue({ affected: 1 }),
        save: vi.fn(),
        createQueryBuilder: vi.fn(() => bindingQuery),
    };
    const connection = {
        getRepository: vi.fn((_ctx: unknown, entity: unknown) => {
            if (entity === ImageProviderCredential) return credentialRepository;
            if (entity === ImageModelConfig) return modelRepository;
            if (entity === ImageProviderCredentialModel) return bindingRepository;
            throw new Error('Unexpected repository');
        }),
        withTransaction: vi.fn((_ctx: unknown, work: (ctx: unknown) => unknown) =>
            work({ channelId: 'channel-a' }),
        ),
    };
    const service = new ImageGenerationConfigService(
        {},
        connection as never,
        { encrypt: vi.fn() } as never,
        { validate: vi.fn((value: string) => Promise.resolve(new URL(value))) } as never,
        {} as never,
        {} as never,
        {} as never,
    );
    return { service, bindingRepository };
}

function release(
    sourceHash: string,
    status: 'ACTIVE' | 'INACTIVE',
    bundle: Record<string, unknown>,
    id: number,
): ImagePromptSkillRelease {
    const value = new ImagePromptSkillRelease({
        id,
        sourceHash,
        status,
        bundleVersion: 1,
        activatedAt: status === 'ACTIVE' ? new Date() : null,
    });
    value.bundle = bundle;
    return value;
}

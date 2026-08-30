import { describe, expect, it, vi } from 'vitest';

import { ImagePromptSkillRelease } from './entities/image-prompt-skill-release.entity';
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
        const availablePromptModelIds = vi.fn((_ctx: unknown, scope: string) =>
            Promise.resolve(scope === 'GEMINI' ? ['gemini-2.5-flash'] : []),
        );
        const service = new ImageGenerationConfigService(
            {},
            { rawConnection: {} } as never,
            {} as never,
            {} as never,
            {} as never,
            { availablePromptModelIds } as never,
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

        const result = await service.shopConfig({
            currencyCode: 'CNY',
            channel: { defaultCurrencyCode: 'CNY', customFields: {} },
        } as never);

        expect(result.promptOptimizationEnabled).toBe(true);
        expect(result.promptOptimizerModelIds).toEqual(['gemini-2.5-flash']);
        expect(availablePromptModelIds).toHaveBeenCalledWith(expect.anything(), 'OPENAI');
        expect(availablePromptModelIds).toHaveBeenCalledWith(expect.anything(), 'GEMINI');
    });

    it('returns model and prompt prices in the active settlement currency', async () => {
        const service = new ImageGenerationConfigService(
            {},
            { rawConnection: {} } as never,
            {} as never,
            {} as never,
            {} as never,
            {
                hasAvailable: vi.fn(() => Promise.resolve(true)),
                availablePromptModelIds: vi.fn(() => Promise.resolve(['gpt-5.4-mini'])),
            } as never,
            { sourceHash: 'hash' } as never,
        );
        vi.spyOn(service as never, 'synchronizeActiveSkillRelease').mockResolvedValue(undefined);
        vi.spyOn(service as never, 'getConfig').mockResolvedValue({
            enabled: true,
            promptOptimizationEnabled: true,
            promptRateLimitPerMinute: 3,
            promptDailyFreeLimit: 20,
            promptDailyFreeUnlimited: false,
            paidPromptOptimizationEnabled: true,
            paidPromptOptimizationPrice: 100,
            paidPromptOptimizationCurrencyCode: 'CNY',
            defaultModelCode: 'OPENAI_HIGH_QUALITY',
            termsVersion: 'test',
            termsZh: 'test',
            termsEn: 'test',
        });
        vi.spyOn(service as never, 'getOrCreateModels').mockResolvedValue([
            {
                id: 1,
                code: 'OPENAI_HIGH_QUALITY',
                enabled: true,
                healthStatus: 'HEALTHY',
                protocol: 'OPENAI_RESPONSES_IMAGE',
                providerModelId: 'gpt-image-1',
                officialModelId: 'gpt-image-1',
                unitPrice: 100,
                unitPrice2K: 0,
                unitPrice4K: 0,
                currencyCode: 'CNY',
                resolutionOptions: [{ resolution: '1K', unitPrice: 100, supportedAspectRatios: ['1:1'] }],
            },
        ]);

        const result = await service.shopConfig({
            currencyCode: 'MYR',
            channel: {
                defaultCurrencyCode: 'CNY',
                customFields: { cnyToMyrRate: 0.6, currencyRateMarkupBps: 0 },
            },
        } as never);

        expect(result.paidPromptOptimizationPrice).toBe(60);
        expect(result.paidPromptOptimizationCurrencyCode).toBe('MYR');
        expect(result.promptOptimizerModelIds).toEqual(['gpt-5.4-mini']);
        expect(result.models[0]).toMatchObject({
            unitPrice: 60,
            currencyCode: 'MYR',
            resolutionOptions: [{ resolution: '1K', unitPrice: 60 }],
        });
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

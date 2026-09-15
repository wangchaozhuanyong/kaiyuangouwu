/* eslint-disable @typescript-eslint/require-await -- Repository mocks preserve async service APIs. */
import { CurrencyCode } from '@vendure/common/lib/generated-types';
import { describe, expect, it, vi } from 'vitest';

import { ImageGenerationJob } from './entities/image-generation-job.entity';
import { ImageGenerationOutput } from './entities/image-generation-output.entity';
import { ImageGenerationService, referenceModeInstruction } from './image-generation.service';

describe('ImageGenerationService settlement currency', () => {
    it('reads the referral wallet for the active request currency', async () => {
        const findOne = vi.fn(() => Promise.resolve({ availableBalance: 880 }));
        const connection = { getRepository: vi.fn(() => ({ findOne })) };
        const service = new ImageGenerationService(
            connection as never,
            { findOneByUserId: vi.fn(() => Promise.resolve({ id: 42 })) } as never,
            {} as never,
            {} as never,
            {} as never,
            {} as never,
            {} as never,
            {} as never,
            {} as never,
        );

        await expect(
            service.wallet({
                activeUserId: 9,
                channelId: 3,
                currencyCode: CurrencyCode.MYR,
            } as never),
        ).resolves.toEqual({ availableBalance: 880, currencyCode: CurrencyCode.MYR });
        expect(findOne).toHaveBeenCalledWith({
            where: { channelId: 3, customerId: 42, currencyCode: CurrencyCode.MYR },
        });
    });
});

describe('admin product image configuration boundary', () => {
    const createService = (shopConfig: unknown) =>
        new ImageGenerationService(
            {} as never,
            {} as never,
            {} as never,
            { shopConfig: vi.fn(async () => shopConfig) } as never,
            {} as never,
            {} as never,
            {} as never,
            {} as never,
            {} as never,
        );

    it('returns only public fixed generation settings and never credentials', async () => {
        const service = createService({
            enabled: true,
            defaultModelCode: 'default-model',
            termsVersion: 'v1',
            termsZh: '条款',
            models: [{ code: 'default-model', displayNameZh: '默认模型' }],
        });
        const result = await service.catalogConfig({
            userHasPermissions: (permissions: string[]) =>
                permissions.includes('CreateProduct') || permissions.includes('CreateAsset'),
        } as never);
        expect(result).toMatchObject({
            enabled: true,
            defaultModelCode: 'default-model',
            defaultModelName: '默认模型',
            aspectRatio: '1:1',
            resolution: '1K',
            quantity: 1,
        });
        expect(result).not.toHaveProperty('apiKey');
        expect(result).not.toHaveProperty('baseUrl');
    });

    it('requires both product-edit and asset-create permission groups', async () => {
        const service = createService({ enabled: true, models: [] });
        await expect(
            service.catalogConfig({
                userHasPermissions: (permissions: string[]) => permissions.includes('CreateProduct'),
            } as never),
        ).rejects.toThrow('需要商品编辑和素材创建权限');
    });
});

describe('admin product image settlement', () => {
    it('records internal billing without touching customer quota or wallet', async () => {
        const job = new ImageGenerationJob({
            id: 9,
            origin: 'ADMIN_PRODUCT_IMAGE',
            unitPriceSnapshot: 800,
            freeQuantityCaptured: 0,
            freeQuantityReserved: 0,
            quotaEventId: null,
            walletUsageId: null,
        });
        const output = new ImageGenerationOutput({
            id: 10,
            jobId: 9,
            job,
            state: 'RUNNING',
            walletSettled: false,
        });
        const query = {
            innerJoinAndSelect: vi.fn().mockReturnThis(),
            where: vi.fn().mockReturnThis(),
            setLock: vi.fn().mockReturnThis(),
            getOne: vi.fn(async () => output),
        };
        const outputRepository = {
            createQueryBuilder: vi.fn(() => query),
            save: vi.fn(async (value: ImageGenerationOutput) => value),
        };
        const jobRepository = { save: vi.fn(async (value: ImageGenerationJob) => value) };
        const connection = {
            rawConnection: { options: { type: 'sqlite' } },
            withTransaction: vi.fn(async (_ctx, work) => work(_ctx)),
            getRepository: vi.fn((_ctx, entity) =>
                entity === ImageGenerationOutput ? outputRepository : jobRepository,
            ),
        };
        const walletSpend = { capture: vi.fn() };
        const quota = { capture: vi.fn() };
        const service = new ImageGenerationService(
            connection as never,
            {} as never,
            walletSpend as never,
            {} as never,
            quota as never,
            {} as never,
            {} as never,
            {} as never,
            {} as never,
        );

        await expect(service.settleSuccessfulOutput({} as never, output.id, 11)).resolves.toMatchObject({
            state: 'SUCCEEDED',
            billingMode: 'INTERNAL',
            chargeAmount: 0,
            walletSettled: true,
        });
        expect(walletSpend.capture).not.toHaveBeenCalled();
        expect(quota.capture).not.toHaveBeenCalled();
    });
});

describe('reference image prompt language', () => {
    it('uses Chinese instructions for Chinese prompts', () => {
        expect(referenceModeInstruction('PRODUCT', 'zh')).toContain('保留商品外形');
        expect(referenceModeInstruction('PRODUCT', 'zh')).not.toContain('Preserve the product');
    });

    it('uses English instructions for English prompts', () => {
        expect(referenceModeInstruction('PRODUCT', 'en')).toContain('Preserve the product shape');
    });
});

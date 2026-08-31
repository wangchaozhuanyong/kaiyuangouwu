import { describe, expect, it, vi } from 'vitest';

import { ImageProviderRouterService, selectSmoothWeightedCredential } from './image-provider-router.service';

describe('ImageProviderRouterService', () => {
    it('selects the exact healthy prompt Key configured by the unified route', async () => {
        const credential = {
            id: 7,
            code: 'gemini-primary',
            enabled: true,
            healthStatus: 'HEALTHY',
            purpose: 'PROMPT',
            lastUsedAt: null,
        };
        const queryBuilder = {
            where: vi.fn(),
            andWhere: vi.fn(),
            getOne: vi.fn().mockResolvedValue(credential),
        };
        for (const method of ['where', 'andWhere'] as const) {
            queryBuilder[method].mockReturnValue(queryBuilder);
        }
        const repository = {
            createQueryBuilder: vi.fn(() => queryBuilder),
            save: vi.fn().mockResolvedValue(credential),
        };
        const connection = {
            rawConnection: { options: { type: 'sqljs' } },
            withTransaction: vi.fn((_ctx, work) => work({})),
            getRepository: vi.fn(() => repository),
        };
        const service = new ImageProviderRouterService(connection as any);

        const route = await service.selectByCode({} as any, 'gemini-primary');

        expect(route.credential).toBe(credential);
        expect(route.selectionReason).toContain('gemini-primary');
        expect(queryBuilder.where).toHaveBeenCalledWith('credential.code = :code', {
            code: 'gemini-primary',
        });
        expect(credential.lastUsedAt).toBeInstanceOf(Date);
    });

    it('does not expire a healthy credential based on its last test timestamp', async () => {
        const queryBuilder = {
            where: vi.fn(),
            andWhere: vi.fn(),
            getCount: vi.fn().mockResolvedValue(1),
        };
        for (const method of ['where', 'andWhere'] as const) {
            queryBuilder[method].mockReturnValue(queryBuilder);
        }
        const connection = {
            getRepository: vi.fn(() => ({
                createQueryBuilder: vi.fn(() => queryBuilder),
            })),
        };
        const service = new ImageProviderRouterService(connection as any);

        await expect(service.hasAvailable({} as any, { scope: 'OPENAI', purpose: 'PROMPT' })).resolves.toBe(
            true,
        );

        expect(queryBuilder.andWhere).toHaveBeenCalledWith('credential.healthStatus = :health', {
            health: 'HEALTHY',
        });
        expect(queryBuilder.andWhere).toHaveBeenCalledWith("credential.textModelId <> ''");
        expect(queryBuilder.andWhere.mock.calls.flat().join(' ')).not.toContain('lastTestedAt');
        expect(queryBuilder.andWhere.mock.calls.flat().join(' ')).not.toContain('freshAfter');
    });

    it('exposes the concrete models used by healthy prompt credentials', async () => {
        const queryBuilder = {
            where: vi.fn(),
            andWhere: vi.fn(),
            orderBy: vi.fn(),
            addOrderBy: vi.fn(),
            getMany: vi
                .fn()
                .mockResolvedValue([
                    { textModelId: 'gpt-5.4-mini' },
                    { textModelId: 'gpt-5.4-mini' },
                    { textModelId: ' models/gemini-2.5-flash ' },
                ]),
        };
        for (const method of ['where', 'andWhere', 'orderBy', 'addOrderBy'] as const) {
            queryBuilder[method].mockReturnValue(queryBuilder);
        }
        const connection = {
            getRepository: vi.fn(() => ({
                createQueryBuilder: vi.fn(() => queryBuilder),
            })),
        };
        const service = new ImageProviderRouterService(connection as any);

        await expect(service.availablePromptModelIds({} as any, 'OPENAI')).resolves.toEqual([
            'gpt-5.4-mini',
            'models/gemini-2.5-flash',
        ]);

        expect(queryBuilder.andWhere).toHaveBeenCalledWith('credential.purpose IN (:...purposes)', {
            purposes: ['PROMPT', 'BOTH'],
        });
    });
});

describe('image provider smooth weighted routing', () => {
    it('distributes same-priority keys by weight without starving backups', () => {
        const keys = [
            { id: 1, weight: 3, currentWeight: 0 },
            { id: 2, weight: 1, currentWeight: 0 },
        ];
        const selected = Array.from({ length: 8 }, () => selectSmoothWeightedCredential(keys).selected.id);
        expect(selected.filter(id => id === 1)).toHaveLength(6);
        expect(selected.filter(id => id === 2)).toHaveLength(2);
    });

    it('normalizes invalid legacy zero weights to one', () => {
        const keys = [
            { id: 1, weight: 0, currentWeight: 0 },
            { id: 2, weight: 1, currentWeight: 0 },
        ];
        const selected = Array.from({ length: 4 }, () => selectSmoothWeightedCredential(keys).selected.id);
        expect(new Set(selected)).toEqual(new Set([1, 2]));
    });
});

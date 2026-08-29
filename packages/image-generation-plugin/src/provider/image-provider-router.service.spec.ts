import { describe, expect, it, vi } from 'vitest';

import { ImageProviderRouterService, selectSmoothWeightedCredential } from './image-provider-router.service';

describe('ImageProviderRouterService', () => {
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
        expect(queryBuilder.andWhere.mock.calls.flat().join(' ')).not.toContain('lastTestedAt');
        expect(queryBuilder.andWhere.mock.calls.flat().join(' ')).not.toContain('freshAfter');
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

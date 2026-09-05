import type { RequestContext } from '@vendure/core';
import { describe, expect, it, vi } from 'vitest';

import { CatalogImportService } from './catalog-import.service';
import { CatalogImportJob } from './entities/catalog-import-job.entity';
import { CatalogImportRow } from './entities/catalog-import-row.entity';

describe('catalog import row pagination', () => {
    it('scopes rows through the current-channel job and clamps unsafe page arguments', async () => {
        const findAndCount = vi.fn().mockResolvedValue([[{ id: 'row-1' }], 701]);
        const getRepository = vi.fn((_ctx: RequestContext, entity: unknown) => {
            if (entity === CatalogImportJob) {
                return {
                    findOne: vi.fn().mockResolvedValue({ id: 'job-1', channelId: 'channel-1' }),
                };
            }
            if (entity === CatalogImportRow)
                return {
                    findAndCount,
                    createQueryBuilder: () => ({
                        select: () => ({
                            addSelect: () => ({
                                where: () => ({
                                    groupBy: () => ({ getRawMany: vi.fn().mockResolvedValue([]) }),
                                }),
                            }),
                        }),
                    }),
                };
            throw new Error('Unexpected repository');
        });
        const service = createService(getRepository);

        await expect(
            service.findRowPage({ channelId: 'channel-1' } as RequestContext, 'job-1', 'WARNING', -8, 900),
        ).resolves.toEqual({ items: [{ id: 'row-1' }], totalItems: 701 });
        expect(findAndCount).toHaveBeenCalledWith({
            where: { jobId: 'job-1', action: 'WARNING' },
            order: { rowNumber: 'ASC' },
            skip: 0,
            take: 500,
        });
    });
});

function createService(getRepository: ReturnType<typeof vi.fn>): CatalogImportService {
    return new CatalogImportService(
        { getRepository } as never,
        undefined as never,
        undefined as never,
        undefined as never,
        undefined as never,
        undefined as never,
        undefined as never,
        undefined as never,
        undefined as never,
        undefined as never,
    );
}

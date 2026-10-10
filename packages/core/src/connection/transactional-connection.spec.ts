import 'reflect-metadata';
import { DataSource, EntitySchema } from 'typeorm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { RequestContext } from '../api/common/request-context';
import { TRANSACTION_MANAGER_KEY } from '../common/constants';
import { ConfigService } from '../config/config.service';

import { TransactionWrapper } from './transaction-wrapper';
import { TransactionalConnection } from './transactional-connection';

class LeaseProbe {
    id!: number;
    value!: string;
}

const probe = new EntitySchema<LeaseProbe>({
    name: 'LeaseProbe',
    target: LeaseProbe,
    columns: { id: { type: Number, primary: true }, value: { type: String } },
});

describe('non-replicated primary repository connection ownership', () => {
    let dataSource: DataSource;
    let connection: TransactionalConnection;

    beforeEach(async () => {
        dataSource = await new DataSource({
            type: 'sqljs',
            entities: [probe],
            synchronize: true,
        }).initialize();
        await dataSource.getRepository(probe).save({ id: 1, value: 'original' });
        connection = new TransactionalConnection(dataSource, new TransactionWrapper(), {
            authOptions: { entityAccessControlStrategy: {} },
        } as ConfigService);
    });

    afterEach(async () => {
        vi.restoreAllMocks();
        await dataSource.destroy();
    });

    it.each(['context', 'option', 'without-context'] as const)(
        'releases each successful primary read selected by %s',
        async selection => {
            const ctx = RequestContext.empty();
            if (selection === 'context') ctx.setReplicationMode('master');
            for (let index = 0; index < 24; index++) {
                const repository = connection.getRepository(
                    selection === 'without-context' ? undefined : ctx,
                    probe,
                    selection === 'context' ? undefined : { replicationMode: 'master' },
                );
                expect(await repository.findOneBy({ id: 1 })).toEqual({ id: 1, value: 'original' });
                // A runner pinned to a repository is caller-owned: TypeORM deliberately
                // never releases it after a terminal query. A single primary needs no pin.
                expect(repository.queryRunner).toBeUndefined();
            }
            expect(await dataSource.query('SELECT 1 AS healthy')).toEqual([{ healthy: 1 }]);
        },
    );

    it('leaves query-builder success and failure runners owned by TypeORM', async () => {
        const ctx = RequestContext.empty();
        ctx.setReplicationMode('master');
        const repository = connection.getRepository(ctx, probe);
        const builder = repository.createQueryBuilder('probe');
        expect(await builder.getMany()).toHaveLength(1);
        await expect(builder.where('probe.column_that_does_not_exist = 1').getMany()).rejects.toThrow();
        expect(builder.queryRunner).toBeUndefined();
        expect(await repository.findOneBy({ id: 1 })).not.toBeNull();
    });

    it('preserves writes on the single primary', async () => {
        const ctx = RequestContext.empty();
        ctx.setReplicationMode('master');
        await connection.getRepository(ctx, probe).update(1, { value: 'updated' });
        expect(await dataSource.getRepository(probe).findOneBy({ id: 1 })).toEqual({
            id: 1,
            value: 'updated',
        });
    });

    it('preserves the configured entity access restriction on fresh primary reads', async () => {
        const ctx = RequestContext.empty();
        ctx.setReplicationMode('master');
        const applyAccessControl = vi.fn(builder =>
            builder.andWhere('LeaseProbe.id = :allowed', { allowed: 2 }),
        );
        const restricted = new TransactionalConnection(dataSource, new TransactionWrapper(), {
            authOptions: { entityAccessControlStrategy: { applyAccessControl } },
        } as unknown as ConfigService);
        expect(await restricted.getRepository(ctx, LeaseProbe).find()).toEqual([]);
        expect(applyAccessControl).toHaveBeenCalledOnce();
        expect(await dataSource.getRepository(probe).find()).toHaveLength(1);
    });

    it('retains the existing transaction manager and its caller-owned runner', async () => {
        const ctx = RequestContext.empty();
        ctx.setReplicationMode('master');
        const runner = dataSource.createQueryRunner();
        await runner.startTransaction();
        Object.assign(ctx, { [TRANSACTION_MANAGER_KEY]: runner.manager });
        const repository = connection.getRepository(ctx, probe);
        expect(repository.manager).toBe(runner.manager);
        await repository.update(1, { value: 'uncommitted' });
        expect(runner.isTransactionActive).toBe(true);
        await runner.rollbackTransaction();
        await runner.release();
        expect(await dataSource.getRepository(probe).findOneBy({ id: 1 })).toEqual({
            id: 1,
            value: 'original',
        });
    });

    it.each([true, false])(
        'retains explicit primary routing for a replicated driver, context=%s',
        hasContext => {
            const ctx = RequestContext.empty();
            ctx.setReplicationMode('master');
            dataSource.driver.isReplicated = true;
            const createRunner = vi.spyOn(dataSource, 'createQueryRunner');
            const repository = connection.getRepository(hasContext ? ctx : undefined, probe, {
                replicationMode: 'master',
            });
            expect(createRunner).toHaveBeenCalledWith('master');
            expect(repository.queryRunner).toBeDefined();
            dataSource.driver.isReplicated = false;
        },
    );
});

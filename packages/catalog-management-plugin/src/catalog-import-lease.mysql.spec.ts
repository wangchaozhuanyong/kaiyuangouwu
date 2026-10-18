import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { DataSource, In, Table } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { AddCatalogImportExecutionLease1792195200000 } from '../../dev-server/migrations/1792195200000-add-catalog-import-execution-lease';

import { CatalogImportLease, CatalogImportLeaseLostError } from './catalog-import-lease';
import { createImportLeaseFixture } from './catalog-import-lease.fixture';
import { CatalogImportQueueService } from './catalog-import-queue.service';
import { CatalogImportService } from './catalog-import.service';
import { CatalogImportJob } from './entities/catalog-import-job.entity';
import { CatalogImportRow } from './entities/catalog-import-row.entity';

describe.runIf(process.env.CATALOG_IMPORT_LEASE_MYSQL === '1')(
    'catalog import execution leases on owned MySQL8',
    () => {
        let admin: DataSource;
        let f: Awaited<ReturnType<typeof createImportLeaseFixture>>;
        let database: string;
        let migrationDatabase: string;
        let options: {
            type: 'mysql';
            host: string;
            port: number;
            username: string;
            password: string;
            timezone: string;
        };
        beforeAll(async () => {
            const port = Number(process.env.E2E_MYSQL_PORT);
            const expectedUuid = process.env.E2E_MYSQL_SERVER_UUID ?? '';
            if (
                process.env.CI !== 'true' ||
                !Number.isInteger(port) ||
                port <= 1024 ||
                port > 65535 ||
                !/^[a-f0-9-]{36}$/i.test(expectedUuid)
            )
                throw new Error('Requires explicit owned loopback MySQL8 fixture identity');
            options = {
                type: 'mysql',
                host: '127.0.0.1',
                port,
                username: 'root',
                password: '',
                timezone: 'Z',
            };
            admin = await new DataSource(options).initialize();
            const identity = await admin.query('SELECT @@server_uuid AS serverUuid, VERSION() AS version');
            if (
                String(identity[0].serverUuid).toLowerCase() !== expectedUuid.toLowerCase() ||
                !/^8\./.test(String(identity[0].version))
            )
                throw new Error('Owned MySQL8 identity mismatch');
            database = 'e2e_import_lease_' + randomUUID().replace(/-/g, '');
            migrationDatabase = database + '_migration';
            await admin.query('CREATE DATABASE ?? CHARACTER SET utf8mb4', [database]);
            await admin.query('CREATE DATABASE ?? CHARACTER SET utf8mb4', [migrationDatabase]);
            f = await createImportLeaseFixture({ ...options, database });
            process.stdout.write(
                'OWNED_IMPORT_LEASE_FIXTURE ' +
                    JSON.stringify({
                        database,
                        migrationDatabase,
                        serverUuid: identity[0].serverUuid,
                        mysqlVersion: identity[0].version,
                        production: false,
                        dropDatabase: false,
                    }) +
                    '\n',
            );
        });
        afterAll(async () => {
            await f?.db.destroy();
            await admin?.destroy();
            // Preserve only this run's synthetic schemas for evidence; never stop the shared instance.
        });
        const service = () => {
            const imports = new CatalogImportService(
                f.connection,
                undefined as never,
                { stockLocations: () => Promise.resolve([]) } as never,
                undefined as never,
                undefined as never,
                undefined as never,
                { withDeferredFilters: (_ctx: unknown, work: () => Promise<void>) => work() } as never,
                undefined as never,
                undefined as never,
                { reindex: () => Promise.resolve(undefined) } as never,
                undefined as never,
            );
            vi.spyOn(imports, 'findRows').mockImplementation((_ctx, id) =>
                f.rowRepository.find({ where: { jobId: id }, order: { rowNumber: 'ASC' } }),
            );
            Reflect.set(
                imports,
                'applyRow',
                async (
                    ctx: Parameters<typeof f.connection.getRepository>[0],
                    _job: CatalogImportJob,
                    row: CatalogImportRow,
                ) => {
                    await f.connection
                        .getRepository(ctx, 'ImportLeaseEffect')
                        .insert({ rowId: row.id, amount: 1 });
                    row.appliedAt = new Date();
                    row.targetProductId = 'synthetic-product-' + row.rowNumber;
                    row.targetVariantId = 'synthetic-variant-' + row.rowNumber;
                    row.appliedSnapshot = { synthetic: true };
                    await f.connection.getRepository(ctx, CatalogImportRow).save(row);
                },
            );
            return imports;
        };

        it('replays the additive migration twice, retains legacy rows and blocks destructive rollback', async () => {
            const db = await new DataSource({
                ...options,
                database: migrationDatabase,
                entities: [],
            }).initialize();
            const runner = db.createQueryRunner();
            try {
                await runner.createTable(
                    new Table({
                        name: 'catalog_import_job',
                        columns: [
                            { name: 'id', type: 'int', isPrimary: true },
                            { name: 'state', type: 'varchar', length: '24' },
                            { name: 'progress', type: 'int' },
                            { name: 'version', type: 'int' },
                        ],
                    }),
                );
                await runner.query(
                    "INSERT INTO catalog_import_job VALUES (1,'RUNNING',42,7),(2,'COMPLETED',100,3)",
                );
                const before = await runner.query('SELECT * FROM catalog_import_job ORDER BY id');
                const migration = new AddCatalogImportExecutionLease1792195200000();
                await migration.up(runner);
                await migration.up(runner);
                const table = await runner.getTable('catalog_import_job');
                expect(table?.findColumnByName('executionToken')).toMatchObject({
                    type: 'varchar',
                    length: '36',
                    isNullable: true,
                });
                expect(table?.findColumnByName('leaseUntil')).toMatchObject({
                    type: 'datetime',
                    precision: 6,
                    isNullable: true,
                });
                expect(
                    table?.indices.filter(index => index.name === 'IDX_catalog_import_job_state_lease'),
                ).toHaveLength(1);
                expect(
                    await runner.query(
                        'SELECT id,state,progress,version FROM catalog_import_job ORDER BY id',
                    ),
                ).toEqual(before);
                expect(
                    await runner.query('SELECT executionToken,leaseUntil FROM catalog_import_job'),
                ).toEqual([
                    { executionToken: null, leaseUntil: null },
                    { executionToken: null, leaseUntil: null },
                ]);
                await expect(migration.down()).rejects.toThrow('Retain import execution leases');
                expect(await runner.hasColumn('catalog_import_job', 'executionToken')).toBe(true);
                process.stdout.write(
                    'IMPORT_LEASE_MIGRATION_RECEIPT ' +
                        JSON.stringify({
                            repeatedUp: 2,
                            legacyRowsUnchanged: true,
                            tokenLength: 36,
                            datePrecision: 6,
                            rollbackRejected: true,
                            leaseIndexCount: 1,
                        }) +
                        '\n',
                );
            } finally {
                await runner.release();
                await db.destroy();
            }
        });

        it('recovers more than 100 expired jobs without truncating native microsecond cursors', async () => {
            await f.db.query('ALTER TABLE catalog_import_job MODIFY createdAt datetime(6) NOT NULL');
            // Seed the backlog in one insert so the existing deadline measures
            // recovery, rather than hundreds of unrelated fixture round trips.
            const inserted = await f.jobRepository.insert(
                Array.from({ length: 205 }, () => ({
                    channelId: f.ctx.channelId,
                    actorId: String(f.ctx.activeUserId),
                    version: 1,
                    createdAt: new Date(),
                    updatedAt: new Date(),
                    progress: 0,
                    state: 'RUNNING',
                    executionToken: randomUUID(),
                    leaseUntil: new Date(0),
                })),
            );
            const ids = inserted.identifiers.map(item => item.id as number);
            const saved = (await f.jobRepository.findBy({ id: In(ids) })).sort(
                (a, b) => Number(a.id) - Number(b.id),
            );
            expect(saved).toHaveLength(205);
            // Keep all 205 native datetime(6) values within the same millisecond;
            // truncating a pagination cursor must still lose later records.
            await f.db.query(
                `UPDATE catalog_import_job SET createdAt = CASE id ${saved.map(() => 'WHEN ? THEN ?').join(' ')} END WHERE id IN (${saved.map(() => '?').join(',')})`,
                [
                    ...saved.flatMap((job, i) => [
                        job.id,
                        '2026-10-17 01:02:03.' + String(i + 1).padStart(6, '0'),
                    ]),
                    ...ids,
                ],
            );
            const [precision] = await f.db.query(
                `SELECT COUNT(DISTINCT createdAt) AS distinctValues,
                        DATE_FORMAT(MIN(createdAt), '%f') AS firstMicros,
                        DATE_FORMAT(MAX(createdAt), '%f') AS lastMicros
                 FROM catalog_import_job WHERE id IN (${ids.map(() => '?').join(',')})`,
                ids,
            );
            expect(Number(precision.distinctValues)).toBe(205);
            expect(precision).toMatchObject({ firstMicros: '000001', lastMicros: '000205' });
            const strategy = {
                findOne: vi.fn(),
                findManyById: vi.fn(),
                removeSettledJobs: vi.fn(),
                findMany: vi.fn().mockResolvedValue({ items: [], totalItems: 0 }),
            };
            const queue = new CatalogImportQueueService(
                f.connection,
                { create: () => Promise.resolve(f.ctx) } as never,
                undefined as never,
                undefined as never,
                { isWorker: true } as never,
                { jobQueueOptions: { jobQueueStrategy: strategy } } as never,
            );
            const dispatch = vi.spyOn(queue, 'dispatch').mockResolvedValue(undefined);
            const result = await queue.recoverInterruptedJobs();
            expect(result).toMatchObject({ scanned: 205, recovered: 205, enqueued: 205, failed: 0 });
            expect(new Set(dispatch.mock.calls.map(([id]) => String(id))).size).toBe(205);
            const persisted = new Map(
                (await f.jobRepository.findBy({ id: In(ids) })).map(job => [String(job.id), job]),
            );
            expect(persisted.size).toBe(205);
            for (const job of saved)
                expect(persisted.get(String(job.id))).toMatchObject({
                    state: 'QUEUED',
                    executionToken: null,
                    leaseUntil: null,
                });
        });

        it('allows exactly one concurrent claim and preserves the healthy execution lease', async () => {
            const job = await f.createJob();
            const lease = new CatalogImportLease(f.connection);
            const tokens = await Promise.all([lease.claim(f.ctx, job.id), lease.claim(f.ctx, job.id)]);
            expect(tokens.filter(Boolean)).toHaveLength(1);
            expect(await lease.recoverExpired(f.ctx, job.id)).toBe(false);
            expect((await f.jobRepository.findOneByOrFail({ id: job.id })).executionToken).toBe(
                tokens.find(Boolean),
            );
        });

        it('lets one recovery win and fences every stale write after takeover', async () => {
            const job = await f.createJob();
            const lease = new CatalogImportLease(f.connection);
            const old = await lease.claim(f.ctx, job.id);
            if (!old) throw new Error('Expected the original execution lease');
            await f.jobRepository.update(job.id, { leaseUntil: new Date(0) });
            const recovered = await Promise.all([
                lease.recoverExpired(f.ctx, job.id),
                lease.recoverExpired(f.ctx, job.id),
            ]);
            expect(recovered.filter(Boolean)).toHaveLength(1);
            const current = await lease.claim(f.ctx, job.id);
            for (const patch of [
                { progress: 99 },
                { state: 'FAILED' as const },
                { state: 'COMPLETED' as const },
            ]) {
                await expect(
                    lease.owned(f.ctx, job.id, old, async ctx => {
                        await f.connection.getRepository(ctx, CatalogImportJob).update(job.id, patch);
                    }),
                ).rejects.toBeInstanceOf(CatalogImportLeaseLostError);
            }
            await expect(
                lease.owned(f.ctx, job.id, old, () => Promise.resolve(undefined)),
            ).rejects.toBeInstanceOf(CatalogImportLeaseLostError);
            expect(await f.jobRepository.findOneByOrFail({ id: job.id })).toMatchObject({
                state: 'RUNNING',
                executionToken: current,
                progress: 0,
            });
        });

        it('keeps recovery behind a healthy long row transaction and rechecks the renewed lease', async () => {
            const job = await f.createJob();
            const lease = new CatalogImportLease(f.connection);
            const token = await lease.claim(f.ctx, job.id);
            if (!token) throw new Error('Expected the long-row execution lease');
            await f.jobRepository.update(job.id, {
                leaseUntil: new Date((await lease.databaseNow(f.ctx)).getTime() + 1500),
            });
            let entered!: () => void;
            const ready = new Promise<void>(resolve => {
                entered = resolve;
            });
            const executing = lease.owned(f.ctx, job.id, token, async () => {
                entered();
                await new Promise(resolve => setTimeout(resolve, 2300));
            });
            await ready;
            await new Promise(resolve => setTimeout(resolve, 1700));
            const recovering = lease.recoverExpired(f.ctx, job.id);
            await executing;
            expect(await recovering).toBe(false);
            expect((await f.jobRepository.findOneByOrFail({ id: job.id })).executionToken).toBe(token);
        });

        it('commits row effects and progress together, and rolls failed row effects back', async () => {
            const job = await f.createJob();
            const first = await f.createRow(job.id, 1);
            const second = await f.createRow(job.id, 2);
            const imports = service();
            const writer = Reflect.get(imports, 'applyRow');
            Reflect.set(imports, 'applyRow', async (...args: unknown[]) => {
                await writer(...args);
                if ((args[2] as CatalogImportRow).rowNumber === 1) throw new Error('synthetic row rollback');
            });
            const observed: number[] = [];
            const snapshots: Array<{
                progress: number;
                persisted: number;
                firstEffects: number;
                secondEffects: number;
                firstAction: string;
                firstApplied: Date | null;
            }> = [];
            await imports.executeJob(f.ctx, job.id, async value => {
                observed.push(value);
                if (value === 50 || value === 100) {
                    const firstRow = await f.rowRepository.findOneByOrFail({ id: first.id });
                    snapshots.push({
                        progress: value,
                        persisted: (await f.jobRepository.findOneByOrFail({ id: job.id })).progress,
                        firstEffects: await f.db
                            .getRepository('ImportLeaseEffect')
                            .countBy({ rowId: first.id }),
                        secondEffects: await f.db
                            .getRepository('ImportLeaseEffect')
                            .countBy({ rowId: second.id }),
                        firstAction: firstRow.action,
                        firstApplied: firstRow.appliedAt,
                    });
                }
            });
            expect(observed).toEqual([0, 50, 100]);
            // Assertions live outside the best-effort notification callback.
            expect(snapshots).toEqual([
                {
                    progress: 50,
                    persisted: 50,
                    firstEffects: 0,
                    secondEffects: 0,
                    firstAction: 'ERROR',
                    firstApplied: null,
                },
                {
                    progress: 100,
                    persisted: 100,
                    firstEffects: 0,
                    secondEffects: 1,
                    firstAction: 'ERROR',
                    firstApplied: null,
                },
            ]);
            expect(await f.jobRepository.findOneByOrFail({ id: job.id })).toMatchObject({
                state: 'COMPLETED_WITH_ERRORS',
                progress: 100,
                executionToken: null,
                leaseUntil: null,
            });
        });

        it.each(['before-commit', 'after-commit'])(
            'resumes once after killing only an isolated executor %s',
            async phase => {
                const job = await f.createJob();
                const row = await f.createRow(job.id, 1);
                await f.createRow(job.id, 2);
                const lease = new CatalogImportLease(f.connection);
                const token = await lease.claim(f.ctx, job.id);
                if (!token) throw new Error('Expected the isolated executor lease');
                const program = [
                    "const mysql = require('mysql2/promise');",
                    "let input=''; process.stdin.on('data',chunk=>input+=chunk);",
                    "process.stdin.on('end', async()=>{try{",
                    "const x=JSON.parse(input); if(!/^e2e_import_lease_[a-f0-9]+$/.test(x.database)) throw Error('Not a synthetic schema');",
                    "const c=await mysql.createConnection({host:'127.0.0.1',port:x.port,user:'root',password:'',database:x.database,timezone:'Z'});",
                    "const [identity]=await c.query('SELECT @@server_uuid AS uuid'); if(identity[0].uuid!==x.uuid) throw Error('Wrong fixture identity');",
                    'await c.beginTransaction();',
                    "const [jobs]=await c.query('SELECT id FROM catalog_import_job WHERE id=? AND state=? " +
                        "AND executionToken=? AND leaseUntil>CURRENT_TIMESTAMP(6) FOR UPDATE',[x.job,'RUNNING',x.token]);",
                    "if(jobs.length!==1) throw Error('Lease not owned');",
                    "await c.query('INSERT INTO import_lease_effect(rowId,amount) VALUES (?,1)',[x.row]);",
                    "await c.query('UPDATE catalog_import_row SET appliedAt=CURRENT_TIMESTAMP(6),appliedSnapshot=?," +
                        "targetProductId=?,targetVariantId=? WHERE id=? AND jobId=?'," +
                        "[JSON.stringify({synthetic:true}),'synthetic-product-1','synthetic-variant-1',x.row,x.job]);",
                    "await c.query('UPDATE catalog_import_job SET progress=50 WHERE id=? AND executionToken=?',[x.job,x.token]);",
                    "if(x.phase==='after-commit') await c.commit();",
                    "process.stdout.write('OWNED_IMPORT_EXECUTOR_READY\\n'); setInterval(()=>{},1000);",
                    '}catch(error){console.error(error);process.exit(1)}});',
                ].join('\n');
                const child = spawn(process.execPath, ['-e', program], {
                    cwd: process.cwd(),
                    stdio: ['pipe', 'pipe', 'pipe'],
                });
                let failure = '';
                child.stderr.on('data', chunk => {
                    failure += chunk.toString();
                });
                child.stdin.end(
                    JSON.stringify({
                        database,
                        port: options.port,
                        uuid: process.env.E2E_MYSQL_SERVER_UUID,
                        job: job.id,
                        row: row.id,
                        token,
                        phase,
                    }),
                );
                try {
                    await new Promise<void>((resolve, reject) => {
                        const timeout = setTimeout(
                            () => reject(new Error('Executor readiness timeout: ' + failure)),
                            10000,
                        );
                        child.stdout.on('data', chunk => {
                            if (chunk.toString().includes('OWNED_IMPORT_EXECUTOR_READY')) {
                                clearTimeout(timeout);
                                resolve();
                            }
                        });
                        child.once('exit', () => {
                            clearTimeout(timeout);
                            reject(new Error('Executor exited: ' + failure));
                        });
                    });
                    const exited = once(child, 'exit');
                    child.kill('SIGKILL');
                    const [, signal] = await exited;
                    expect(signal).toBe('SIGKILL');
                    expect((await f.jobRepository.findOneByOrFail({ id: job.id })).progress).toBe(
                        phase === 'after-commit' ? 50 : 0,
                    );
                    expect(await f.db.getRepository('ImportLeaseEffect').countBy({ rowId: row.id })).toBe(
                        phase === 'after-commit' ? 1 : 0,
                    );
                    // Advance only this synthetic job's lease, rather than sleeping two minutes.
                    // Real elapsed expiry and row locking are exercised by the long-row case.
                    await f.jobRepository.update(job.id, { leaseUntil: new Date(0) });
                    expect(await lease.recoverExpired(f.ctx, job.id)).toBe(true);
                    await service().executeJob(f.ctx, job.id, () => undefined);
                    const savedRows = await f.rowRepository.findBy({ jobId: job.id });
                    for (const saved of savedRows) {
                        expect(saved.appliedAt).toBeTruthy();
                        expect(
                            await f.db.getRepository('ImportLeaseEffect').countBy({ rowId: saved.id }),
                        ).toBe(1);
                    }
                    expect(await f.jobRepository.findOneByOrFail({ id: job.id })).toMatchObject({
                        state: 'COMPLETED',
                        progress: 100,
                        executionToken: null,
                        leaseUntil: null,
                    });
                } finally {
                    if (child.exitCode == null && child.signalCode == null) child.kill('SIGKILL');
                }
            },
            30000,
        );
    },
);

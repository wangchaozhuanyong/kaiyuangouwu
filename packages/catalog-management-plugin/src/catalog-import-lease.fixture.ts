import { Channel, RequestContext, TransactionalConnection } from '@vendure/core';
import {
    DataSource,
    DataSourceOptions,
    EntityManager,
    EntitySchema,
    EntityTarget,
    ObjectLiteral,
} from 'typeorm';

import { CatalogImportJob } from './entities/catalog-import-job.entity';
import { CatalogImportRow } from './entities/catalog-import-row.entity';

const channels = new EntitySchema<Channel>({
    name: 'Channel',
    target: Channel,
    tableName: 'channel',
    columns: { id: { type: Number, primary: true }, code: { type: String } },
});
const jobs = new EntitySchema<CatalogImportJob>({
    name: 'CatalogImportJob',
    target: CatalogImportJob,
    tableName: 'catalog_import_job',
    columns: {
        id: { type: Number, primary: true, generated: true },
        createdAt: { type: Date },
        updatedAt: { type: Date },
        version: { type: Number, version: true },
        channelId: { type: Number },
        actorId: { type: String, nullable: true },
        state: { type: String, length: 24 },
        executionToken: { type: String, length: 36, nullable: true },
        leaseUntil: { type: Date, nullable: true },
        startedAt: { type: Date, nullable: true },
        completedAt: { type: Date, nullable: true },
        errorMessage: { type: String, nullable: true },
        progress: { type: Number, default: 0 },
        totalRows: { type: Number, default: 0 },
        createdCount: { type: Number, default: 0 },
        updatedCount: { type: Number, default: 0 },
        skippedCount: { type: Number, default: 0 },
        conflictCount: { type: Number, default: 0 },
        warningCount: { type: Number, default: 0 },
        errorCount: { type: Number, default: 0 },
    },
    relations: { channel: { type: 'many-to-one', target: 'Channel', joinColumn: { name: 'channelId' } } },
});
const rows = new EntitySchema<CatalogImportRow>({
    name: 'CatalogImportRow',
    target: CatalogImportRow,
    tableName: 'catalog_import_row',
    columns: {
        id: { type: Number, primary: true, generated: true },
        jobId: { type: Number },
        rowNumber: { type: Number },
        action: { type: String },
        productKey: { type: String },
        sourceKey: { type: String },
        normalizedData: { type: 'simple-json' },
        appliedAt: { type: Date, nullable: true },
        appliedSnapshot: { type: 'simple-json', nullable: true },
        targetProductId: { type: String, nullable: true },
        targetVariantId: { type: String, nullable: true },
        message: { type: String, nullable: true },
    },
});
const effects = new EntitySchema({
    name: 'ImportLeaseEffect',
    tableName: 'import_lease_effect',
    columns: { rowId: { type: Number, primary: true }, amount: { type: Number } },
});
type TestContext = RequestContext & { leaseTestManager?: EntityManager };

export async function createImportLeaseFixture(options: DataSourceOptions = { type: 'sqljs' }) {
    const jobSchema =
        options.type === 'mysql'
            ? new EntitySchema<CatalogImportJob>({
                  ...jobs.options,
                  columns: {
                      ...jobs.options.columns,
                      leaseUntil: { type: Date, nullable: true, precision: 6 },
                  },
              })
            : jobs;
    const db = await new DataSource({
        ...options,
        entities: [channels, jobSchema, rows, effects],
        synchronize: true,
    }).initialize();
    await db.getRepository(Channel).save({ id: 1, code: 'synthetic-import-store' });
    const ctx = {
        channelId: 1,
        activeUserId: 'synthetic-actor',
        userHasPermissions: () => true,
    } as unknown as RequestContext;
    const connection = {
        rawConnection: db,
        getRepository<T extends ObjectLiteral>(context: TestContext, target: EntityTarget<T>) {
            return (context.leaseTestManager ?? db.manager).getRepository(target);
        },
        withTransaction<T>(context: TestContext, work: (ctx: RequestContext) => Promise<T>) {
            if (context.leaseTestManager) return work(context);
            return db.transaction(manager => work({ ...context, leaseTestManager: manager } as TestContext));
        },
    } as unknown as TransactionalConnection;
    const jobRepository = db.getRepository(CatalogImportJob);
    const rowRepository = db.getRepository(CatalogImportRow);
    const createJob = (patch: Partial<CatalogImportJob> = {}) =>
        jobRepository.save(
            jobRepository.create({
                channelId: 1,
                actorId: 'synthetic-actor',
                state: 'QUEUED',
                version: 1,
                createdAt: new Date(),
                updatedAt: new Date(),
                progress: 0,
                ...patch,
            }),
        );
    const createRow = (jobId: number | string, rowNumber = 1) =>
        rowRepository.save(
            rowRepository.create({
                jobId,
                rowNumber,
                action: 'CREATE',
                productKey: 'product-' + rowNumber,
                sourceKey: 'source-' + rowNumber,
                normalizedData: { sku: 'sku-' + rowNumber } as never,
            }),
        );
    return { db, ctx, connection, jobRepository, rowRepository, createJob, createRow };
}

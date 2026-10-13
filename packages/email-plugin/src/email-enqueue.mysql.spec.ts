import { Test, TestingModule } from '@nestjs/testing';
import { JobState } from '@vendure/common/lib/generated-types';
import {
    Channel,
    ConfigService,
    EventBus,
    Injector,
    JobQueueService,
    LanguageCode,
    ListQueryBuilder,
    ModuleRef,
    ProcessContext,
    RequestContext,
    TransactionalConnection,
    TransactionSubscriber,
    VendureEvent,
} from '@vendure/core';
import { createConnection, type Connection, type RowDataPacket } from 'mysql2/promise';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { DataSource, EntitySchema } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { EMAIL_PLUGIN_OPTIONS } from './constants';
import { EmailProcessor } from './email-processor';
import { EmailEventListener } from './event-listener';
import { EmailPlugin } from './plugin';
import { FileBasedTemplateLoader } from './template-loader/file-based-template-loader';
import { InitializedEmailPluginOptions, IntermediateEmailDetails } from './types';

// Core is emitted as CommonJS. Read its internal classes from that same module context
// so TypeORM entity identity and Nest injection tokens match the public Core exports.
const requireCore = createRequire(__filename);
const { ensureConfigLoaded } = requireCore(
    '@vendure/core/dist/config/config-helpers',
) as typeof import('@vendure/core/dist/config/config-helpers');
const { TransactionWrapper } = requireCore(
    '@vendure/core/dist/connection/transaction-wrapper',
) as typeof import('@vendure/core/dist/connection/transaction-wrapper');
const { setEntityIdStrategy } = requireCore(
    '@vendure/core/dist/entity/set-entity-id-strategy',
) as typeof import('@vendure/core/dist/entity/set-entity-id-strategy');
const { JobBufferService } = requireCore(
    '@vendure/core/dist/job-queue/job-buffer/job-buffer.service',
) as typeof import('@vendure/core/dist/job-queue/job-buffer/job-buffer.service');
const { JobRecord } = requireCore(
    '@vendure/core/dist/plugin/default-job-queue-plugin/job-record.entity',
) as typeof import('@vendure/core/dist/plugin/default-job-queue-plugin/job-record.entity');
const { SqlJobQueueStrategy } = requireCore(
    '@vendure/core/dist/plugin/default-job-queue-plugin/sql-job-queue-strategy',
) as typeof import('@vendure/core/dist/plugin/default-job-queue-plugin/sql-job-queue-strategy');

interface BusinessMarker {
    id: string;
    value: string;
}
const markerSchema = new EntitySchema<BusinessMarker>({
    name: 'EmailEnqueueBusinessMarker',
    tableName: 'email_enqueue_business_marker',
    columns: {
        id: { type: String, length: 64, primary: true },
        value: { type: String, length: 64 },
    },
});
class EmailIntentEvent extends VendureEvent {
    constructor(
        readonly ctx: RequestContext,
        readonly caseId: string,
    ) {
        super();
    }
}

// This suite never reads production credentials or selects a production schema.
// Normal package runs skip it; the explicit DB=mysql runner must provide an isolated port.
describe.skipIf(process.env.DB !== 'mysql')('durable email enqueue on isolated MySQL', () => {
    const database = 'prelaunch_email_20261013';
    let source: DataSource;
    let observer: Connection;
    let connection: TransactionalConnection;
    let eventBus: EventBus;
    let strategy: InstanceType<typeof SqlJobQueueStrategy>;
    let queues: JobQueueService;
    let module: TestingModule;
    const processor = {
        init: vi.fn(() => Promise.resolve()),
        process: vi.fn((_data: IntermediateEmailDetails) => Promise.resolve(true)),
    };
    const context = new RequestContext({
        channel: new Channel({ id: 1, code: 'isolated-email-fixture' }),
        languageCode: LanguageCode.en,
        apiType: 'shop',
        isAuthorized: true,
        authorizedAsOwnerOnly: false,
    });

    beforeAll(async () => {
        const port = Number(process.env.E2E_MYSQL_PORT);
        if (!Number.isInteger(port) || port < 1024 || port > 65535 || port === 3306) {
            throw new Error('The email MySQL regression requires an explicitly isolated E2E_MYSQL_PORT');
        }
        observer = await createConnection({ host: '127.0.0.1', port, user: 'root', password: '' });
        await observer.query(`CREATE DATABASE IF NOT EXISTS ${database} CHARACTER SET utf8mb4`);
        await observer.changeUser({ database });
        await ensureConfigLoaded();
        const config = new ConfigService();
        setEntityIdStrategy(config.entityIdStrategy, [JobRecord]);
        source = new DataSource({
            type: 'mysql',
            host: '127.0.0.1',
            port,
            username: 'root',
            password: '',
            database,
            entities: [JobRecord, markerSchema],
            synchronize: true,
            timezone: 'Z',
        });
        await source.initialize();
        connection = new TransactionalConnection(source, new TransactionWrapper(), config);
        eventBus = new EventBus(new TransactionSubscriber(source));
        strategy = new SqlJobQueueStrategy({ pollInterval: 20, backoffStrategy: () => 200 });
        config.jobQueueOptions.jobQueueStrategy = strategy;
        queues = new JobQueueService(config, new JobBufferService(config));
        const handler = new EmailEventListener('mysql-intent-fixture')
            .on(EmailIntentEvent)
            .setRecipient(() => 'fixture@example.invalid')
            .setFrom('fixture@example.invalid')
            .setSubject('Synthetic transactional email')
            .setTemplateVars(event => ({ caseId: event.caseId }))
            .setMetadata(event => ({ caseId: event.caseId }));
        const options: InitializedEmailPluginOptions = {
            transport: { type: 'none' },
            handlers: [handler],
            templateLoader: new FileBasedTemplateLoader('unused-by-fake-email-processor'),
        };
        module = await Test.createTestingModule({
            providers: [
                EmailPlugin,
                { provide: EMAIL_PLUGIN_OPTIONS, useValue: options },
                { provide: ConfigService, useValue: config },
                { provide: TransactionalConnection, useValue: connection },
                { provide: ListQueryBuilder, useValue: new ListQueryBuilder(connection, config) },
                { provide: EventBus, useValue: eventBus },
                { provide: JobQueueService, useValue: queues },
                { provide: EmailProcessor, useValue: processor },
                ProcessContext,
            ],
        }).compile();
        strategy.init(new Injector(module.get(ModuleRef)));
        await module.get(EmailPlugin).onApplicationBootstrap();
    });

    afterAll(async () => {
        await queues?.onModuleDestroy();
        await module?.close();
        strategy?.destroy();
        eventBus?.onModuleDestroy();
        if (source?.isInitialized) await source.destroy();
        await observer?.end();
        // Keep this owned fixture database and its evidence; never drop a schema or container here.
    });

    async function intentRecords(caseId: string) {
        return source
            .getRepository(JobRecord)
            .createQueryBuilder('job')
            .where("JSON_UNQUOTE(JSON_EXTRACT(job.data, '$.metadata.caseId')) = :caseId", { caseId })
            .getMany();
    }
    async function counts(caseId: string) {
        const [jobs] = await observer.query<RowDataPacket[]>(
            "SELECT COUNT(*) AS count FROM job_record WHERE JSON_UNQUOTE(JSON_EXTRACT(data, '$.metadata.caseId')) = ?",
            [caseId],
        );
        const [markers] = await observer.query<RowDataPacket[]>(
            'SELECT COUNT(*) AS count FROM email_enqueue_business_marker WHERE id = ?',
            [caseId],
        );
        return { jobs: Number(jobs[0].count), markers: Number(markers[0].count) };
    }
    async function writeBusinessAndIntent(caseId: string) {
        return connection.withTransaction(context, async ctx => {
            await connection.getRepository(ctx, markerSchema).save({ id: caseId, value: 'committed' });
            await eventBus.publish(new EmailIntentEvent(ctx, caseId));
        });
    }

    it('commits a business change and one durable email intent together, without processing mail', async () => {
        const caseId = randomUUID();
        await writeBusinessAndIntent(caseId);
        expect(await counts(caseId)).toEqual({ jobs: 1, markers: 1 });
        const [record] = await intentRecords(caseId);
        expect(record.queueName).toBe('send-email');
        expect(record.state).toBe(JobState.PENDING);
        expect(record.retries).toBe(5);
        expect(processor.process).not.toHaveBeenCalled();
    });

    it('does not expose an uncommitted intent or business marker to a second independent connection', async () => {
        const caseId = randomUUID();
        await connection.withTransaction(context, async ctx => {
            await connection.getRepository(ctx, markerSchema).save({ id: caseId, value: 'uncommitted' });
            await eventBus.publish(new EmailIntentEvent(ctx, caseId));
            expect(
                await connection
                    .getRepository(ctx, JobRecord)
                    .createQueryBuilder('job')
                    .where("JSON_UNQUOTE(JSON_EXTRACT(job.data, '$.metadata.caseId')) = :caseId", { caseId })
                    .getCount(),
            ).toBe(1);
            expect(await counts(caseId)).toEqual({ jobs: 0, markers: 0 });
        });
        expect(await counts(caseId)).toEqual({ jobs: 1, markers: 1 });
    });

    it('rolls back an already persisted email intent with its business transaction', async () => {
        const caseId = randomUUID();
        await expect(
            connection.withTransaction(context, async ctx => {
                await connection.getRepository(ctx, markerSchema).save({ id: caseId, value: 'rollback' });
                await eventBus.publish(new EmailIntentEvent(ctx, caseId));
                throw new Error('SYNTHETIC_BUSINESS_ROLLBACK');
            }),
        ).rejects.toThrow('SYNTHETIC_BUSINESS_ROLLBACK');
        expect(await counts(caseId)).toEqual({ jobs: 0, markers: 0 });
    });

    it('rolls back the business change on the first SQL enqueue failure and retries with exactly one intent', async () => {
        const caseId = randomUUID();
        const trigger = `email_enqueue_failure_${caseId.replace(/-/gu, '').slice(0, 16)}`;
        await observer.query(`CREATE TRIGGER ${trigger} BEFORE INSERT ON job_record FOR EACH ROW
            SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'SYNTHETIC_EMAIL_ENQUEUE_FAILURE'`);
        try {
            await expect(writeBusinessAndIntent(caseId)).rejects.toThrow('SYNTHETIC_EMAIL_ENQUEUE_FAILURE');
            expect(await counts(caseId)).toEqual({ jobs: 0, markers: 0 });
        } finally {
            await observer.query(`DROP TRIGGER ${trigger}`);
        }
        await writeBusinessAndIntent(caseId);
        expect(await counts(caseId)).toEqual({ jobs: 1, markers: 1 });
    });

    it('keeps a worker failure queryable through RETRYING and FAILED after all five retries', async () => {
        const caseId = randomUUID();
        processor.process.mockImplementation(data => {
            if (data.metadata?.caseId === caseId)
                return Promise.reject(new Error('SYNTHETIC_WORKER_FAILURE_NO_SMTP'));
            return Promise.resolve(true);
        });
        await writeBusinessAndIntent(caseId);
        const [record] = await intentRecords(caseId);
        await queues.start();
        await vi.waitFor(
            async () => {
                const job = await strategy.findOne(record.id);
                expect(job?.state).toBe(JobState.RETRYING);
                expect(job?.error).toBe('SYNTHETIC_WORKER_FAILURE_NO_SMTP');
            },
            { interval: 10, timeout: 10_000 },
        );
        await vi.waitFor(
            async () => {
                const job = await strategy.findOne(record.id);
                expect(job?.state).toBe(JobState.FAILED);
                expect(job?.attempts).toBe(6);
                expect(job?.retries).toBe(5);
                expect(job?.isSettled).toBe(true);
            },
            { interval: 20, timeout: 10_000 },
        );
        expect(
            processor.process.mock.calls.filter(([data]) => data.metadata?.caseId === caseId),
        ).toHaveLength(6);
        expect(await counts(caseId)).toEqual({ jobs: 1, markers: 1 });
    });
});

import { Channel, type RequestContext, type TransactionalConnection } from '@vendure/core';
import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { readFile, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Duplex } from 'node:stream';
import { promisify } from 'node:util';
import 'reflect-metadata';
import { DataSource, EntitySchema } from 'typeorm';
import { describe, expect, it, vi } from 'vitest';

import { AddStorefrontSeo1791580800000 } from '../../../dev-server/migrations/1791580800000-add-storefront-seo';

import { defaultStorefrontSeoSettings, storefrontSeoSettingsIdentity } from './storefront-seo.contract';
import { StorefrontSeoRecord, StorefrontSeoRevision } from './storefront-seo.entity';
import { StorefrontSeoService } from './storefront-seo.service';

// This suite only accepts a new, owned, zero-port Docker lab made by seo-mysql-readiness.mjs.
describe('SEO MySQL 8.4 migration readiness', () => {
    it.runIf(Boolean(process.env.SEO_MYSQL_LAB_FILE))(
        'runs migration and SQL publication checks against the disposable owned instance',
        async () => {
            const filename = process.env.SEO_MYSQL_LAB_FILE;
            if (!filename) throw new Error('Owned MySQL lab descriptor required');
            const descriptor = JSON.parse(await readFile(filename, 'utf8'));
            const project = await realpath(path.resolve(process.cwd(), '../..'));
            assert.equal(descriptor.purpose, 'vendure-seo-mysql-readiness-v1');
            assert.match(descriptor.runId, /^[a-f0-9]{16}$/u);
            assert.equal(descriptor.project, project);
            assert.equal(
                descriptor.directory,
                path.join(project, 'tmp/seo-geo-readiness', `mysql-${descriptor.runId}`),
            );
            assert.equal(await realpath(filename), path.join(descriptor.directory, 'lab.json'));
            assert.equal(descriptor.database, `seo_readiness_${descriptor.runId}`);
            assert.match(descriptor.containerId, /^[a-f0-9]{64}$/u);
            assert.ok(descriptor.endpoint.startsWith('unix:///'));
            const exec = promisify(execFile);
            const { stdout } = await exec('docker', [
                '--host',
                descriptor.endpoint,
                'inspect',
                descriptor.containerId,
            ]);
            const [container] = JSON.parse(stdout);
            assert.equal(container.Image, descriptor.image);
            assert.equal(container.Config.Labels['codex.vendure.seo'], descriptor.runId);
            assert.equal(container.Config.Labels['codex.vendure.seo.purpose'], descriptor.purpose);
            assert.equal(container.HostConfig.NetworkMode, 'none');
            assert.deepEqual(container.HostConfig.PortBindings, {});
            assert.equal(container.Mounts.length, 1);
            assert.equal(container.Mounts[0].Source, descriptor.datadir);
            assert.equal(container.Mounts[0].Destination, '/var/lib/mysql');
            assert.equal(container.HostConfig.Privileged, false);
            const relays: Array<ReturnType<typeof spawn>> = [];
            const stream = () => {
                const relay = spawn(
                    'docker',
                    [
                        '--host',
                        descriptor.endpoint,
                        'exec',
                        '-i',
                        descriptor.containerId,
                        'bash',
                        '-c',
                        'exec 3<>/dev/tcp/127.0.0.1/3306 || exit 1; cat <&3 & reader=$!; cat >&3; kill "$reader" 2>/dev/null; wait',
                    ],
                    { stdio: ['pipe', 'pipe', 'ignore'] },
                );
                relays.push(relay);
                const duplex = Duplex.from({ readable: relay.stdout, writable: relay.stdin });
                relay.once('error', error => duplex.destroy(error));
                duplex.once('close', () => relay.kill());
                return duplex;
            };
            const base = {
                id: { type: Number, primary: true, generated: true },
                createdAt: { type: Date, createDate: true },
                updatedAt: { type: Date, updateDate: true },
                channelId: { type: Number },
            } as const;
            const source = new DataSource({
                type: 'mysql',
                username: 'root',
                password: '',
                database: descriptor.database,
                charset: 'utf8mb4',
                synchronize: false,
                extra: { stream, connectionLimit: 3 },
                entities: [
                    new EntitySchema({
                        name: 'Channel',
                        target: Channel,
                        columns: { id: { type: Number, primary: true } },
                    }),
                    new EntitySchema({
                        name: 'StorefrontSeoRecord',
                        tableName: 'storefront_seo_record',
                        target: StorefrontSeoRecord,
                        columns: {
                            ...base,
                            targetType: { type: String },
                            targetId: { type: String },
                            languageCode: { type: String },
                            draftJson: { type: 'text' },
                            publishedJson: { type: 'text', nullable: true },
                            version: { type: Number },
                            publishedVersion: { type: Number },
                            publishedAt: { type: Date, nullable: true },
                            publishedByUserId: { type: String, nullable: true },
                        },
                    }),
                    new EntitySchema({
                        name: 'StorefrontSeoRevision',
                        tableName: 'storefront_seo_revision',
                        target: StorefrontSeoRevision,
                        columns: {
                            ...base,
                            recordId: { type: Number },
                            version: { type: Number },
                            payloadJson: { type: 'text', nullable: true },
                            publishedAt: { type: Date },
                            publishedBy: { type: String },
                        },
                    }),
                ],
            });
            try {
                await source.initialize();
                const [server] = await source.query(
                    'SELECT VERSION() AS version, @@sql_mode AS sqlMode, @@character_set_database AS charset',
                );
                expect(server.version).toMatch(/^8\.4\./u);
                expect(server.charset).toBe('utf8mb4');
                expect(server.sqlMode).toContain('STRICT_TRANS_TABLES');
                await source.query('CREATE TABLE channel (id int PRIMARY KEY) ENGINE=InnoDB');
                await source.query('INSERT INTO channel (id) VALUES (1), (2), (3)');
                const runner = source.createQueryRunner();
                const migration = new AddStorefrontSeo1791580800000();
                await migration.up(runner);
                await migration.up(runner);
                const record = await runner.getTable('storefront_seo_record');
                const revision = await runner.getTable('storefront_seo_revision');
                expect(
                    record?.indices.find(index => index.name === 'UQ_storefront_seo_identity')?.isUnique,
                ).toBe(true);
                expect(record?.foreignKeys.map(key => [key.referencedTableName, key.onDelete])).toEqual([
                    ['channel', 'CASCADE'],
                ]);
                expect(
                    revision?.indices.find(index => index.name === 'UQ_storefront_seo_revision')?.isUnique,
                ).toBe(true);
                expect(
                    revision?.indices.some(index => index.name === 'IDX_storefront_seo_revision_channel'),
                ).toBe(true);
                expect(revision?.foreignKeys.map(key => key.referencedTableName).sort()).toEqual([
                    'channel',
                    'storefront_seo_record',
                ]);
                const context = (id = 1) =>
                    ({
                        channelId: id,
                        channel: {
                            id,
                            code: `fixture-store-${id}`,
                            availableLanguageCodes: ['zh_Hans', 'en'],
                        },
                        apiType: 'admin',
                        activeUserId: 'fixture-admin',
                        userHasPermissions: () => true,
                    }) as unknown as RequestContext;
                const connection = {
                    getRepository: (_ctx: RequestContext, target: typeof StorefrontSeoRecord) =>
                        source.getRepository(target),
                    withTransaction: (ctx: RequestContext, work: (ctx: RequestContext) => Promise<unknown>) =>
                        source.transaction(async manager => {
                            const scoped = Object.create(ctx) as RequestContext & {
                                fixtureManager?: typeof manager;
                            };
                            scoped.fixtureManager = manager;
                            return work(scoped);
                        }),
                } as unknown as TransactionalConnection;
                // Use the same transaction owner for all repositories touched by save/publish.
                connection.getRepository = ((
                    ctx: RequestContext & { fixtureManager?: typeof source.manager },
                    target: typeof StorefrontSeoRecord,
                ) =>
                    (ctx.fixtureManager ?? source.manager).getRepository(
                        target,
                    )) as typeof connection.getRepository;
                const service = new StorefrontSeoService(
                    connection,
                    { getAccessMode: vi.fn().mockResolvedValue('LIVE') } as never,
                    { publish: vi.fn() } as never,
                );
                const save = (draft: unknown, expectedVersion: number, ctx = context()) =>
                    service.saveDraft(ctx, { ...storefrontSeoSettingsIdentity, expectedVersion, draft });
                const settings = {
                    ...defaultStorefrontSeoSettings(),
                    defaultDescriptions: { zh_Hans: '中文商店 🛒', en: 'Synthetic shop' },
                };
                await save(settings, 0);
                await save(settings, 0, context(2));
                expect(await service.publishedConfiguration(context())).toBeNull();
                await service.publish(context(), { ...storefrontSeoSettingsIdentity, expectedVersion: 1 });
                expect(
                    (await service.publishedConfiguration(context()))?.payload.defaultDescriptions.zh_Hans,
                ).toBe('中文商店 🛒');
                expect(await service.publishedConfiguration(context(2))).toBeNull();
                const writes = await Promise.allSettled([
                    save({ ...settings, indexingEnabled: true }, 2),
                    save({ ...settings, indexingEnabled: false }, 2),
                ]);
                expect(writes.filter(result => result.status === 'fulfilled')).toHaveLength(1);
                expect(writes.filter(result => result.status === 'rejected')).toHaveLength(1);
                const conflict = writes.find(result => result.status === 'rejected') as PromiseRejectedResult;
                expect(conflict.reason.message).toContain('SEO_VERSION_CONFLICT');
                expect((await service.getRecord(context(), storefrontSeoSettingsIdentity)).version).toBe(3);
                expect((await service.publishedConfiguration(context()))?.payload.indexingEnabled).toBe(
                    false,
                );
                const article = {
                    targetType: 'ARTICLE',
                    targetId: 'synthetic-guide',
                    languageCode: 'zh_Hans',
                } as const;
                const payload = {
                    title: '隔离文章 🛒',
                    description: '测试内容',
                    article: {
                        body: '文'.repeat(19_000),
                        summary: '合成测试',
                        authorName: 'Fixture',
                        reviewerName: 'Fixture reviewer',
                        reviewedAt: '2026-10-10',
                        sources: [
                            {
                                label: 'Fixture source',
                                url: 'https://fixture.invalid/manual',
                                accessedAt: '2026-10-10',
                            },
                        ],
                    },
                };
                const savedArticle = await service.saveDraft(context(), {
                    ...article,
                    draft: payload,
                    expectedVersion: 0,
                });
                expect(
                    new TextEncoder().encode(JSON.stringify(savedArticle.draft)).byteLength,
                ).toBeGreaterThan(57_000);
                await service.publish(context(), { ...article, expectedVersion: 1 });
                expect((await service.publishedRecord(context(), article))?.payload.article?.body).toBe(
                    payload.article.body,
                );
                expect((await service.history(context(), article))[0].payload).toEqual(
                    (await service.publishedRecord(context(), article))?.payload,
                );
                await expect(
                    service.saveDraft(context(), {
                        ...article,
                        draft: { article: { body: '文'.repeat(21_000) } },
                        expectedVersion: 2,
                    }),
                ).rejects.toThrow('60 KB');
                await expect(
                    source.query(
                        'INSERT INTO storefront_seo_record (channelId,targetType,targetId,languageCode,draftJson) VALUES (999,?,?,?,?)',
                        ['HOME', 'home', 'en', '{}'],
                    ),
                ).rejects.toThrow();
                await expect(
                    source.query(
                        'INSERT INTO storefront_seo_record (channelId,targetType,targetId,languageCode,draftJson) VALUES (1,?,?,?,?)',
                        ['SETTINGS', 'store', 'und', '{}'],
                    ),
                ).rejects.toThrow();
                await source.query(
                    'INSERT INTO storefront_seo_record (channelId,targetType,targetId,languageCode,draftJson) VALUES (3,?,?,?,?)',
                    ['HOME', 'home', 'en', '{}'],
                );
                const [{ id: fixtureRecordId }] = await source.query(
                    'SELECT id FROM storefront_seo_record WHERE channelId=3',
                );
                await source.query(
                    'INSERT INTO storefront_seo_revision (channelId,recordId,version,payloadJson,publishedAt,publishedBy) VALUES (3,?,1,?,NOW(6),?)',
                    [fixtureRecordId, '{}', 'fixture'],
                );
                await source.query('DELETE FROM channel WHERE id=3');
                expect(await source.query('SELECT id FROM storefront_seo_record WHERE channelId=3')).toEqual(
                    [],
                );
                expect(
                    await source.query('SELECT id FROM storefront_seo_revision WHERE channelId=3'),
                ).toEqual([]);
                const before = await source.query(
                    'SELECT channelId,targetType,targetId,publishedJson FROM storefront_seo_record ORDER BY id',
                );
                await migration.up(runner);
                await expect(migration.down()).rejects.toThrow('retained');
                expect(
                    await source.query(
                        'SELECT channelId,targetType,targetId,publishedJson FROM storefront_seo_record ORDER BY id',
                    ),
                ).toEqual(before);
                await writeFile(
                    path.join(descriptor.directory, 'verification.json'),
                    `${JSON.stringify(
                        {
                            passed: true,
                            checkedAt: new Date().toISOString(),
                            server,
                            publishedArticleUtf8Bytes: new TextEncoder().encode(
                                JSON.stringify(savedArticle.draft),
                            ).byteLength,
                            scenarios: [
                                'additive migration',
                                'repeat up with data retained',
                                'unique identities and revisions',
                                'channel and record foreign keys',
                                'channel deletion cascade',
                                'draft and published separation',
                                'cross-store published isolation',
                                'Unicode and emoji roundtrip',
                                'near-limit article and history roundtrip',
                                'UTF-8 storage-limit rejection',
                                'one winning SQL CAS write and SEO_VERSION_CONFLICT loser',
                                'non-destructive down refusal',
                            ],
                            schema: [record, revision].map(table => ({
                                name: table?.name,
                                indices: table?.indices.map(index => ({
                                    name: index.name,
                                    unique: index.isUnique,
                                    columns: index.columnNames,
                                })),
                                foreignKeys: table?.foreignKeys.map(key => ({
                                    name: key.name,
                                    table: key.referencedTableName,
                                    onDelete: key.onDelete,
                                })),
                            })),
                        },
                        null,
                        2,
                    )}\n`,
                    { mode: 0o600 },
                );
                await runner.release();
            } finally {
                if (source.isInitialized) await source.destroy();
                for (const relay of relays) relay.kill();
            }
        },
        60_000,
    );
});

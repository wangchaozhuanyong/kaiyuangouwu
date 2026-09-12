import { mergeConfig, RequestContext, TransactionalConnection } from '@vendure/core';
import { createTestEnvironment } from '@vendure/testing';
import gql from 'graphql-tag';
import { ImapFlow } from 'imapflow';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { initialData } from '../../../e2e-common/e2e-initial-data';
import { TEST_SETUP_TIMEOUT_MS, testConfig } from '../../../e2e-common/test-config';
import {
    BatchCreateIcloudVirtualEmailsDocument,
    CreateIcloudPrimaryAccountDocument,
    CreateIcloudVirtualEmailDocument,
    IcloudVirtualEmailsDocument,
    UpdateIcloudPrimaryAccountDocument,
    UpdateIcloudVirtualEmailDocument,
} from '../src/client/admin.generated';
import { IcloudPrimaryAccount } from '../src/entities/icloud-primary-account.entity';
import { IcloudVirtualEmail } from '../src/entities/icloud-virtual-email.entity';
import { IcloudRelayPlugin } from '../src/icloud-relay.plugin';
import { IcloudJobService } from '../src/jobs/icloud-job.service';
import { IcloudAdminService } from '../src/services/icloud-admin.service';
import { IcloudImapSyncService } from '../src/services/icloud-imap-sync.service';
import { IcloudPublicQueryService } from '../src/services/icloud-public-query.service';
import { updateIcloudRecord } from '../src/services/icloud-record-update';
import { IcloudAccountStatus } from '../src/types';

// Regression: run the same documents as both admin UIs through HTTP, GraphQL and SQL.js.
describe('iCloud admin contract persistence', () => {
    const { server, adminClient } = createTestEnvironment(
        mergeConfig(testConfig(), {
            apiOptions: { port: 33551 },
            plugins: [IcloudRelayPlugin.init({ syncIntervalSeconds: 0 })],
        }),
    );
    let account: Awaited<ReturnType<typeof createAccount>>;
    const disableJobs = vi
        .spyOn(IcloudJobService.prototype, 'onModuleInit')
        .mockImplementation(() => undefined);
    async function createAccount() {
        return (
            await adminClient.query(CreateIcloudPrimaryAccountDocument, {
                input: {
                    email: 'contract-fixture@icloud.com',
                    appPassword: 'isolated-test-password',
                    note: '主邮箱原备注',
                    codeResetIntervalDays: 30,
                },
            })
        ).createIcloudPrimaryAccount;
    }
    beforeAll(async () => {
        await server.init({ initialData });
        await adminClient.asSuperAdmin();
        account = await createAccount();
    }, TEST_SETUP_TIMEOUT_MS);
    afterAll(async () => {
        await server.destroy();
        disableJobs.mockRestore();
    });

    it('saves and clears virtual notes without changing the address, code, owner or expiry', async () => {
        const created = (
            await adminClient.query(CreateIcloudVirtualEmailDocument, {
                input: {
                    primaryAccountId: account.id,
                    aliasEmail: 'virtual-fixture@icloud.com',
                    note: '旧备注',
                },
            })
        ).createIcloudVirtualEmail;
        for (const note of ['主号1-虚拟1号', '']) {
            const updated = (
                await adminClient.query(UpdateIcloudVirtualEmailDocument, {
                    input: { id: created.id, note },
                })
            ).updateIcloudVirtualEmail;
            expect(updated).toMatchObject({
                id: created.id,
                note,
                aliasEmail: created.aliasEmail,
                primaryAccountId: created.primaryAccountId,
                buyerQueryCode: created.buyerQueryCode,
                codeExpiresAt: created.codeExpiresAt,
            });
            const rows = (
                await adminClient.query(IcloudVirtualEmailsDocument, {
                    primaryAccountId: account.id,
                })
            ).icloudVirtualEmails;
            expect(rows.find(row => row.id === created.id)?.note).toBe(note);
        }
    });

    it('preserves the stored credential and code expiry on a primary note-only update', async () => {
        const repository = server.app
            .get(TransactionalConnection)
            .rawConnection.getRepository(IcloudPrimaryAccount);
        const before = await repository.findOneByOrFail({ email: account.email });
        const updated = (
            await adminClient.query(UpdateIcloudPrimaryAccountDocument, {
                input: { id: account.id, note: '' },
            })
        ).updateIcloudPrimaryAccount;
        expect(updated.note).toBe('');
        expect(updated.codeExpiresAt).toBe(account.codeExpiresAt);
        const after = await repository.findOneByOrFail({ email: account.email });
        expect(after.encryptedAppPassword === before.encryptedAppPassword).toBe(true);
    });

    it('parses spaces, commas and tabs once on the server and reports invalid/duplicate rows', async () => {
        const rawInput =
            'space@icloud.com 主号1 备注\ncomma@icloud.com,主号2,备注\ntab@icloud.com\t主号3\ninvalid-row\nspace@icloud.com 重复';
        const result = (
            await adminClient.query(BatchCreateIcloudVirtualEmailsDocument, {
                input: { primaryAccountId: account.id, rawInput },
            })
        ).batchCreateIcloudVirtualEmails;
        expect(result).toMatchObject({ createdCount: 3, skippedCount: 2 });
        expect(result.errors).toHaveLength(2);
        const rows = (await adminClient.query(IcloudVirtualEmailsDocument, {})).icloudVirtualEmails;
        expect(rows.find(row => row.aliasEmail === 'space@icloud.com')?.note).toBe('主号1 备注');
        expect(rows.find(row => row.aliasEmail === 'comma@icloud.com')?.note).toBe('主号2,备注');
        expect(rows.find(row => row.aliasEmail === 'tab@icloud.com')?.note).toBe('主号3');
        expect(
            (
                await adminClient.query(BatchCreateIcloudVirtualEmailsDocument, {
                    input: { primaryAccountId: account.id, rawInput },
                })
            ).batchCreateIcloudVirtualEmails,
        ).toMatchObject({ createdCount: 0, skippedCount: 5 });
    });

    it('rejects the old incompatible operation before changing any record', async () => {
        const before = await adminClient.query(IcloudVirtualEmailsDocument, {});
        await expect(
            adminClient.query(
                gql`
                    mutation ($id: ID!, $input: UpdateIcloudVirtualEmailInput!) {
                        updateIcloudVirtualEmail(id: $id, input: $input) {
                            id
                        }
                    }
                `,
                { id: before.icloudVirtualEmails[0].id, input: { note: '未保存' } },
            ),
        ).rejects.toThrow('Unknown argument');
        expect(await adminClient.query(IcloudVirtualEmailsDocument, {})).toEqual(before);
    });
    it('preserves a concurrent code reset during a note-only save', async () => {
        const connection = server.app.get(TransactionalConnection);
        const service = server.app.get(IcloudAdminService);
        const ctx = RequestContext.empty();
        const primary = await connection
            .getRepository(ctx, IcloudPrimaryAccount)
            .findOneByOrFail({ email: account.email });
        const created = await service.createVirtualEmail(ctx, {
            primaryAccountId: primary.id,
            aliasEmail: 'interleaved-audit@icloud.com',
        });
        const repo = connection.getRepository(ctx, IcloudVirtualEmail);
        const read = repo.findOne.bind(repo);
        let markRead!: () => void;
        let resume!: () => void;
        const readFinished = new Promise<void>(resolve => {
            markRead = resolve;
        });
        const waiting = new Promise<void>(resolve => {
            resume = resolve;
        });
        const spy = vi.spyOn(repo, 'findOne').mockImplementationOnce(async options => {
            const stale = await read(options);
            markRead();
            await waiting;
            return stale;
        });
        try {
            const saving = service.updateVirtualEmail(ctx, { id: created.id, note: '仅修改备注' });
            await readFinished;
            const rotated = await service.resetVirtualEmailCode(ctx, created.id);
            expect(rotated.buyerQueryCode === created.buyerQueryCode).toBe(false);
            resume();
            await saving;
            const after = await read({ where: { id: created.id } });
            expect(after?.note).toBe('仅修改备注');
            expect(after?.buyerQueryCode === created.buyerQueryCode).toBe(false);
            expect(after?.buyerQueryCode === rotated.buyerQueryCode).toBe(true);
        } finally {
            resume();
            spy.mockRestore();
        }
    });

    it('rejects malformed single addresses and skips malformed batch rows', async () => {
        for (const aliasEmail of ['invalid-address', '@', 'a@@icloud.com', 'a@', 'a b@icloud.com']) {
            await expect(
                adminClient.query(CreateIcloudVirtualEmailDocument, {
                    input: { primaryAccountId: account.id, aliasEmail },
                }),
            ).rejects.toThrow('邮箱');
        }
        const result = (
            await adminClient.query(BatchCreateIcloudVirtualEmailsDocument, {
                input: { primaryAccountId: account.id, rawInput: '@' },
            })
        ).batchCreateIcloudVirtualEmails;
        expect(result).toMatchObject({ createdCount: 0, skippedCount: 1 });
    });
    it('does not extend expiry for unchanged cycles, and preserves zero as never rotate', async () => {
        const updated = (
            await adminClient.query(UpdateIcloudPrimaryAccountDocument, {
                input: { id: account.id, codeResetIntervalDays: 30, note: '周期保持不变' },
            })
        ).updateIcloudPrimaryAccount;
        expect(updated.codeExpiresAt).toBe(account.codeExpiresAt);
        const zero = (
            await adminClient.query(UpdateIcloudPrimaryAccountDocument, {
                input: { id: account.id, codeResetIntervalDays: 0 },
            })
        ).updateIcloudPrimaryAccount;
        expect(zero.codeExpiresAt).toBeNull();
        for (const codeResetIntervalDays of [-1, 36501]) {
            await expect(
                adminClient.query(UpdateIcloudPrimaryAccountDocument, {
                    input: { id: account.id, codeResetIntervalDays },
                }),
            ).rejects.toThrow('重置周期');
        }
    });

    it('rejects invalid update fields and leaves the database unchanged', async () => {
        const created = (
            await adminClient.query(CreateIcloudVirtualEmailDocument, {
                input: { primaryAccountId: account.id, aliasEmail: 'validation-update@icloud.com' },
            })
        ).createIcloudVirtualEmail;
        for (const patch of [
            { aliasEmail: '@' },
            { status: null },
            { buyerQueryCode: 'x'.repeat(65) },
            { codeResetIntervalDays: null },
            { note: '汉'.repeat(22000) },
        ]) {
            await expect(
                adminClient.query(UpdateIcloudVirtualEmailDocument, {
                    input: { id: created.id, ...patch },
                }),
            ).rejects.toThrow();
        }
        const rows = (await adminClient.query(IcloudVirtualEmailsDocument, {})).icloudVirtualEmails;
        expect(rows.find(row => row.id === created.id)).toEqual(created);
    });

    it.skipIf(process.env.DB !== 'mysql')(
        'serializes competing transactions and rejects a stale overlapping patch in MySQL',
        async () => {
            const db = server.app.get(TransactionalConnection).rawConnection;
            const repo = db.getRepository(IcloudPrimaryAccount);
            const original = await repo.findOneByOrFail({ email: account.email });
            const first = db.createQueryRunner();
            const second = db.createQueryRunner();
            await first.startTransaction('REPEATABLE READ');
            await second.startTransaction('REPEATABLE READ');
            let pending: Promise<unknown> | undefined;
            try {
                const stale = await second.manager
                    .getRepository(IcloudPrimaryAccount)
                    .findOneByOrFail({ id: original.id });
                await updateIcloudRecord(first.manager.getRepository(IcloudPrimaryAccount), original, {
                    note: '并发事务 A',
                });
                pending = updateIcloudRecord(second.manager.getRepository(IcloudPrimaryAccount), stale, {
                    note: '并发事务 B',
                }).then(
                    () => 'unexpected success',
                    error => error.message,
                );
                // Assert an actual InnoDB row-lock wait before releasing transaction A.
                await vi.waitFor(
                    async () => {
                        const locks = await db.query(
                            'SELECT COUNT(*) AS count FROM performance_schema.data_lock_waits',
                        );
                        expect(Number(locks[0].count)).toBeGreaterThan(0);
                    },
                    { timeout: 5000 },
                );
                await first.commitTransaction();
                expect(await pending).toContain('邮箱记录已发生变化');
                await second.rollbackTransaction();
                expect((await repo.findOneByOrFail({ id: original.id })).note).toBe('并发事务 A');
            } finally {
                if (first.isTransactionActive) await first.rollbackTransaction();
                if (pending) await pending;
                if (second.isTransactionActive) await second.rollbackTransaction();
                await first.release();
                await second.release();
            }
        },
    );

    it('public query tracking cannot restore a concurrently reset buyer code', async () => {
        const connection = server.app.get(TransactionalConnection);
        const ctx = RequestContext.empty();
        const admin = server.app.get(IcloudAdminService);
        const owner = await connection
            .getRepository(ctx, IcloudPrimaryAccount)
            .findOneByOrFail({ email: account.email });
        const created = await admin.createVirtualEmail(ctx, {
            primaryAccountId: owner.id,
            aliasEmail: 'public-tracking@icloud.com',
        });
        const repo = connection.getRepository(ctx, IcloudVirtualEmail);
        const read = repo.findOne.bind(repo);
        const spy = vi.spyOn(repo, 'findOne').mockImplementationOnce(async options => {
            const stale = await read(options);
            await admin.resetVirtualEmailCode(ctx, created.id);
            return stale;
        });
        try {
            await server.app
                .get(IcloudPublicQueryService)
                .queryByCode(ctx, created.buyerQueryCode, '127.0.0.1');
            const after = await read({ where: { id: created.id } });
            expect(after?.buyerQueryCode).not.toBe(created.buyerQueryCode);
            expect(after?.lastQueriedAt).toBeTruthy();
        } finally {
            spy.mockRestore();
        }
    });

    it('automatic rotation skips a code changed after its candidate scan', async () => {
        const connection = server.app.get(TransactionalConnection);
        const ctx = RequestContext.empty();
        const admin = server.app.get(IcloudAdminService);
        const owner = await connection
            .getRepository(ctx, IcloudPrimaryAccount)
            .findOneByOrFail({ email: account.email });
        const created = await admin.createVirtualEmail(ctx, {
            primaryAccountId: owner.id,
            aliasEmail: 'auto-rotation@icloud.com',
            codeResetIntervalDays: 30,
        });
        const repo = connection.getRepository(ctx, IcloudVirtualEmail);
        await repo.update({ id: created.id }, { codeExpiresAt: new Date('2026-01-01T00:00:00Z') });
        const find = repo.find.bind(repo);
        let manualCode = '';
        const spy = vi.spyOn(repo, 'find').mockImplementationOnce(async options => {
            const stale = await find(options);
            manualCode = (await admin.resetVirtualEmailCode(ctx, created.id)).buyerQueryCode;
            await admin.updateVirtualEmail(ctx, { id: created.id, note: '换码期间修改备注' });
            return stale;
        });
        try {
            const jobs: { runCodeRotation(): Promise<void> } = server.app.get(IcloudJobService);
            await jobs.runCodeRotation();
            const after = await repo.findOneByOrFail({ id: created.id });
            expect(after.buyerQueryCode).toBe(manualCode);
            expect(after.note).toBe('换码期间修改备注');
        } finally {
            spy.mockRestore();
        }
    });

    it.each([false, true])(
        'sync metadata preserves a concurrent note, credential, code and disabled status (failure=%s)',
        async failure => {
            const connection = server.app.get(TransactionalConnection);
            const ctx = RequestContext.empty();
            const admin = server.app.get(IcloudAdminService);
            const repo = connection.getRepository(ctx, IcloudPrimaryAccount);
            const created = await admin.createPrimaryAccount(ctx, {
                email: `sync-${failure}@icloud.com`,
                appPassword: 'isolated-test-password',
            });
            const stale = await repo.findOneByOrFail({ id: created.id });
            const connect = vi.spyOn(ImapFlow.prototype, 'connect').mockImplementation(async () => {
                await admin.updatePrimaryAccount(ctx, {
                    id: created.id,
                    note: '同步期间编辑',
                    appPassword: 'new-isolated-test-password',
                    status: IcloudAccountStatus.DISABLED,
                });
                await admin.resetMasterCode(ctx, created.id);
                if (failure) throw new Error('simulated IMAP failure');
            });
            const lock = vi
                .spyOn(ImapFlow.prototype, 'getMailboxLock')
                .mockResolvedValue({ path: 'INBOX', release: vi.fn() });
            const fetch = vi.spyOn(ImapFlow.prototype, 'fetch').mockImplementation(async function* () {
                await Promise.resolve();
                return;
            });
            const logout = vi.spyOn(ImapFlow.prototype, 'logout').mockResolvedValue(undefined);
            try {
                const result = await server.app.get(IcloudImapSyncService).syncAccount(ctx, stale);
                expect(result.success).toBe(!failure);
                const after = await repo.findOneByOrFail({ id: created.id });
                expect(after.note).toBe('同步期间编辑');
                expect(after.status).toBe(IcloudAccountStatus.DISABLED);
                expect(after.masterQueryCode).not.toBe(stale.masterQueryCode);
                expect(after.encryptedAppPassword === stale.encryptedAppPassword).toBe(false);
            } finally {
                connect.mockRestore();
                lock.mockRestore();
                fetch.mockRestore();
                logout.mockRestore();
            }
        },
    );
});

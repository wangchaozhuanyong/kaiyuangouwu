import { describe, expect, it, vi } from 'vitest';

import { IcloudPrimaryAccount } from '../entities/icloud-primary-account.entity';
import { IcloudReceivedMail } from '../entities/icloud-received-mail.entity';
import { IcloudAccountStatus } from '../types';

import { IcloudImapSyncService } from './icloud-imap-sync.service';

function fixture() {
    const current = new IcloudPrimaryAccount({
        id: '1',
        status: IcloudAccountStatus.ACTIVE,
        encryptedAppPassword: 'fixture',
        email: 'owner@example.test',
        lastSyncedUid: 19,
        lastSyncedUidValidity: '1',
    });
    const inserted: unknown[] = [];
    const saves: unknown[] = [];
    const events = { record: vi.fn().mockResolvedValue(undefined), kick: vi.fn() };
    const primary = {
        findOne: () => Promise.resolve(current),
        update: vi.fn((_where, data) => {
            Object.assign(current, data);
            return Promise.resolve({ affected: 1 });
        }),
    };
    let txNumber = 0;
    const connection = {
        rawConnection: { options: { type: 'mysql' } },
        getRepository: (ctx: unknown, entity: unknown) =>
            entity === IcloudPrimaryAccount
                ? primary
                : entity === IcloudReceivedMail
                  ? {
                        findOne: () => Promise.resolve(inserted[0] ?? null),
                        save: (mail: unknown) => {
                            saves.push(ctx);
                            inserted.push(mail);
                            return Promise.resolve(mail);
                        },
                    }
                  : { find: () => Promise.resolve([]) },
        withTransaction: async (_ctx: unknown, work: (ctx: object) => unknown) => {
            const count = inserted.length;
            try {
                return await work({ txNumber: ++txNumber });
            } catch (error) {
                inserted.splice(count);
                throw error;
            }
        },
    };
    const service = new IcloudImapSyncService(
        connection as never,
        { decrypt: () => 'fixture' } as never,
        { extractCode: () => '123456' } as never,
        { sanitize: (text: string) => text },
        events as never,
    );
    const source = Buffer.from(
        'Message-ID: <fixture-mail@example.test>\r\nFrom: sender@example.test\r\n' +
            'To: owner@example.test\r\nSubject: Verification code\r\n\r\nYour verification code is 123456',
    );
    const client = {
        mailbox: { uidValidity: BigInt(2) },
        getMailboxLock: () => Promise.resolve({ release: vi.fn() }),
        fetch: vi.fn(async function* () {
            yield await Promise.resolve({ uid: 2, source });
        }),
        connect: vi.fn(),
        logout: vi.fn(),
    };
    return {
        service,
        current,
        account: new IcloudPrimaryAccount({ ...current }),
        events,
        inserted,
        saves,
        client,
    };
}
describe('IMAP event persistence', () => {
    it('UIDVALIDITY reset fetches new small UIDs, writes mail and event in one transaction, and reuses the socket', async () => {
        const f = fixture();
        expect(await f.service.syncAccount({} as never, f.account, f.client as never)).toMatchObject({
            success: true,
            syncedCount: 1,
        });
        expect(f.client.fetch.mock.calls[0]).toContain('1:*');
        expect(f.events.record).toHaveBeenCalledWith(f.saves[0], '1', null);
        expect(f.events.kick).toHaveBeenCalledTimes(1);
        expect(f.client.connect).not.toHaveBeenCalled();
        expect(f.client.logout).not.toHaveBeenCalled();
        expect(f.current.lastSyncedUid).toBe(2);
        expect(f.current.lastSyncedUidValidity).toBe('2');
    });
    it('an event insertion failure rolls back the mail and cannot skip the UID', async () => {
        const f = fixture();
        f.events.record.mockRejectedValueOnce(new Error('synthetic transaction failure'));
        expect(await f.service.syncAccount({} as never, f.account, f.client as never)).toMatchObject({
            success: false,
        });
        expect(f.inserted).toHaveLength(0);
        expect(f.events.kick).not.toHaveBeenCalled();
        expect(f.current.lastSyncedUid).toBe(0);
        expect(await f.service.syncAccount({} as never, f.account, f.client as never)).toMatchObject({
            success: true,
            syncedCount: 1,
        });
    });
});

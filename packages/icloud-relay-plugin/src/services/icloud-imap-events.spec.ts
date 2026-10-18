import { ImapFlow } from 'imapflow';
import { createServer, type AddressInfo, type Socket } from 'node:net';
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
                        findOne: (options: { where: { messageId: string } }) =>
                            Promise.resolve(
                                inserted.find(
                                    mail =>
                                        (mail as IcloudReceivedMail).messageId === options.where.messageId,
                                ) ?? null,
                            ),
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
    it.each([false, true])(
        'streams real IMAP with backpressure (rollback first transaction: %s)',
        async rollback => {
            const f = fixture();
            const sockets = new Set<Socket>();
            const commands: string[] = [];
            const server = createServer(socket => {
                sockets.add(socket);
                socket.on('close', () => sockets.delete(socket));
                socket.write('* OK [CAPABILITY IMAP4rev1 AUTH=PLAIN SASL-IR] Synthetic local fixture\r\n');
                let input = '';
                socket.on('data', chunk => {
                    input += chunk.toString();
                    while (input.includes('\r\n')) {
                        const offset = input.indexOf('\r\n');
                        const line = input.slice(0, offset);
                        input = input.slice(offset + 2);
                        const [tag, command] = line.split(' ');
                        commands.push(command.toUpperCase()); // Never retain authentication arguments.
                        if (command.toUpperCase() === 'CAPABILITY') {
                            socket.write('* CAPABILITY IMAP4rev1 AUTH=PLAIN SASL-IR\r\n');
                        } else if (command.toUpperCase() === 'LIST') {
                            socket.write('* LIST (\\HasNoChildren) "/" "INBOX"\r\n');
                        } else if (
                            command.toUpperCase() === 'SELECT' ||
                            command.toUpperCase() === 'EXAMINE'
                        ) {
                            socket.write(
                                '* FLAGS (\\Seen)\r\n* 2 EXISTS\r\n* OK [UIDVALIDITY 123]\r\n* OK [UIDNEXT 3]\r\n',
                            );
                        } else if (/^\S+ UID FETCH /i.test(line)) {
                            for (const uid of [1, 2]) {
                                const source = Buffer.from(
                                    `Message-ID: <wire-${uid}@example.test>\r\nFrom: sender@example.test\r\n` +
                                        `To: owner@example.test\r\nSubject: Synthetic wire message ${uid}\r\n\r\nBody ${uid}`,
                                );
                                socket.write(`* ${uid} FETCH (UID ${uid} BODY[] {${source.length}}\r\n`);
                                socket.write(source);
                                socket.write(')\r\n');
                            }
                        } else if (command.toUpperCase() === 'LOGOUT') {
                            socket.write(`* BYE Local fixture complete\r\n${tag} OK LOGOUT complete\r\n`);
                            continue;
                        }
                        socket.write(`${tag} OK ${command} complete\r\n`);
                    }
                });
            });
            await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
            const client = new ImapFlow({
                host: '127.0.0.1',
                port: (server.address() as AddressInfo).port,
                secure: false,
                doSTARTTLS: false,
                disableAutoIdle: true,
                auth: { user: 'synthetic@example.test', pass: 'synthetic-local-fixture-only' },
                logger: false,
                connectionTimeout: 2_000,
                socketTimeout: 3_000,
            });
            const committedBeforeNext: number[] = [];
            const fetch = client.fetch.bind(client);
            vi.spyOn(client, 'fetch').mockImplementation(async function* (range, query, options) {
                for await (const message of fetch(range, query, options)) {
                    yield message;
                    committedBeforeNext.push(f.inserted.length);
                }
            });
            try {
                await client.connect();
                if (rollback) {
                    f.events.record.mockRejectedValueOnce(new Error('synthetic wire transaction failure'));
                    expect(await f.service.syncAccount({} as never, f.account, client)).toMatchObject({
                        success: false,
                        syncedCount: 0,
                    });
                    expect(f.current.lastSyncedUid).toBe(0);
                    expect(f.inserted).toHaveLength(0);
                }
                expect(await f.service.syncAccount({} as never, f.account, client)).toMatchObject({
                    success: true,
                    syncedCount: 2,
                });
                expect(committedBeforeNext).toEqual([1, 2]);
                expect(f.current.lastSyncedUid).toBe(2);
                expect(f.events.record).toHaveBeenCalledTimes(rollback ? 3 : 2);
                expect(commands.filter(command => command === 'UID')).toHaveLength(rollback ? 2 : 1);
            } finally {
                await client.logout().catch(() => undefined);
                for (const socket of sockets) socket.destroy();
                await new Promise<void>(resolve => server.close(() => resolve()));
            }
        },
    );
    it('commits each message before pulling the next source instead of retaining the mailbox backlog', async () => {
        const f = fixture();
        const originalFetch = f.client.fetch.getMockImplementation();
        if (!originalFetch) throw new Error('Expected the synthetic fetch implementation');
        f.client.fetch.mockImplementation(async function* () {
            for await (const message of originalFetch()) {
                yield message;
                expect(f.inserted).toHaveLength(1);
                expect(f.events.record).toHaveBeenCalledTimes(1);
            }
        });
        expect(await f.service.syncAccount({} as never, f.account, f.client as never)).toMatchObject({
            success: true,
            syncedCount: 1,
        });
    });
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

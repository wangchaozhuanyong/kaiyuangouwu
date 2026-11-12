import { RequestContext } from '@vendure/core';
import { ImapFlow } from 'imapflow';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { IcloudPrimaryAccount } from '../entities/icloud-primary-account.entity';

import { IcloudArrivalSampleService } from './icloud-arrival-sample.service';

const client = vi.hoisted(() => ({
    on: vi.fn(),
    connect: vi.fn(),
    mailboxOpen: vi.fn(),
    fetchAll: vi.fn(),
    close: vi.fn(),
}));
vi.mock('imapflow', () => ({
    ImapFlow: vi.fn(function () {
        return client;
    }),
}));

const ctx = {} as RequestContext;
const account = {
    id: '1',
    email: 'fixture@example.test',
    encryptedAppPassword: 'encrypted-fixture',
    imapHost: 'imap.mail.me.com',
    imapPort: 993,
    lastSyncedUidValidity: '42',
} as IcloudPrimaryAccount;
const storedAt = new Date('2026-11-12T09:00:04Z');
const rows = [
    { imapUid: 4, messageId: '<match@example.test>', createdAt: storedAt },
    { imapUid: 3, messageId: '<mismatch@example.test>', createdAt: storedAt },
    { imapUid: 2, messageId: '<future@example.test>', createdAt: storedAt },
];
function fixture() {
    const find = vi.fn().mockResolvedValue(rows);
    const readListeningInbox = vi.fn();
    const service = new IcloudArrivalSampleService(
        { getRepository: () => ({ find }) } as never,
        { decrypt: () => 'synthetic-password' } as never,
        { readListeningInbox } as never,
    );
    return { service, find, readListeningInbox };
}

describe('Apple arrival sampling', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        client.connect.mockResolvedValue(undefined);
        client.mailboxOpen.mockResolvedValue({ uidValidity: BigInt(42) });
        client.fetchAll.mockResolvedValue([
            {
                uid: 4,
                headers: Buffer.from('Message-ID: <match@example.test>\r\n\r\n'),
                internalDate: new Date('2026-11-12T09:00:01Z'),
            },
            {
                uid: 3,
                headers: Buffer.from('Message-ID: <another@example.test>\r\n\r\n'),
                internalDate: new Date('2026-11-12T09:00:01Z'),
            },
            {
                uid: 2,
                headers: Buffer.from('Message-ID: <future@example.test>\r\n\r\n'),
                internalDate: new Date('2026-11-12T09:00:05Z'),
            },
        ]);
    });

    it('matches existing messages by UID and message ID and reads only arrival metadata', async () => {
        const { service, find } = fixture();
        const [sample, concurrent] = await Promise.all([
            service.read(ctx, account),
            service.read(ctx, account),
        ]);
        expect(sample).toEqual({
            outcome: 'measured',
            attempted: 3,
            arrivalToStoreMs: [3000],
            newestStoredAt: storedAt,
        });
        expect(concurrent).toBe(sample);
        expect(find).toHaveBeenCalledOnce();
        expect(find).toHaveBeenCalledWith(
            expect.objectContaining({ select: ['imapUid', 'messageId', 'createdAt'], take: 20 }),
        );
        expect(ImapFlow).toHaveBeenCalledOnce();
        expect(client.mailboxOpen).toHaveBeenCalledExactlyOnceWith('INBOX', { readOnly: true });
        expect(client.fetchAll).toHaveBeenCalledExactlyOnceWith(
            '4,3,2',
            { uid: true, internalDate: true, headers: ['message-id'] },
            { uid: true },
        );
        expect(client.close).toHaveBeenCalledOnce();
        expect(JSON.stringify(sample)).not.toMatch(/example\.test|password/);
    });

    it('reads metadata from a healthy listener without opening or closing a socket', async () => {
        const { service, readListeningInbox } = fixture();
        readListeningInbox.mockImplementation((_, read) => read(client, BigInt(42)));
        expect(await service.read(ctx, account)).toMatchObject({
            outcome: 'measured',
            arrivalToStoreMs: [3000],
        });
        expect(client.fetchAll).toHaveBeenCalledExactlyOnceWith(
            '4,3,2',
            { uid: true, internalDate: true, headers: ['message-id'] },
            { uid: true },
        );
        expect(ImapFlow).not.toHaveBeenCalled();
        expect(client.mailboxOpen).not.toHaveBeenCalled();
        expect(client.close).not.toHaveBeenCalled();
    });

    it('bounds the caller wait while leaving an unresponsive listening socket alone', async () => {
        vi.useFakeTimers();
        try {
            const { service, readListeningInbox } = fixture();
            readListeningInbox.mockReturnValue(new Promise(() => undefined));
            const sample = service.read(ctx, account);
            await vi.advanceTimersByTimeAsync(3500);
            expect(await sample).toMatchObject({ outcome: 'unavailable', attempted: 3 });
            expect(ImapFlow).not.toHaveBeenCalled();
            expect(client.close).not.toHaveBeenCalled();
        } finally {
            vi.useRealTimers();
        }
    });

    it('stops on a different Apple mailbox generation and returns no latency', async () => {
        const { service } = fixture();
        client.mailboxOpen.mockResolvedValue({ uidValidity: BigInt(43) });
        expect(await service.read(ctx, account)).toEqual({
            outcome: 'no_match',
            attempted: 3,
            arrivalToStoreMs: [],
            newestStoredAt: null,
        });
        expect(client.fetchAll).not.toHaveBeenCalled();
        expect(client.close).toHaveBeenCalledOnce();
    });
});

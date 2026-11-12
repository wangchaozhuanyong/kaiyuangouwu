import { Injectable } from '@nestjs/common';
import { RequestContext, TransactionalConnection } from '@vendure/core';
import { ImapFlow } from 'imapflow';
import { MoreThan } from 'typeorm';

import { IcloudPrimaryAccount } from '../entities/icloud-primary-account.entity';
import { IcloudReceivedMail } from '../entities/icloud-received-mail.entity';
import { DEFAULT_ICLOUD_IMAP_HOST, DEFAULT_ICLOUD_IMAP_PORT, isIcloudImapEndpoint } from '../imap-endpoint';

import { IcloudCipherService } from './icloud-cipher.service';
import { IcloudIdleService } from './icloud-idle.service';

const sampleLimit = 20;
const timeoutMs = 3_500;
const intervalMs = 60_000;

export interface IcloudArrivalSample {
    outcome: 'measured' | 'no_messages' | 'no_match' | 'unavailable';
    attempted: number;
    arrivalToStoreMs: number[];
    newestStoredAt: Date | null;
}

type StoredArrival = Pick<IcloudReceivedMail, 'imapUid' | 'messageId' | 'createdAt'>;

function emptySample(outcome: IcloudArrivalSample['outcome'], attempted = 0): IcloudArrivalSample {
    return { outcome, attempted, arrivalToStoreMs: [], newestStoredAt: null };
}

@Injectable()
export class IcloudArrivalSampleService {
    private recent?: { accountId: string; startedAt: number; result: Promise<IcloudArrivalSample> };

    constructor(
        private readonly connection: TransactionalConnection,
        private readonly cipher: IcloudCipherService,
        private readonly idle: IcloudIdleService,
    ) {}

    read(ctx: RequestContext, account: IcloudPrimaryAccount): Promise<IcloudArrivalSample> {
        const accountId = String(account.id);
        const startedAt = Date.now();
        if (this.recent && startedAt - this.recent.startedAt < intervalMs) {
            return this.recent.accountId === accountId
                ? this.recent.result
                : Promise.resolve(emptySample('unavailable'));
        }
        const result = this.sample(ctx, account).catch(() => emptySample('unavailable'));
        this.recent = { accountId, startedAt, result };
        return result;
    }

    private async sample(ctx: RequestContext, account: IcloudPrimaryAccount): Promise<IcloudArrivalSample> {
        const expectedValidity = account.lastSyncedUidValidity;
        if (!isIcloudImapEndpoint(account.imapHost, account.imapPort) || !expectedValidity) {
            return emptySample('unavailable');
        }
        const rows = await this.connection.getRepository(ctx, IcloudReceivedMail).find({
            where: { primaryAccountId: account.id, imapUid: MoreThan(0) },
            select: ['imapUid', 'messageId', 'createdAt'],
            order: { createdAt: 'DESC', id: 'DESC' },
            take: sampleLimit,
        });
        const uids = [...new Set(rows.map(row => row.imapUid))].filter(
            uid => Number.isSafeInteger(uid) && uid > 0,
        );
        if (!uids.length) return emptySample('no_messages');
        const measure = (reader: Pick<ImapFlow, 'fetchAll'>, uidValidity: bigint) =>
            String(uidValidity) === expectedValidity
                ? this.matchStoredArrivals(reader, rows, uids)
                : Promise.resolve(emptySample('no_match', uids.length));
        const listening = this.idle.readListeningInbox(account, measure);
        if (listening) return this.waitForListener(listening, uids.length);

        const password = this.cipher.decrypt(account.encryptedAppPassword);
        if (!password) return emptySample('unavailable', uids.length);

        const client = new ImapFlow({
            host: DEFAULT_ICLOUD_IMAP_HOST,
            port: DEFAULT_ICLOUD_IMAP_PORT,
            secure: true,
            auth: { user: account.email, pass: password },
            logger: false,
            disableAutoIdle: true,
            connectionTimeout: timeoutMs,
            greetingTimeout: timeoutMs,
            socketTimeout: timeoutMs,
        });
        client.on('error', () => undefined);
        const timer = setTimeout(() => client.close(), timeoutMs);
        try {
            await client.connect();
            const mailbox = await client.mailboxOpen('INBOX', { readOnly: true });
            if (mailbox.readOnly === false) return emptySample('unavailable', uids.length);
            return await measure(client, mailbox.uidValidity);
        } catch {
            return emptySample('unavailable', uids.length);
        } finally {
            clearTimeout(timer);
            client.close();
        }
    }

    private async waitForListener(
        result: Promise<IcloudArrivalSample>,
        attempted: number,
    ): Promise<IcloudArrivalSample> {
        const unavailable = emptySample('unavailable', attempted);
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
            const deadline = new Promise<IcloudArrivalSample>(resolve => {
                timer = setTimeout(() => resolve(unavailable), timeoutMs);
            });
            return await Promise.race([result, deadline]);
        } catch {
            return unavailable;
        } finally {
            clearTimeout(timer);
        }
    }

    private async matchStoredArrivals(
        client: Pick<ImapFlow, 'fetchAll'>,
        rows: StoredArrival[],
        uids: number[],
    ): Promise<IcloudArrivalSample> {
        const messages = await client.fetchAll(
            uids.join(','),
            { uid: true, internalDate: true, headers: ['message-id'] },
            { uid: true },
        );
        const byUid = new Map(messages.map(message => [message.uid, message]));
        const sample = emptySample('no_match', uids.length);
        const matched = new Set<number>();
        for (const row of rows) {
            if (matched.has(row.imapUid)) continue;
            const message = byUid.get(row.imapUid);
            const headers = message?.headers?.toString('utf8').replace(/\r?\n[ \t]+/gu, ' ');
            const messageId = headers && /^message-id:[ \t]*([^\r\n]+)$/imu.exec(headers)?.[1]?.trim();
            if (!messageId || messageId !== row.messageId || !message?.internalDate) continue;
            const storedAt = row.createdAt.getTime();
            const arrivedAt =
                message.internalDate instanceof Date
                    ? message.internalDate.getTime()
                    : Date.parse(message.internalDate);
            const lag = storedAt - arrivedAt;
            if (!Number.isSafeInteger(lag) || lag < 0) continue;
            matched.add(row.imapUid);
            sample.arrivalToStoreMs.push(lag);
            sample.newestStoredAt ??= row.createdAt;
        }
        if (sample.arrivalToStoreMs.length) sample.outcome = 'measured';
        return sample;
    }
}

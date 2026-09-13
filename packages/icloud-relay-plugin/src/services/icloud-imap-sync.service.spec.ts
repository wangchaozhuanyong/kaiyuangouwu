import { TransactionalConnection } from '@vendure/core';
import { ImapFlow } from 'imapflow';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { IcloudPrimaryAccount } from '../entities/icloud-primary-account.entity';
import { IcloudReceivedMail } from '../entities/icloud-received-mail.entity';

import { IcloudCipherService } from './icloud-cipher.service';
import { IcloudImapSyncService } from './icloud-imap-sync.service';
import { IcloudMailSanitizerService } from './icloud-mail-sanitizer.service';
import { IcloudOtpExtractorService } from './icloud-otp-extractor.service';

afterEach(() => vi.restoreAllMocks());
describe('historical IMAP header verification', () => {
    it('opens read-only and accepts only the original UID and Message-ID without changing flags or sync state', async () => {
        vi.spyOn(ImapFlow.prototype, 'connect').mockResolvedValue(undefined);
        const lock = vi
            .spyOn(ImapFlow.prototype, 'getMailboxLock')
            .mockResolvedValue({ release: vi.fn(), path: 'INBOX' });
        vi.spyOn(ImapFlow.prototype, 'logout').mockResolvedValue(undefined);
        const fetch = vi.spyOn(ImapFlow.prototype, 'fetchOne').mockResolvedValue({
            uid: 9,
            seq: 1,
            headers: Buffer.from(
                'Message-ID: <original@example.com>\r\nTo: Alias <FIRST@icloud.com>\r\n\r\n',
            ),
        });
        const service = new IcloudImapSyncService(
            {} as TransactionalConnection,
            { decrypt: () => 'local-fixture' } as unknown as IcloudCipherService,
            {} as IcloudOtpExtractorService,
            {} as IcloudMailSanitizerService,
        );
        const account = new IcloudPrimaryAccount({ email: 'local@example.com' });
        const mails = [new IcloudReceivedMail({ id: '1', imapUid: 9, messageId: '<original@example.com>' })];
        expect(await service.readRecipientHeaders(account, mails)).toEqual(
            new Map([['1', ['first@icloud.com']]]),
        );
        expect(lock).toHaveBeenCalledWith('INBOX', { readOnly: true });
        expect(fetch.mock.calls[0][2]).toEqual({ uid: true });
        expect(fetch.mock.calls[0][1]).not.toHaveProperty('source');
        mails[0].messageId = '<different@example.com>';
        expect((await service.readRecipientHeaders(account, mails)).size).toBe(0);
        mails[0].messageId = '<original@example.com>';
        mails[0].imapUid = 10;
        expect((await service.readRecipientHeaders(account, mails)).size).toBe(0);
    });
});

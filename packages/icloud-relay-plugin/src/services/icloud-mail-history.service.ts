import { Injectable } from '@nestjs/common';
import { ID, RequestContext, TransactionalConnection, UserInputError } from '@vendure/core';
import { IsNull } from 'typeorm';

import { IcloudPrimaryAccount } from '../entities/icloud-primary-account.entity';
import { IcloudReceivedMail } from '../entities/icloud-received-mail.entity';
import { IcloudVirtualEmail } from '../entities/icloud-virtual-email.entity';

import { IcloudImapSyncService } from './icloud-imap-sync.service';
import { matchMailRecipient, storedMailRecipients } from './icloud-mail-recipients';
import { lockMailAccount, refreshMailCounts } from './icloud-mail-storage';

export interface MailHistoryResult {
    scannedCount: number;
    matchedCount: number;
    updatedCount: number;
    unmatchedCount: number;
    ambiguousCount: number;
    unresolvedCount: number;
    skippedCount: number;
}

@Injectable()
export class IcloudMailHistoryService {
    constructor(
        private readonly connection: TransactionalConnection,
        private readonly imap: IcloudImapSyncService,
    ) {}

    /** Creation calls this in its existing transaction; never performs network I/O. */
    async reconcileCreated(ctx: RequestContext, primaryAccountId: ID, virtualIds: ID[]): Promise<void> {
        if (!virtualIds.length) return;
        await this.reconcile(ctx, primaryAccountId, false, virtualIds);
    }

    async reconcile(
        ctx: RequestContext,
        primaryAccountId: ID,
        dryRun = true,
        createdIds?: ID[],
    ): Promise<MailHistoryResult> {
        const account = await this.connection.getRepository(ctx, IcloudPrimaryAccount).findOne({
            where: { id: primaryAccountId },
        });
        if (!account) throw new UserInputError('所属主邮箱不存在');
        const result: MailHistoryResult = {
            scannedCount: 0,
            matchedCount: 0,
            updatedCount: 0,
            unmatchedCount: 0,
            ambiguousCount: 0,
            unresolvedCount: 0,
            skippedCount: 0,
        };
        const mailRepo = this.connection.getRepository(ctx, IcloudReceivedMail);
        const baseQuery = () =>
            mailRepo
                .createQueryBuilder('mail')
                .where('mail.primaryAccountId = :primaryAccountId', { primaryAccountId })
                .andWhere('mail.virtualEmailId IS NULL');
        const last = await baseQuery().select(['mail.id']).orderBy('mail.id', 'DESC').getOne();
        if (!last) return result;
        let cursor: ID | undefined;
        while (true) {
            const query = baseQuery()
                .select([
                    'mail.id',
                    'mail.primaryAccountId',
                    'mail.virtualEmailId',
                    'mail.messageId',
                    'mail.imapUid',
                    'mail.toAddressesJson',
                ])
                .andWhere('mail.id <= :lastId', { lastId: last.id })
                .orderBy('mail.id', 'ASC')
                .take(100);
            if (cursor !== undefined) query.andWhere('mail.id > :cursor', { cursor });
            const batch = await query.getMany();
            if (!batch.length) break;
            cursor = batch[batch.length - 1].id;
            const virtuals = await this.connection.getRepository(ctx, IcloudVirtualEmail).find({
                where: { primaryAccountId },
            });
            const recipients = new Map(
                batch.map(mail => [String(mail.id), storedMailRecipients(mail.toAddressesJson)]),
            );
            const needsHeaders = createdIds
                ? []
                : batch.filter(mail => {
                      const match = matchMailRecipient(
                          recipients.get(String(mail.id)) ?? [],
                          virtuals,
                          primaryAccountId,
                      );
                      return !match.match && !match.ambiguous;
                  });
            // This happens before opening the write transaction. The reader uses EXAMINE + UID + Message-ID.
            const recovered = needsHeaders.length
                ? await this.imap.readRecipientHeaders(account, needsHeaders)
                : new Map<string, string[]>();
            for (const [id, addresses] of recovered) recipients.set(id, addresses);
            const pending: IcloudReceivedMail[] = [];
            for (const mail of batch) {
                result.scannedCount++;
                const match = matchMailRecipient(
                    recipients.get(String(mail.id)) ?? [],
                    virtuals,
                    primaryAccountId,
                );
                if (match.ambiguous) result.ambiguousCount++;
                else if (
                    match.match &&
                    (!createdIds || createdIds.some(id => String(id) === String(match.match?.id)))
                ) {
                    result.matchedCount++;
                    pending.push(mail);
                } else if (needsHeaders.includes(mail) && !recovered.has(String(mail.id)))
                    result.unresolvedCount++;
                else result.unmatchedCount++;
            }
            if (dryRun || !pending.length) continue;
            const applyBatch = async (transactionCtx: RequestContext) => {
                await lockMailAccount(transactionCtx, this.connection, primaryAccountId);
                const repo = this.connection.getRepository(transactionCtx, IcloudVirtualEmail);
                const supportsRowLocks = ['mysql', 'mariadb', 'postgres'].includes(
                    this.connection.rawConnection.options.type,
                );
                const currentQuery = repo
                    .createQueryBuilder('virtual')
                    .where('virtual.primaryAccountId = :primaryAccountId', { primaryAccountId });
                if (supportsRowLocks) currentQuery.setLock('pessimistic_write');
                const currentVirtuals = await currentQuery.getMany();
                const changedIds: ID[] = [];
                let updated = 0;
                for (const mail of pending) {
                    const addresses = recipients.get(String(mail.id)) ?? [];
                    const before = matchMailRecipient(addresses, virtuals, primaryAccountId).match;
                    const current = matchMailRecipient(addresses, currentVirtuals, primaryAccountId).match;
                    if (!current || String(current.id) !== String(before?.id)) continue;
                    const write = await this.connection
                        .getRepository(transactionCtx, IcloudReceivedMail)
                        .update(
                            {
                                id: mail.id,
                                primaryAccountId,
                                virtualEmailId: IsNull(),
                                toAddressesJson:
                                    mail.toAddressesJson === null ? IsNull() : mail.toAddressesJson,
                                messageId: mail.messageId,
                                imapUid: mail.imapUid,
                            },
                            { virtualEmailId: current.id, toAddressesJson: JSON.stringify(addresses) },
                        );
                    if (write.affected === 1) {
                        updated++;
                        changedIds.push(current.id);
                    }
                }
                await refreshMailCounts(transactionCtx, this.connection, primaryAccountId, changedIds);
                return updated;
            };
            // Creation already owns its transaction and account lock; avoid committing its outer transaction here.
            const batchUpdatedCount = createdIds
                ? await applyBatch(ctx)
                : await this.connection.withTransaction(ctx, applyBatch);
            result.updatedCount += batchUpdatedCount;
            result.skippedCount += pending.length - batchUpdatedCount;
        }
        return result;
    }
}

import { ID, RequestContext, TransactionalConnection, UserInputError } from '@vendure/core';

import { IcloudPrimaryAccount } from '../entities/icloud-primary-account.entity';
import { IcloudReceivedMail } from '../entities/icloud-received-mail.entity';
import { IcloudVirtualEmail } from '../entities/icloud-virtual-email.entity';

/** All sync/history writers lock the owner first, inside an existing transaction. */
export async function lockMailAccount(ctx: RequestContext, connection: TransactionalConnection, id: ID) {
    const supportsRowLocks = ['mysql', 'mariadb', 'postgres'].includes(connection.rawConnection.options.type);
    const account = await connection.getRepository(ctx, IcloudPrimaryAccount).findOne({
        where: { id },
        ...(supportsRowLocks ? { lock: { mode: 'pessimistic_write' as const } } : {}),
    });
    if (!account) throw new UserInputError('所属主邮箱不存在');
    return account;
}

/** Recount in the UPDATE statement so MySQL cannot reuse an older snapshot after waiting for a lock. */
export async function refreshMailCounts(
    ctx: RequestContext,
    connection: TransactionalConnection,
    primaryAccountId: ID,
    virtualIds: ID[],
) {
    const repo = connection.getRepository(ctx, IcloudVirtualEmail);
    for (const virtualId of new Set(virtualIds)) {
        const subquery = (select: string) =>
            repo
                .createQueryBuilder()
                .subQuery()
                .select(select)
                .from(IcloudReceivedMail, 'mail')
                .where('mail.virtualEmailId = :virtualId AND mail.primaryAccountId = :primaryAccountId')
                .getQuery();
        await repo
            .createQueryBuilder()
            .update(IcloudVirtualEmail)
            .set({
                mailCount: () => subquery('COUNT(*)'),
                lastMailReceivedAt: () => subquery('MAX(mail.receivedAt)'),
            })
            .where('id = :virtualId AND primaryAccountId = :primaryAccountId', {
                virtualId,
                primaryAccountId,
            })
            .execute();
    }
}

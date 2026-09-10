import { Injectable } from '@nestjs/common';
import { ID, RequestContext, TransactionalConnection, UserInputError } from '@vendure/core';

import { IcloudPrimaryAccount } from '../entities/icloud-primary-account.entity';
import { IcloudReceivedMail } from '../entities/icloud-received-mail.entity';
import { IcloudVirtualEmail } from '../entities/icloud-virtual-email.entity';
import {
    BatchCreateVirtualEmailsInput,
    CreatePrimaryAccountInput,
    CreateVirtualEmailInput,
    IcloudAccountStatus,
    IcloudVirtualEmailStatus,
    UpdatePrimaryAccountInput,
    UpdateVirtualEmailInput,
} from '../types';

import { IcloudAccessCodeService } from './icloud-access-code.service';
import { IcloudCipherService } from './icloud-cipher.service';
import { IcloudImapSyncService, SyncAccountResult, TestConnectionResult } from './icloud-imap-sync.service';

export interface PrimaryAccountView {
    id: ID;
    createdAt: Date;
    updatedAt: Date;
    email: string;
    note: string | null;
    status: IcloudAccountStatus;
    imapHost: string;
    imapPort: number;
    masterQueryCode: string | null;
    codeExpiresAt: Date | null;
    codeResetIntervalDays: number;
    remainingDays: number | null;
    lastQueriedAt: Date | null;
    lastQueriedIp: string | null;
    lastSyncedAt: Date | null;
    lastSyncError: string | null;
    virtualEmailCount: number;
}

export interface VirtualEmailView {
    id: ID;
    createdAt: Date;
    updatedAt: Date;
    primaryAccountId: ID;
    primaryAccountEmail?: string;
    aliasEmail: string;
    note: string | null;
    status: IcloudVirtualEmailStatus;
    buyerQueryCode: string;
    codeExpiresAt: Date | null;
    codeResetIntervalDays: number;
    remainingDays: number | null;
    lastQueriedAt: Date | null;
    lastQueriedIp: string | null;
    mailCount: number;
    lastMailReceivedAt: Date | null;
}

@Injectable()
export class IcloudAdminService {
    constructor(
        private readonly connection: TransactionalConnection,
        private readonly cipher: IcloudCipherService,
        private readonly codeService: IcloudAccessCodeService,
        private readonly imapSyncService: IcloudImapSyncService,
    ) {}

    // ==========================================
    // Primary Account Methods
    // ==========================================

    async findAllPrimaryAccounts(ctx: RequestContext): Promise<PrimaryAccountView[]> {
        const repo = this.connection.getRepository(ctx, IcloudPrimaryAccount);
        const virtualRepo = this.connection.getRepository(ctx, IcloudVirtualEmail);

        const accounts = await repo.find({
            order: { createdAt: 'DESC' },
        });

        const result: PrimaryAccountView[] = [];
        for (const acc of accounts) {
            const count = await virtualRepo.count({
                where: { primaryAccountId: acc.id },
            });
            result.push(this.toPrimaryView(acc, count));
        }
        return result;
    }

    async findPrimaryAccountById(ctx: RequestContext, id: ID): Promise<PrimaryAccountView | null> {
        const repo = this.connection.getRepository(ctx, IcloudPrimaryAccount);
        const virtualRepo = this.connection.getRepository(ctx, IcloudVirtualEmail);
        const account = await repo.findOne({ where: { id } });
        if (!account) return null;
        const count = await virtualRepo.count({ where: { primaryAccountId: id } });
        return this.toPrimaryView(account, count);
    }

    async createPrimaryAccount(
        ctx: RequestContext,
        input: CreatePrimaryAccountInput,
    ): Promise<PrimaryAccountView> {
        const repo = this.connection.getRepository(ctx, IcloudPrimaryAccount);
        const email = input.email.toLowerCase().trim();

        const existing = await repo.findOne({ where: { email } });
        if (existing) {
            throw new UserInputError(`主邮箱 ${email} 已存在`);
        }

        const intervalDays = input.codeResetIntervalDays ?? 30;
        const masterCode = input.masterQueryCode?.trim() || this.codeService.generateCode('MSTR');
        const codeExpiresAt = this.codeService.calculateExpiration(intervalDays);

        const account = new IcloudPrimaryAccount({
            email,
            encryptedAppPassword: this.cipher.encrypt(input.appPassword.trim()),
            note: input.note || null,
            imapHost: input.imapHost || 'imap.mail.me.com',
            imapPort: input.imapPort || 993,
            status: IcloudAccountStatus.ACTIVE,
            masterQueryCode: masterCode,
            codeExpiresAt,
            codeResetIntervalDays: intervalDays,
            lastSyncedUid: 0,
        });

        const saved = await repo.save(account);
        return this.toPrimaryView(saved, 0);
    }

    async updatePrimaryAccount(
        ctx: RequestContext,
        input: UpdatePrimaryAccountInput,
    ): Promise<PrimaryAccountView> {
        const repo = this.connection.getRepository(ctx, IcloudPrimaryAccount);
        const account = await repo.findOne({ where: { id: input.id } });
        if (!account) {
            throw new UserInputError(`未找到 ID 为 ${input.id} 的主邮箱`);
        }

        if (input.email) {
            account.email = input.email.toLowerCase().trim();
        }
        if (input.appPassword) {
            account.encryptedAppPassword = this.cipher.encrypt(input.appPassword.trim());
        }
        if (input.note !== undefined) {
            account.note = input.note;
        }
        if (input.status) {
            account.status = input.status;
        }
        if (input.imapHost) {
            account.imapHost = input.imapHost;
        }
        if (input.imapPort) {
            account.imapPort = input.imapPort;
        }
        if (input.codeResetIntervalDays !== undefined) {
            account.codeResetIntervalDays = input.codeResetIntervalDays;
            account.codeExpiresAt = this.codeService.calculateExpiration(input.codeResetIntervalDays);
        }
        if (input.masterQueryCode) {
            account.masterQueryCode = input.masterQueryCode.trim();
        }

        const saved = await repo.save(account);
        const virtualRepo = this.connection.getRepository(ctx, IcloudVirtualEmail);
        const count = await virtualRepo.count({ where: { primaryAccountId: saved.id } });
        return this.toPrimaryView(saved, count);
    }

    async deletePrimaryAccount(ctx: RequestContext, id: ID): Promise<boolean> {
        const repo = this.connection.getRepository(ctx, IcloudPrimaryAccount);
        await repo.delete({ id });
        return true;
    }

    async testConnection(ctx: RequestContext, id: ID): Promise<TestConnectionResult> {
        const repo = this.connection.getRepository(ctx, IcloudPrimaryAccount);
        const account = await repo.findOne({ where: { id } });
        if (!account) {
            return { success: false, message: '主邮箱不存在' };
        }
        return this.imapSyncService.testConnection(account);
    }

    async syncPrimaryAccount(ctx: RequestContext, id: ID): Promise<SyncAccountResult> {
        const repo = this.connection.getRepository(ctx, IcloudPrimaryAccount);
        const account = await repo.findOne({ where: { id } });
        if (!account) {
            return { success: false, syncedCount: 0, error: '主邮箱不存在' };
        }
        return this.imapSyncService.syncAccount(ctx, account);
    }

    async resetMasterCode(ctx: RequestContext, id: ID): Promise<PrimaryAccountView> {
        const repo = this.connection.getRepository(ctx, IcloudPrimaryAccount);
        const account = await repo.findOne({ where: { id } });
        if (!account) {
            throw new UserInputError('主邮箱不存在');
        }

        account.masterQueryCode = this.codeService.generateCode('MSTR');
        account.codeExpiresAt = this.codeService.calculateExpiration(account.codeResetIntervalDays);
        const saved = await repo.save(account);

        const virtualRepo = this.connection.getRepository(ctx, IcloudVirtualEmail);
        const count = await virtualRepo.count({ where: { primaryAccountId: saved.id } });
        return this.toPrimaryView(saved, count);
    }

    // ==========================================
    // Virtual Email Methods
    // ==========================================

    async findAllVirtualEmails(ctx: RequestContext, primaryAccountId?: ID): Promise<VirtualEmailView[]> {
        const repo = this.connection.getRepository(ctx, IcloudVirtualEmail);
        const whereClause = primaryAccountId ? { primaryAccountId } : {};
        const list = await repo.find({
            where: whereClause,
            relations: ['primaryAccount'],
            order: { createdAt: 'DESC' },
        });

        return list.map(item => this.toVirtualView(item));
    }

    async findVirtualEmailById(ctx: RequestContext, id: ID): Promise<VirtualEmailView | null> {
        const repo = this.connection.getRepository(ctx, IcloudVirtualEmail);
        const item = await repo.findOne({
            where: { id },
            relations: ['primaryAccount'],
        });
        if (!item) return null;
        return this.toVirtualView(item);
    }

    async createVirtualEmail(ctx: RequestContext, input: CreateVirtualEmailInput): Promise<VirtualEmailView> {
        const primaryRepo = this.connection.getRepository(ctx, IcloudPrimaryAccount);
        const primary = await primaryRepo.findOne({ where: { id: input.primaryAccountId } });
        if (!primary) {
            throw new UserInputError('所属主邮箱不存在');
        }

        const virtualRepo = this.connection.getRepository(ctx, IcloudVirtualEmail);
        const alias = input.aliasEmail.toLowerCase().trim();

        const existing = await virtualRepo.findOne({ where: { aliasEmail: alias } });
        if (existing) {
            throw new UserInputError(`虚拟邮箱 ${alias} 已存在`);
        }

        const intervalDays = input.codeResetIntervalDays ?? primary.codeResetIntervalDays ?? 30;
        const buyerQueryCode = input.buyerQueryCode?.trim() || this.codeService.generateCode('BUY');
        const codeExpiresAt = this.codeService.calculateExpiration(intervalDays);

        const virtual = new IcloudVirtualEmail({
            primaryAccountId: primary.id,
            aliasEmail: alias,
            note: input.note || null,
            status: IcloudVirtualEmailStatus.ACTIVE,
            buyerQueryCode,
            codeExpiresAt,
            codeResetIntervalDays: intervalDays,
            mailCount: 0,
        });

        const saved = await virtualRepo.save(virtual);
        saved.primaryAccount = primary;
        return this.toVirtualView(saved);
    }

    async batchCreateVirtualEmails(
        ctx: RequestContext,
        input: BatchCreateVirtualEmailsInput,
    ): Promise<{ createdCount: number; skippedCount: number; errors: string[] }> {
        const primaryRepo = this.connection.getRepository(ctx, IcloudPrimaryAccount);
        const primary = await primaryRepo.findOne({ where: { id: input.primaryAccountId } });
        if (!primary) {
            throw new UserInputError('所属主邮箱不存在');
        }

        const virtualRepo = this.connection.getRepository(ctx, IcloudVirtualEmail);
        const lines = input.rawInput
            .split(/[\r\n]+/)
            .map(l => l.trim())
            .filter(l => l.length > 0);

        let createdCount = 0;
        let skippedCount = 0;
        const errors: string[] = [];

        const intervalDays = input.codeResetIntervalDays ?? primary.codeResetIntervalDays ?? 30;

        for (const line of lines) {
            // Support "alias@domain.com" or "alias@domain.com,note" or "alias@domain.com  note"
            const parts = line.split(/[,\t|]+/);
            const alias = parts[0]?.toLowerCase().trim();
            const note = parts[1]?.trim() || null;

            if (!alias || !alias.includes('@')) {
                skippedCount++;
                errors.push(`忽略非法邮箱格式: ${line}`);
                continue;
            }

            const existing = await virtualRepo.findOne({ where: { aliasEmail: alias } });
            if (existing) {
                skippedCount++;
                errors.push(`邮箱已存在跳过: ${alias}`);
                continue;
            }

            const buyerQueryCode = this.codeService.generateCode('BUY');
            const codeExpiresAt = this.codeService.calculateExpiration(intervalDays);

            const v = new IcloudVirtualEmail({
                primaryAccountId: primary.id,
                aliasEmail: alias,
                note,
                status: IcloudVirtualEmailStatus.ACTIVE,
                buyerQueryCode,
                codeExpiresAt,
                codeResetIntervalDays: intervalDays,
                mailCount: 0,
            });

            await virtualRepo.save(v);
            createdCount++;
        }

        return { createdCount, skippedCount, errors };
    }

    async updateVirtualEmail(ctx: RequestContext, input: UpdateVirtualEmailInput): Promise<VirtualEmailView> {
        const repo = this.connection.getRepository(ctx, IcloudVirtualEmail);
        const item = await repo.findOne({
            where: { id: input.id },
            relations: ['primaryAccount'],
        });
        if (!item) {
            throw new UserInputError(`虚拟邮箱不存在`);
        }

        if (input.aliasEmail) {
            item.aliasEmail = input.aliasEmail.toLowerCase().trim();
        }
        if (input.note !== undefined) {
            item.note = input.note;
        }
        if (input.status) {
            item.status = input.status;
        }
        if (input.buyerQueryCode) {
            item.buyerQueryCode = input.buyerQueryCode.trim();
        }
        if (input.codeResetIntervalDays !== undefined) {
            item.codeResetIntervalDays = input.codeResetIntervalDays;
            item.codeExpiresAt = this.codeService.calculateExpiration(input.codeResetIntervalDays);
        }

        const saved = await repo.save(item);
        return this.toVirtualView(saved);
    }

    async deleteVirtualEmail(ctx: RequestContext, id: ID): Promise<boolean> {
        const repo = this.connection.getRepository(ctx, IcloudVirtualEmail);
        await repo.delete({ id });
        return true;
    }

    async resetVirtualEmailCode(ctx: RequestContext, id: ID): Promise<VirtualEmailView> {
        const repo = this.connection.getRepository(ctx, IcloudVirtualEmail);
        const item = await repo.findOne({
            where: { id },
            relations: ['primaryAccount'],
        });
        if (!item) {
            throw new UserInputError('虚拟邮箱不存在');
        }

        item.buyerQueryCode = this.codeService.generateCode('BUY');
        item.codeExpiresAt = this.codeService.calculateExpiration(item.codeResetIntervalDays);
        const saved = await repo.save(item);
        return this.toVirtualView(saved);
    }

    // ==========================================
    // Received Mail Methods
    // ==========================================

    async findReceivedMails(
        ctx: RequestContext,
        options: {
            virtualEmailId?: ID;
            primaryAccountId?: ID;
            unassignedOnly?: boolean;
            limit?: number;
        },
    ): Promise<IcloudReceivedMail[]> {
        const repo = this.connection.getRepository(ctx, IcloudReceivedMail);
        const query = repo.createQueryBuilder('mail');

        if (options.unassignedOnly) {
            query.where('mail.virtualEmailId IS NULL');
        } else if (options.virtualEmailId) {
            query.where('mail.virtualEmailId = :vId', { vId: options.virtualEmailId });
        } else if (options.primaryAccountId) {
            query.where('mail.primaryAccountId = :pId', { pId: options.primaryAccountId });
        }

        query.orderBy('mail.receivedAt', 'DESC').take(options.limit || 50);
        return await query.getMany();
    }

    async reassignMail(ctx: RequestContext, mailId: ID, virtualEmailId: ID): Promise<IcloudReceivedMail> {
        const mailRepo = this.connection.getRepository(ctx, IcloudReceivedMail);
        const virtualRepo = this.connection.getRepository(ctx, IcloudVirtualEmail);

        const mail = await mailRepo.findOne({ where: { id: mailId } });
        if (!mail) throw new UserInputError('邮件不存在');

        const virtual = await virtualRepo.findOne({ where: { id: virtualEmailId } });
        if (!virtual) throw new UserInputError('指定的虚拟邮箱不存在');

        mail.virtualEmailId = virtual.id;
        const saved = await mailRepo.save(mail);

        virtual.mailCount += 1;
        await virtualRepo.save(virtual);

        return saved;
    }

    async deleteMail(ctx: RequestContext, mailId: ID): Promise<boolean> {
        const repo = this.connection.getRepository(ctx, IcloudReceivedMail);
        await repo.delete({ id: mailId });
        return true;
    }

    // ==========================================
    // View Converters
    // ==========================================

    private toPrimaryView(account: IcloudPrimaryAccount, count: number): PrimaryAccountView {
        return {
            id: account.id,
            createdAt: account.createdAt,
            updatedAt: account.updatedAt,
            email: account.email,
            note: account.note,
            status: account.status,
            imapHost: account.imapHost,
            imapPort: account.imapPort,
            masterQueryCode: account.masterQueryCode,
            codeExpiresAt: account.codeExpiresAt,
            codeResetIntervalDays: account.codeResetIntervalDays,
            remainingDays: this.codeService.getRemainingDays(account.codeExpiresAt),
            lastQueriedAt: account.lastQueriedAt,
            lastQueriedIp: account.lastQueriedIp,
            lastSyncedAt: account.lastSyncedAt,
            lastSyncError: account.lastSyncError,
            virtualEmailCount: count,
        };
    }

    private toVirtualView(virtual: IcloudVirtualEmail): VirtualEmailView {
        return {
            id: virtual.id,
            createdAt: virtual.createdAt,
            updatedAt: virtual.updatedAt,
            primaryAccountId: virtual.primaryAccountId,
            primaryAccountEmail: virtual.primaryAccount?.email,
            aliasEmail: virtual.aliasEmail,
            note: virtual.note,
            status: virtual.status,
            buyerQueryCode: virtual.buyerQueryCode,
            codeExpiresAt: virtual.codeExpiresAt,
            codeResetIntervalDays: virtual.codeResetIntervalDays,
            remainingDays: this.codeService.getRemainingDays(virtual.codeExpiresAt),
            lastQueriedAt: virtual.lastQueriedAt,
            lastQueriedIp: virtual.lastQueriedIp,
            mailCount: virtual.mailCount,
            lastMailReceivedAt: virtual.lastMailReceivedAt,
        };
    }
}

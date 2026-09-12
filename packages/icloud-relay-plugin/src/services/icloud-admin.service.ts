import { Injectable } from '@nestjs/common';
import { ID, RequestContext, TransactionalConnection, UserInputError } from '@vendure/core';

import { validateIcloudInput } from '../client/admin-validation';
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
import { updateIcloudRecord } from './icloud-record-update';

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

    private validate(input: object): void {
        const error = validateIcloudInput(input as Record<string, unknown>);
        if (error) throw new UserInputError(error);
    }

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
        this.validate(input);
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
        return this.toPrimaryView(await repo.findOneByOrFail({ id: saved.id }), 0);
    }

    async updatePrimaryAccount(
        ctx: RequestContext,
        input: UpdatePrimaryAccountInput,
    ): Promise<PrimaryAccountView> {
        this.validate(input);
        const repo = this.connection.getRepository(ctx, IcloudPrimaryAccount);
        const account = await repo.findOne({ where: { id: input.id } });
        if (!account) {
            throw new UserInputError(`未找到 ID 为 ${input.id} 的主邮箱`);
        }

        const patch: Partial<IcloudPrimaryAccount> = {};
        if (input.email !== undefined) patch.email = input.email.toLowerCase().trim();
        if (input.appPassword !== undefined)
            patch.encryptedAppPassword = this.cipher.encrypt(input.appPassword.trim());
        if (input.note !== undefined) patch.note = input.note;
        if (input.status !== undefined) patch.status = input.status;
        if (input.imapHost !== undefined) patch.imapHost = input.imapHost.trim();
        if (input.imapPort !== undefined) patch.imapPort = input.imapPort;
        if (input.masterQueryCode !== undefined) patch.masterQueryCode = input.masterQueryCode.trim();
        if (
            input.codeResetIntervalDays !== undefined &&
            input.codeResetIntervalDays !== account.codeResetIntervalDays
        ) {
            patch.codeResetIntervalDays = input.codeResetIntervalDays;
            patch.codeExpiresAt = this.codeService.calculateExpiration(input.codeResetIntervalDays);
        }
        const guards = Object.keys(patch) as Array<keyof IcloudPrimaryAccount>;
        if ('codeExpiresAt' in patch) guards.push('masterQueryCode');
        await updateIcloudRecord(repo, account, patch, guards);
        const saved = await repo.findOneByOrFail({ id: account.id });
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

        await updateIcloudRecord(
            repo,
            account,
            {
                masterQueryCode: this.codeService.generateCode('MSTR'),
                codeExpiresAt: this.codeService.calculateExpiration(account.codeResetIntervalDays),
            },
            ['masterQueryCode', 'codeExpiresAt', 'codeResetIntervalDays'],
        );
        const saved = await repo.findOneByOrFail({ id });

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
        this.validate(input);
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
        return this.toVirtualView(
            await virtualRepo.findOneOrFail({ where: { id: saved.id }, relations: ['primaryAccount'] }),
        );
    }

    async batchCreateVirtualEmails(
        ctx: RequestContext,
        input: BatchCreateVirtualEmailsInput,
    ): Promise<{ createdCount: number; skippedCount: number; errors: string[] }> {
        this.validate(input);
        const primaryRepo = this.connection.getRepository(ctx, IcloudPrimaryAccount);
        const primary = await primaryRepo.findOne({ where: { id: input.primaryAccountId } });
        if (!primary) {
            throw new UserInputError('所属主邮箱不存在');
        }

        const virtualRepo = this.connection.getRepository(ctx, IcloudVirtualEmail);
        const lines = input.rawInput.split(/\r\n|\r|\n/).map(l => l.trim());

        let createdCount = 0;
        let skippedCount = 0;
        const errors: string[] = [];

        const intervalDays = input.codeResetIntervalDays ?? primary.codeResetIntervalDays ?? 30;

        for (const [index, line] of lines.entries()) {
            if (!line) continue;
            // Support "alias@domain.com" or "alias@domain.com,note" or "alias@domain.com  note"
            const parsed = /^([^,\t|\s]+)(?:[,\t|\s]+(.*))?$/.exec(line);
            const alias = parsed?.[1]?.toLowerCase();
            const note = parsed?.[2]?.trim() || null;

            const validationError = validateIcloudInput({ aliasEmail: alias, note });
            if (validationError) {
                skippedCount++;
                errors.push(`第 ${index + 1} 行：${validationError}`);
                continue;
            }

            const existing = await virtualRepo.findOne({ where: { aliasEmail: alias } });
            if (existing) {
                skippedCount++;
                errors.push(`第 ${index + 1} 行：邮箱已存在跳过: ${alias}`);
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
        this.validate(input);
        const repo = this.connection.getRepository(ctx, IcloudVirtualEmail);
        const item = await repo.findOne({
            where: { id: input.id },
            relations: ['primaryAccount'],
        });
        if (!item) {
            throw new UserInputError(`虚拟邮箱不存在`);
        }

        const patch: Partial<IcloudVirtualEmail> = {};
        if (input.aliasEmail !== undefined) patch.aliasEmail = input.aliasEmail.toLowerCase().trim();
        if (input.note !== undefined) patch.note = input.note;
        if (input.status !== undefined) patch.status = input.status;
        if (input.buyerQueryCode !== undefined) patch.buyerQueryCode = input.buyerQueryCode.trim();
        if (
            input.codeResetIntervalDays !== undefined &&
            input.codeResetIntervalDays !== item.codeResetIntervalDays
        ) {
            patch.codeResetIntervalDays = input.codeResetIntervalDays;
            patch.codeExpiresAt = this.codeService.calculateExpiration(input.codeResetIntervalDays);
        }
        const guards = Object.keys(patch) as Array<keyof IcloudVirtualEmail>;
        if ('codeExpiresAt' in patch) guards.push('buyerQueryCode');
        await updateIcloudRecord(repo, item, patch, guards);
        const saved = await repo.findOneOrFail({ where: { id: item.id }, relations: ['primaryAccount'] });
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

        await updateIcloudRecord(
            repo,
            item,
            {
                buyerQueryCode: this.codeService.generateCode('BUY'),
                codeExpiresAt: this.codeService.calculateExpiration(item.codeResetIntervalDays),
            },
            ['buyerQueryCode', 'codeExpiresAt', 'codeResetIntervalDays'],
        );
        const saved = await repo.findOneOrFail({ where: { id }, relations: ['primaryAccount'] });
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
        return query.getMany();
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

        await virtualRepo.increment({ id: virtual.id }, 'mailCount', 1);

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

import { Injectable } from '@nestjs/common';
import {
    Administrator,
    AdministratorService,
    ID,
    RequestContext,
    TransactionalConnection,
    UserInputError,
} from '@vendure/core';
import { In, Not } from 'typeorm';

import { DashboardTwoFactorAccount } from './entities/dashboard-two-factor-account.entity';
import { TwoFactorCipherService } from './two-factor-cipher.service';
import { normalizeBase32Secret } from './two-factor-secret';

export const MAX_DASHBOARD_TWO_FACTOR_ACCOUNTS = 100;

export interface DashboardTwoFactorAccountInput {
    projectName: string;
    secret: string;
}

export interface DashboardTwoFactorAccountView {
    id: ID;
    createdAt: Date;
    updatedAt: Date;
    projectName: string;
    secret: string;
    lastUsedAt: Date | null;
}

@Injectable()
export class TwoFactorAccountService {
    constructor(
        private readonly connection: TransactionalConnection,
        private readonly administratorService: AdministratorService,
        private readonly cipher: TwoFactorCipherService,
    ) {}

    async findAll(ctx: RequestContext): Promise<DashboardTwoFactorAccountView[]> {
        const administrator = await this.activeAdministrator(ctx);
        const accounts = await this.repository(ctx).find({
            where: { administratorId: administrator.id },
            order: { createdAt: 'ASC', id: 'ASC' },
        });
        return accounts.map(account => this.toView(account));
    }

    async create(
        ctx: RequestContext,
        input: DashboardTwoFactorAccountInput,
    ): Promise<DashboardTwoFactorAccountView> {
        const administrator = await this.activeAdministrator(ctx);
        const repository = this.repository(ctx);
        const count = await repository.count({ where: { administratorId: administrator.id } });
        if (count >= MAX_DASHBOARD_TWO_FACTOR_ACCOUNTS) {
            throw new UserInputError(`最多只能保存 ${MAX_DASHBOARD_TWO_FACTOR_ACCOUNTS} 个 2FA 账号`);
        }
        const normalized = this.normalizeInput(input);
        await this.assertSecretAvailable(ctx, administrator.id, normalized.secret);
        const account = await repository.save(
            new DashboardTwoFactorAccount({
                administrator,
                administratorId: administrator.id,
                projectName: normalized.projectName,
                encryptedSecret: this.cipher.encrypt(normalized.secret),
                fingerprint: this.cipher.fingerprint(administrator.id, normalized.secret),
                lastUsedAt: null,
            }),
        );
        return this.toView(account);
    }

    async update(
        ctx: RequestContext,
        input: DashboardTwoFactorAccountInput & { id: ID },
    ): Promise<DashboardTwoFactorAccountView> {
        const administrator = await this.activeAdministrator(ctx);
        const account = await this.ownedAccount(ctx, administrator.id, input.id);
        const normalized = this.normalizeInput(input);
        await this.assertSecretAvailable(ctx, administrator.id, normalized.secret, account.id);
        account.projectName = normalized.projectName;
        account.encryptedSecret = this.cipher.encrypt(normalized.secret);
        account.fingerprint = this.cipher.fingerprint(administrator.id, normalized.secret);
        return this.toView(await this.repository(ctx).save(account));
    }

    async import(
        ctx: RequestContext,
        inputs: DashboardTwoFactorAccountInput[],
    ): Promise<DashboardTwoFactorAccountView[]> {
        const administrator = await this.activeAdministrator(ctx);
        if (!inputs.length) throw new UserInputError('请至少导入一个 2FA 账号');
        if (inputs.length > MAX_DASHBOARD_TWO_FACTOR_ACCOUNTS) {
            throw new UserInputError(`单次最多导入 ${MAX_DASHBOARD_TWO_FACTOR_ACCOUNTS} 个 2FA 账号`);
        }
        const normalized = inputs.map(input => this.normalizeInput(input));
        const fingerprints = normalized.map(input => this.cipher.fingerprint(administrator.id, input.secret));
        if (new Set(fingerprints).size !== fingerprints.length) {
            throw new UserInputError('导入内容包含重复的 2FA 密钥');
        }

        const repository = this.repository(ctx);
        const existingCount = await repository.count({ where: { administratorId: administrator.id } });
        if (existingCount + normalized.length > MAX_DASHBOARD_TWO_FACTOR_ACCOUNTS) {
            throw new UserInputError(`最多只能保存 ${MAX_DASHBOARD_TWO_FACTOR_ACCOUNTS} 个 2FA 账号`);
        }
        const duplicate = await repository.findOne({
            where: { administratorId: administrator.id, fingerprint: In(fingerprints) },
            select: ['id'],
        });
        if (duplicate) throw new UserInputError('导入内容包含已保存的 2FA 密钥');

        await repository.save(
            normalized.map(
                input =>
                    new DashboardTwoFactorAccount({
                        administrator,
                        administratorId: administrator.id,
                        projectName: input.projectName,
                        encryptedSecret: this.cipher.encrypt(input.secret),
                        fingerprint: this.cipher.fingerprint(administrator.id, input.secret),
                        lastUsedAt: null,
                    }),
            ),
        );
        return this.findAll(ctx);
    }

    async delete(ctx: RequestContext, id: ID): Promise<boolean> {
        const administrator = await this.activeAdministrator(ctx);
        const result = await this.repository(ctx).delete({ id, administratorId: administrator.id });
        if (!result.affected) throw new UserInputError('2FA 账号不存在或不属于当前管理员');
        return true;
    }

    async clear(ctx: RequestContext): Promise<boolean> {
        const administrator = await this.activeAdministrator(ctx);
        await this.repository(ctx).delete({ administratorId: administrator.id });
        return true;
    }

    async touch(ctx: RequestContext, id: ID): Promise<DashboardTwoFactorAccountView> {
        const administrator = await this.activeAdministrator(ctx);
        const account = await this.ownedAccount(ctx, administrator.id, id);
        account.lastUsedAt = new Date();
        return this.toView(await this.repository(ctx).save(account));
    }

    private repository(ctx: RequestContext) {
        return this.connection.getRepository(ctx, DashboardTwoFactorAccount);
    }

    private async activeAdministrator(ctx: RequestContext): Promise<Administrator> {
        if (!ctx.activeUserId) throw new UserInputError('请先登录管理后台');
        const administrator = await this.administratorService.findOneByUserId(ctx, ctx.activeUserId);
        if (!administrator) throw new UserInputError('当前登录用户不是有效管理员');
        return administrator;
    }

    private async ownedAccount(
        ctx: RequestContext,
        administratorId: ID,
        id: ID,
    ): Promise<DashboardTwoFactorAccount> {
        const account = await this.repository(ctx).findOne({ where: { id, administratorId } });
        if (!account) throw new UserInputError('2FA 账号不存在或不属于当前管理员');
        return account;
    }

    private normalizeInput(input: DashboardTwoFactorAccountInput): DashboardTwoFactorAccountInput {
        const projectName = input.projectName?.trim();
        if (!projectName) throw new UserInputError('项目名称不能为空');
        if (projectName.length > 80) throw new UserInputError('项目名称不能超过 80 个字符');
        try {
            return { projectName, secret: normalizeBase32Secret(input.secret ?? '') };
        } catch {
            throw new UserInputError('2FA 密钥不是有效的 Base32');
        }
    }

    private async assertSecretAvailable(
        ctx: RequestContext,
        administratorId: ID,
        secret: string,
        excludedId?: ID,
    ): Promise<void> {
        const fingerprint = this.cipher.fingerprint(administratorId, secret);
        const duplicate = await this.repository(ctx).findOne({
            where: {
                administratorId,
                fingerprint,
                ...(excludedId === undefined ? {} : { id: Not(excludedId) }),
            },
            select: ['id'],
        });
        if (duplicate) throw new UserInputError('这个 2FA 密钥已经存在');
    }

    private toView(account: DashboardTwoFactorAccount): DashboardTwoFactorAccountView {
        return {
            id: account.id,
            createdAt: account.createdAt,
            updatedAt: account.updatedAt,
            projectName: account.projectName,
            secret: this.cipher.decrypt(account.encryptedSecret),
            lastUsedAt: account.lastUsedAt,
        };
    }
}

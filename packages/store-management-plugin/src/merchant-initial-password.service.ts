import { Injectable } from '@nestjs/common';
import {
    Administrator,
    AdministratorService,
    ConfigService,
    ForbiddenError,
    PasswordCipher,
    RequestContext,
    TransactionalConnection,
    User,
    UserInputError,
} from '@vendure/core';

import { StoreAdministratorAccess } from './entities/store-administrator-access.entity';

const allowedRootFields = new Set([
    'Query.activeAdministrator',
    'Query.me',
    'Query.merchantInitialPasswordStatus',
    'Mutation.completeInitialPasswordChange',
    'Mutation.logout',
]);

@Injectable()
export class MerchantInitialPasswordService {
    constructor(
        private readonly connection: TransactionalConnection,
        private readonly administratorService: AdministratorService,
        private readonly configService: ConfigService,
        private readonly passwordCipher: PasswordCipher,
    ) {}

    async requirePasswordChange(ctx: RequestContext, administrator: Administrator): Promise<void> {
        const repository = this.connection.getRepository(ctx, StoreAdministratorAccess);
        const existing = await repository.findOne({ where: { administratorId: administrator.id } });
        if (existing) {
            existing.mustChangePassword = true;
            existing.userId = administrator.user.id;
            await repository.save(existing);
            return;
        }
        await repository.save(
            new StoreAdministratorAccess({
                administrator,
                administratorId: administrator.id,
                userId: administrator.user.id,
                mustChangePassword: true,
            }),
        );
    }

    async status(ctx: RequestContext): Promise<{ mustChangePassword: boolean }> {
        return { mustChangePassword: await this.mustChangePassword(ctx) };
    }

    async complete(ctx: RequestContext, password: string): Promise<{ mustChangePassword: boolean }> {
        if (!ctx.activeUserId) {
            throw new ForbiddenError();
        }
        const repository = this.connection.getRepository(ctx, StoreAdministratorAccess);
        const access = await repository.findOne({ where: { userId: ctx.activeUserId } });
        if (!access?.mustChangePassword) {
            throw new UserInputError('当前账号不需要完成首次改密');
        }
        await this.validatePassword(ctx, password);

        const administrator = await this.administratorService.findOneByUserId(ctx, ctx.activeUserId);
        if (!administrator) {
            throw new ForbiddenError();
        }
        if (await this.matchesCurrentPassword(ctx, ctx.activeUserId, password)) {
            throw new UserInputError('新密码不能与临时密码相同');
        }

        await this.administratorService.update(ctx, { id: administrator.id, password });
        access.mustChangePassword = false;
        await repository.save(access);
        return { mustChangePassword: false };
    }

    async assertRootFieldAccess(ctx: RequestContext, parentType: string, fieldName: string): Promise<void> {
        if (
            ctx.apiType !== 'admin' ||
            !ctx.activeUserId ||
            allowedRootFields.has(`${parentType}.${fieldName}`)
        ) {
            return;
        }
        if (await this.mustChangePassword(ctx)) {
            throw new ForbiddenError();
        }
    }

    private async mustChangePassword(ctx: RequestContext): Promise<boolean> {
        if (!ctx.activeUserId) {
            return false;
        }
        const access = await this.connection
            .getRepository(ctx, StoreAdministratorAccess)
            .findOne({ where: { userId: ctx.activeUserId } });
        return access?.mustChangePassword === true;
    }

    private async validatePassword(ctx: RequestContext, password: string): Promise<void> {
        const strategyResult = await this.configService.authOptions.passwordValidationStrategy.validate(
            ctx,
            password,
        );
        const hasRequiredComposition =
            password.length >= 12 &&
            /\p{L}/u.test(password) &&
            /\p{N}/u.test(password) &&
            /[\p{P}\p{S}]/u.test(password) &&
            !/[\r\n]/.test(password);
        if (strategyResult !== true || !hasRequiredComposition) {
            throw new UserInputError('密码至少 12 位，并同时包含字母、数字和符号');
        }
    }

    private async matchesCurrentPassword(
        ctx: RequestContext,
        userId: string | number,
        password: string,
    ): Promise<boolean> {
        const user = await this.connection
            .getRepository(ctx, User)
            .createQueryBuilder('user')
            .leftJoinAndSelect('user.authenticationMethods', 'authenticationMethod')
            .addSelect('authenticationMethod.passwordHash')
            .where('user.id = :userId', { userId })
            .getOne();
        const authenticationMethod = user?.getNativeAuthenticationMethod(false);
        return authenticationMethod
            ? this.passwordCipher.check(password, authenticationMethod.passwordHash)
            : false;
    }
}

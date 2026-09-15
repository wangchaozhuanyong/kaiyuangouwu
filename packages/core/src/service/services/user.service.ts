import { Injectable } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { VerifyCustomerAccountResult } from '@vendure/common/lib/generated-shop-types';
import { ID } from '@vendure/common/lib/shared-types';
import { SelectQueryBuilder } from 'typeorm';

import { RequestContext } from '../../api/common/request-context';
import { ErrorResultUnion, isGraphQlErrorResult } from '../../common/error/error-result';
import { EntityNotFoundError, InternalServerError, UserInputError } from '../../common/error/errors';
import {
    IdentifierChangeTokenExpiredError,
    IdentifierChangeTokenInvalidError,
    InvalidCredentialsError,
    MissingPasswordError,
    PasswordAlreadySetError,
    PasswordResetTokenExpiredError,
    PasswordResetTokenInvalidError,
    PasswordValidationError,
    VerificationTokenExpiredError,
    VerificationTokenInvalidError,
} from '../../common/error/generated-graphql-shop-errors';
import { Instrument } from '../../common/instrument-decorator';
import { assertFound, isEmailAddressLike, normalizeEmailAddress } from '../../common/utils';
import { ConfigService } from '../../config/config.service';
import { TransactionalConnection } from '../../connection/transactional-connection';
import { Role } from '../../entity';
import { NativeAuthenticationMethod } from '../../entity/authentication-method/native-authentication-method.entity';
import { Customer } from '../../entity/customer/customer.entity';
import { User } from '../../entity/user/user.entity';
import { PasswordCipher } from '../helpers/password-cipher/password-cipher';
import { VerificationTokenGenerator } from '../helpers/verification-token-generator/verification-token-generator';

import { RoleService } from './role.service';

/**
 * @description
 * Contains methods relating to {@link User} entities.
 *
 * @docsCategory services
 */
@Injectable()
@Instrument()
export class UserService {
    constructor(
        private connection: TransactionalConnection,
        private configService: ConfigService,
        private roleService: RoleService,
        private passwordCipher: PasswordCipher,
        private verificationTokenGenerator: VerificationTokenGenerator,
        private moduleRef: ModuleRef,
    ) {}

    async getUserById(ctx: RequestContext, userId: ID): Promise<User | undefined> {
        return this.connection
            .getRepository(ctx, User)
            .findOne({
                where: { id: userId },
                relations: {
                    roles: {
                        channels: true,
                    },
                    authenticationMethods: true,
                },
            })
            .then(result => result ?? undefined);
    }

    async getUserByEmailAddress(
        ctx: RequestContext,
        emailAddress: string,
        userType?: 'administrator' | 'customer',
    ): Promise<User | undefined> {
        const entity = userType ?? (ctx.apiType === 'admin' ? 'administrator' : 'customer');

        const qb = this.connection
            .getRepository(ctx, User)
            .createQueryBuilder('user')
            .leftJoinAndSelect('user.roles', 'roles')
            .leftJoinAndSelect('roles.channels', 'channels')
            .leftJoinAndSelect('user.authenticationMethods', 'authenticationMethods')
            .where('user.deletedAt IS NULL');

        if (entity === 'customer') {
            qb.innerJoin(Customer, 'customer', 'customer.userId = user.id').andWhere(
                'customer.deletedAt IS NULL',
            );
        } else {
            const table = `${this.configService.dbConnectionOptions.entityPrefix ?? ''}administrator`;
            qb.innerJoin(table, table, `${table}.userId = user.id`);
        }

        if (isEmailAddressLike(emailAddress)) {
            qb.andWhere('LOWER(user.identifier) = :identifier', {
                identifier: normalizeEmailAddress(emailAddress),
            });
        } else {
            qb.andWhere('user.identifier = :identifier', {
                identifier: emailAddress,
            });
        }
        const candidates = await qb.take(2).getMany();
        if (candidates.length > 1) {
            throw new UserInputError('账号存在重复身份记录，请联系平台核实');
        }
        return candidates[0];
    }

    /**
     * @description
     * Creates a new User with the special `customer` Role and using the {@link NativeAuthenticationStrategy}.
     */
    async createCustomerUser(
        ctx: RequestContext,
        identifier: string,
        password?: string,
    ): Promise<User | PasswordValidationError> {
        const user = new User();
        user.identifier = normalizeEmailAddress(identifier);
        user.customerIdentifier = user.identifier;
        const customerRole = await this.roleService.getCustomerRole(ctx);
        user.roles = [customerRole];
        const addNativeAuthResult = await this.addNativeAuthenticationMethod(ctx, user, identifier, password);
        if (isGraphQlErrorResult(addNativeAuthResult)) {
            return addNativeAuthResult;
        }
        return this.connection.getRepository(ctx, User).save(addNativeAuthResult);
    }

    /**
     * @description
     * Adds a new {@link NativeAuthenticationMethod} to the User. If the {@link AuthOptions} `requireVerification`
     * is set to `true` (as is the default), the User will be marked as unverified until the email verification
     * flow is completed.
     */
    async addNativeAuthenticationMethod(
        ctx: RequestContext,
        user: User,
        identifier: string,
        password?: string,
    ): Promise<User | PasswordValidationError> {
        const checkUser = user.id != null && (await this.getUserById(ctx, user.id));
        if (checkUser) {
            if (
                !!checkUser.authenticationMethods.find(
                    (m): m is NativeAuthenticationMethod => m instanceof NativeAuthenticationMethod,
                )
            ) {
                // User already has a NativeAuthenticationMethod registered, so just return.
                return user;
            }
        }
        const authenticationMethod = new NativeAuthenticationMethod();
        if (this.configService.authOptions.requireVerification) {
            authenticationMethod.verificationToken =
                await this.verificationTokenGenerator.generateVerificationToken(ctx);
            user.verified = false;
        } else {
            user.verified = true;
        }
        if (password) {
            const passwordValidationResult = await this.validatePassword(ctx, password);
            if (passwordValidationResult !== true) {
                return passwordValidationResult;
            }
            authenticationMethod.passwordHash = await this.passwordCipher.hash(password);
        } else {
            authenticationMethod.passwordHash = '';
        }
        authenticationMethod.identifier = normalizeEmailAddress(identifier);
        authenticationMethod.user = user;
        await this.connection.getRepository(ctx, NativeAuthenticationMethod).save(authenticationMethod);
        user.authenticationMethods = [...(user.authenticationMethods ?? []), authenticationMethod];
        return user;
    }

    /**
     * @description
     * Creates a new verified User using the {@link NativeAuthenticationStrategy}.
     */
    async createAdminUser(ctx: RequestContext, identifier: string, password: string): Promise<User> {
        const user = new User({
            identifier: normalizeEmailAddress(identifier),
            verified: true,
        });
        const authenticationMethod = await this.connection
            .getRepository(ctx, NativeAuthenticationMethod)
            .save(
                new NativeAuthenticationMethod({
                    identifier: normalizeEmailAddress(identifier),
                    passwordHash: await this.passwordCipher.hash(password),
                }),
            );
        user.authenticationMethods = [authenticationMethod];
        return this.connection.getRepository(ctx, User).save(user);
    }

    /**
     * @description
     * Creates a new User which will be responsible for the permissions of an API-Key.
     *
     * IMPORTANT: The caller is responsible for avoiding privilege escalations!
     */
    async createApiKeyUser(ctx: RequestContext, roles: Role[], identifier: string): Promise<User> {
        const newUser = await this.connection.getRepository(ctx, User).save(new User({ identifier, roles }));

        const userWithRelations = await assertFound(
            this.connection.getRepository(ctx, User).findOne({
                where: { id: newUser.id },
                // ApiKeyUsers generally require roles and their channels, its important for sessions!
                relations: { roles: { channels: true } },
            }),
        );

        return userWithRelations;
    }

    async softDelete(ctx: RequestContext, userId: ID) {
        await this.deleteSessionsByUser(ctx, new User({ id: userId }));
        await this.connection.getEntityOrThrow(ctx, User, userId);
        await this.connection
            .getRepository(ctx, User)
            .update({ id: userId }, { deletedAt: new Date(), customerIdentifier: null });
    }

    /**
     * @description
     * Sets the {@link NativeAuthenticationMethod} `verificationToken` as part of the User email verification
     * flow.
     */
    async setVerificationToken(ctx: RequestContext, user: User): Promise<User> {
        return this.connection.withTransaction(ctx, async txCtx => {
            const current = await this.lockActiveUser(txCtx, user.id);
            if (!current) throw new EntityNotFoundError('User', user.id);
            user.verified = current.verified;
            if (current.verified) return user;
            const nativeAuthMethod = user.getNativeAuthenticationMethod();
            nativeAuthMethod.verificationToken =
                await this.verificationTokenGenerator.generateVerificationToken(txCtx);
            await this.connection
                .getRepository(txCtx, NativeAuthenticationMethod)
                .update(nativeAuthMethod.id, {
                    verificationToken: nativeAuthMethod.verificationToken,
                });
            return user;
        });
    }

    /**
     * @description
     * Verifies a verificationToken by looking for a User which has previously had it set using the
     * `setVerificationToken()` method, and checks that the token is valid and has not expired.
     *
     * If valid, the User will be set to `verified: true`.
     */
    async verifyUserByToken(
        ctx: RequestContext,
        verificationToken: string,
        password?: string,
    ): Promise<ErrorResultUnion<VerifyCustomerAccountResult, User>> {
        return this.connection.withTransaction(ctx, txCtx =>
            this.verifyUserByTokenInTransaction(txCtx, verificationToken, password),
        );
    }

    private async verifyUserByTokenInTransaction(
        ctx: RequestContext,
        verificationToken: string,
        password?: string,
    ): Promise<ErrorResultUnion<VerifyCustomerAccountResult, User>> {
        const query = this.connection
            .getRepository(ctx, User)
            .createQueryBuilder('user')
            .leftJoinAndSelect('user.authenticationMethods', 'aums')
            .leftJoin('user.authenticationMethods', 'authenticationMethod')
            .addSelect('aums.passwordHash')
            .where('authenticationMethod.verificationToken = :verificationToken', { verificationToken });
        const user = await this.scopeShopCustomerQuery(ctx, query).getOne();
        if (user) {
            const isTokenValid = await this.verificationTokenGenerator.verifyVerificationToken(
                ctx,
                verificationToken,
            );
            if (isTokenValid) {
                const nativeAuthMethod = user.getNativeAuthenticationMethod();
                if (!password) {
                    if (!nativeAuthMethod.passwordHash) {
                        return new MissingPasswordError();
                    }
                } else {
                    if (!!nativeAuthMethod.passwordHash) {
                        return new PasswordAlreadySetError();
                    }
                    const passwordValidationResult = await this.validatePassword(ctx, password);
                    if (passwordValidationResult !== true) {
                        return passwordValidationResult;
                    }
                    nativeAuthMethod.passwordHash = await this.passwordCipher.hash(password);
                }
                if (
                    !(await this.consumeNativeToken(
                        ctx,
                        user.id,
                        nativeAuthMethod.id,
                        'verificationToken',
                        verificationToken,
                        {
                            passwordHash: nativeAuthMethod.passwordHash,
                        },
                    ))
                )
                    return new VerificationTokenInvalidError();
                nativeAuthMethod.verificationToken = null;
                user.verified = true;
                await this.connection.getRepository(ctx, User).update(user.id, { verified: true });
                return user;
            } else {
                return new VerificationTokenExpiredError();
            }
        } else {
            return new VerificationTokenInvalidError();
        }
    }

    /**
     * @description
     * Sets the {@link NativeAuthenticationMethod} `passwordResetToken` as part of the User password reset
     * flow.
     */
    async setPasswordResetToken(ctx: RequestContext, emailAddress: string): Promise<User | undefined> {
        const user = await this.getUserByEmailAddress(ctx, emailAddress);
        if (!user) {
            return;
        }
        const nativeAuthMethod = user.getNativeAuthenticationMethod(false);
        if (!nativeAuthMethod) {
            return undefined;
        }
        nativeAuthMethod.passwordResetToken =
            await this.verificationTokenGenerator.generateVerificationToken(ctx);
        await this.connection.getRepository(ctx, NativeAuthenticationMethod).update(nativeAuthMethod.id, {
            passwordResetToken: nativeAuthMethod.passwordResetToken,
        });
        return user;
    }

    /**
     * @description
     * Verifies a passwordResetToken by looking for a User which has previously had it set using the
     * `setPasswordResetToken()` method, and checks that the token is valid and has not expired.
     *
     * If valid, the User's credentials will be updated with the new password.
     */
    async resetPasswordByToken(
        ctx: RequestContext,
        passwordResetToken: string,
        password: string,
    ): Promise<
        User | PasswordResetTokenExpiredError | PasswordResetTokenInvalidError | PasswordValidationError
    > {
        return this.connection.withTransaction(ctx, txCtx =>
            this.resetPasswordByTokenInTransaction(txCtx, passwordResetToken, password),
        );
    }

    private async resetPasswordByTokenInTransaction(
        ctx: RequestContext,
        passwordResetToken: string,
        password: string,
    ): ReturnType<UserService['resetPasswordByToken']> {
        const query = this.connection
            .getRepository(ctx, User)
            .createQueryBuilder('user')
            .leftJoinAndSelect('user.authenticationMethods', 'aums')
            .leftJoin('user.authenticationMethods', 'authenticationMethod')
            .where('authenticationMethod.passwordResetToken = :passwordResetToken', { passwordResetToken });
        const user = await this.scopeShopCustomerQuery(ctx, query).getOne();
        if (!user) {
            return new PasswordResetTokenInvalidError();
        }
        const passwordValidationResult = await this.validatePassword(ctx, password);
        if (passwordValidationResult !== true) {
            return passwordValidationResult;
        }

        const isTokenValid = await this.verificationTokenGenerator.verifyVerificationToken(
            ctx,
            passwordResetToken,
        );

        if (isTokenValid) {
            const nativeAuthMethod = user.getNativeAuthenticationMethod();
            nativeAuthMethod.passwordHash = await this.passwordCipher.hash(password);
            if (
                !(await this.consumeNativeToken(
                    ctx,
                    user.id,
                    nativeAuthMethod.id,
                    'passwordResetToken',
                    passwordResetToken,
                    {
                        passwordHash: nativeAuthMethod.passwordHash,
                        verificationToken: null,
                    },
                ))
            )
                return new PasswordResetTokenInvalidError();
            nativeAuthMethod.passwordResetToken = null;
            if (user.verified === false && this.configService.authOptions.requireVerification) {
                // This code path represents an edge-case in which the Customer creates an account,
                // but prior to verifying their email address, they start the password reset flow.
                // Since the password reset flow makes the exact same guarantee as the email verification
                // flow (i.e. the person controls the specified email account), we can also consider it
                // a verification.
                user.verified = true;
            }
            await this.connection.getRepository(ctx, User).update(user.id, { verified: user.verified });
            await this.deleteSessionsByUser(ctx, user);
            return user;
        } else {
            return new PasswordResetTokenExpiredError();
        }
    }

    /**
     * @description
     * Changes the User identifier without an email verification step, so this should be only used when
     * an Administrator is setting a new email address.
     */
    async changeUserAndNativeIdentifier(ctx: RequestContext, userId: ID, newIdentifier: string) {
        newIdentifier = normalizeEmailAddress(newIdentifier);
        const user = await this.getUserById(ctx, userId);
        if (!user) {
            return;
        }
        const nativeAuthMethod = user.authenticationMethods.find(
            (m): m is NativeAuthenticationMethod => m instanceof NativeAuthenticationMethod,
        );
        if (nativeAuthMethod) {
            nativeAuthMethod.identifier = newIdentifier;
            nativeAuthMethod.identifierChangeToken = null;
            nativeAuthMethod.pendingIdentifier = null;
            await this.connection.getRepository(ctx, NativeAuthenticationMethod).update(nativeAuthMethod.id, {
                identifier: newIdentifier,
                identifierChangeToken: null,
                pendingIdentifier: null,
                passwordResetToken: null,
                verificationToken: null,
            });
        }
        user.identifier = newIdentifier;
        if (await this.connection.getRepository(ctx, Customer).exists({ where: { user: { id: user.id } } })) {
            user.customerIdentifier = newIdentifier;
        }
        await this.connection.getRepository(ctx, User).save(user, { reload: false });
    }

    /**
     * @description
     * Sets the {@link NativeAuthenticationMethod} `identifierChangeToken` as part of the User email address change
     * flow.
     */
    async setIdentifierChangeToken(ctx: RequestContext, user: User): Promise<User> {
        const nativeAuthMethod = user.getNativeAuthenticationMethod();
        nativeAuthMethod.identifierChangeToken =
            await this.verificationTokenGenerator.generateVerificationToken(ctx);
        await this.connection.getRepository(ctx, NativeAuthenticationMethod).update(nativeAuthMethod.id, {
            identifierChangeToken: nativeAuthMethod.identifierChangeToken,
            pendingIdentifier: nativeAuthMethod.pendingIdentifier,
        });
        return user;
    }

    /**
     * @description
     * Changes the User identifier as part of the storefront flow used by Customers to set a
     * new email address, with the token previously set using the `setIdentifierChangeToken()` method.
     */
    async changeIdentifierByToken(
        ctx: RequestContext,
        token: string,
    ): Promise<
        | { user: User; oldIdentifier: string }
        | IdentifierChangeTokenInvalidError
        | IdentifierChangeTokenExpiredError
    > {
        return this.connection.withTransaction(ctx, txCtx =>
            this.changeIdentifierByTokenInTransaction(txCtx, token),
        );
    }

    private async changeIdentifierByTokenInTransaction(
        ctx: RequestContext,
        token: string,
    ): ReturnType<UserService['changeIdentifierByToken']> {
        const query = this.connection
            .getRepository(ctx, User)
            .createQueryBuilder('user')
            .leftJoinAndSelect('user.authenticationMethods', 'aums')
            .leftJoin('user.authenticationMethods', 'authenticationMethod')
            .where('authenticationMethod.identifierChangeToken = :identifierChangeToken', {
                identifierChangeToken: token,
            });
        const user = await this.scopeShopCustomerQuery(ctx, query).getOne();
        if (!user) {
            return new IdentifierChangeTokenInvalidError();
        }
        const isTokenValid = await this.verificationTokenGenerator.verifyVerificationToken(ctx, token);

        if (!isTokenValid) {
            return new IdentifierChangeTokenExpiredError();
        }
        const nativeAuthMethod = user.getNativeAuthenticationMethod();
        const pendingIdentifier = nativeAuthMethod.pendingIdentifier;
        if (!pendingIdentifier) {
            throw new InternalServerError('error.pending-identifier-missing');
        }
        if (
            !(await this.consumeNativeToken(
                ctx,
                user.id,
                nativeAuthMethod.id,
                'identifierChangeToken',
                token,
                {
                    identifier: pendingIdentifier,
                    pendingIdentifier: null,
                    passwordResetToken: null,
                    verificationToken: null,
                },
            ))
        )
            return new IdentifierChangeTokenInvalidError();
        const oldIdentifier = user.identifier;
        user.identifier = pendingIdentifier;
        // This verified-token flow is scoped to Customer identities on the Shop API.
        if (
            ctx.apiType === 'shop' ||
            (await this.connection.getRepository(ctx, Customer).exists({ where: { user: { id: user.id } } }))
        ) {
            user.customerIdentifier = normalizeEmailAddress(pendingIdentifier);
        }
        nativeAuthMethod.identifier = pendingIdentifier;
        nativeAuthMethod.identifierChangeToken = null;
        nativeAuthMethod.pendingIdentifier = null;
        await this.connection.getRepository(ctx, User).update(user.id, {
            identifier: user.identifier,
            customerIdentifier: user.customerIdentifier,
        });
        return { user, oldIdentifier };
    }

    private async lockActiveUser(ctx: RequestContext, userId: ID): Promise<User | null> {
        const query = this.connection
            .getRepository(ctx, User)
            .createQueryBuilder('tokenUser')
            .where('tokenUser.id = :userId AND tokenUser.deletedAt IS NULL', { userId });
        if (
            ['mysql', 'mariadb', 'postgres', 'aurora-mysql', 'aurora-postgres'].includes(
                this.connection.rawConnection.options.type,
            )
        ) {
            query.setLock('pessimistic_write');
        }
        return query.getOne();
    }

    /** One transaction can consume a token; concurrent/replayed requests never replace its result. */
    private async consumeNativeToken(
        ctx: RequestContext,
        userId: ID,
        methodId: ID,
        field: 'verificationToken' | 'passwordResetToken' | 'identifierChangeToken',
        token: string,
        changes: Partial<
            Pick<
                NativeAuthenticationMethod,
                | 'passwordHash'
                | 'identifier'
                | 'pendingIdentifier'
                | 'verificationToken'
                | 'passwordResetToken'
            >
        >,
    ): Promise<boolean> {
        if (!(await this.lockActiveUser(ctx, userId))) return false;
        const result = await this.connection
            .getRepository(ctx, NativeAuthenticationMethod)
            .update({ id: methodId, [field]: token }, { ...changes, [field]: null });
        return result.affected === 1;
    }

    /**
     * @description
     * Updates the password for a User with the {@link NativeAuthenticationMethod}.
     */
    async updatePassword(
        ctx: RequestContext,
        userId: ID,
        currentPassword: string,
        newPassword: string,
    ): Promise<boolean | InvalidCredentialsError | PasswordValidationError> {
        const user = await this.connection
            .getRepository(ctx, User)
            .createQueryBuilder('user')
            .leftJoinAndSelect('user.authenticationMethods', 'authenticationMethods')
            .addSelect('authenticationMethods.passwordHash')
            .where('user.id = :id', { id: userId })
            .getOne();
        if (!user) {
            throw new EntityNotFoundError('User', userId);
        }
        const password = newPassword;
        const passwordValidationResult = await this.validatePassword(ctx, password);
        if (passwordValidationResult !== true) {
            return passwordValidationResult;
        }
        const nativeAuthMethod = user.getNativeAuthenticationMethod();
        const matches = await this.passwordCipher.check(currentPassword, nativeAuthMethod.passwordHash);
        if (!matches) {
            return new InvalidCredentialsError({ authenticationError: '' });
        }
        nativeAuthMethod.passwordHash = await this.passwordCipher.hash(newPassword);
        nativeAuthMethod.passwordResetToken = null;
        await this.connection
            .getRepository(ctx, NativeAuthenticationMethod)
            .save(nativeAuthMethod, { reload: false });
        await this.deleteSessionsByUser(ctx, user);
        return true;
    }

    private async deleteSessionsByUser(ctx: RequestContext, user: User): Promise<void> {
        // Dynamic import to avoid the circular dependency of SessionService.
        await this.moduleRef
            .get((await import('./session.service.js')).SessionService)
            .deleteSessionsByUser(ctx, user);
    }

    /**
     * Customer account tokens are global, but cannot be used as Administrator tokens. Admin flows
     * create and verify users before the Customer relation exists, so they intentionally remain
     * unscoped here and are protected by Admin API permissions.
     */
    private scopeShopCustomerQuery(
        ctx: RequestContext,
        query: SelectQueryBuilder<User>,
    ): SelectQueryBuilder<User> {
        if (ctx.apiType !== 'shop') {
            return query;
        }
        return query
            .innerJoin(Customer, 'tokenCustomer', 'tokenCustomer.userId = user.id')
            .andWhere('tokenCustomer.deletedAt IS NULL')
            .andWhere('user.deletedAt IS NULL');
    }

    private async validatePassword(
        ctx: RequestContext,
        password: string,
    ): Promise<true | PasswordValidationError> {
        const passwordValidationResult =
            await this.configService.authOptions.passwordValidationStrategy.validate(ctx, password);
        if (passwordValidationResult !== true) {
            const message =
                typeof passwordValidationResult === 'string'
                    ? passwordValidationResult
                    : 'Password is invalid';
            return new PasswordValidationError({ validationErrorMessage: message });
        } else {
            return true;
        }
    }
}

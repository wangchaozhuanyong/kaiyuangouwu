// Load the entity graph before importing authentication subclasses.
import './user.service.js';

import { describe, expect, it, vi } from 'vitest';

import { RequestContext } from '../../api/common/request-context';
import { BcryptPasswordHashingStrategy } from '../../config/auth/bcrypt-password-hashing-strategy';
import { NativeAuthenticationStrategy } from '../../config/auth/native-authentication-strategy';
import { NativeAuthenticationMethod } from '../../entity/authentication-method/native-authentication-method.entity';
import { Customer } from '../../entity/customer/customer.entity';
import { CustomerHistoryEntry } from '../../entity/history-entry/customer-history-entry.entity';
import { User } from '../../entity/user/user.entity';
import { PasswordCipher } from '../helpers/password-cipher/password-cipher';

import { CustomerService } from './customer.service';
import { UserService } from './user.service';

function errorCode(result: unknown): unknown {
    return typeof result === 'object' && result && 'errorCode' in result ? result.errorCode : 'SUCCESS';
}

function requireValue<T>(value: T | null | undefined, label: string): T {
    if (value == null) {
        throw new Error(label);
    }
    return value;
}

function harness(requireVerification = true) {
    const ctx = { apiType: 'shop', channelId: 1 } as RequestContext;
    let user: User | undefined;
    let customer: Customer | undefined;
    let method: NativeAuthenticationMethod | undefined;
    let sequence = 0;
    let invalidPassword = false;
    let expired = false;
    let beforeLock: (() => void) | undefined;
    const claims: CustomerHistoryEntry[] = [];
    const publish = vi.fn().mockResolvedValue(undefined);
    const config: any = {
        authOptions: {
            requireVerification,
            passwordValidationStrategy: { validate: () => !invalidPassword },
            passwordHashingStrategy: new BcryptPasswordHashingStrategy(),
        },
    };
    const cipher = new PasswordCipher(config);
    const cloneUser = () =>
        user &&
        new User({
            ...user,
            authenticationMethods: method ? [new NativeAuthenticationMethod({ ...method })] : [],
        });
    const repo = (_ctx: RequestContext, entity: unknown): any => {
        if (entity === User)
            return {
                save: vi.fn((value: User) => {
                    value.id = 10;
                    user = value;
                    return Promise.resolve(value);
                }),
                findOne: vi.fn(() => Promise.resolve(cloneUser())),
                update: vi.fn((_id: unknown, values: any) => {
                    Object.assign(requireValue(user, 'Expected a seeded user'), values);
                    return Promise.resolve({ affected: 1 });
                }),
                createQueryBuilder: (alias: string) => {
                    let token: string | undefined;
                    const qb: any = {};
                    for (const name of [
                        'leftJoinAndSelect',
                        'leftJoin',
                        'innerJoin',
                        'andWhere',
                        'take',
                        'setLock',
                        'addSelect',
                    ])
                        qb[name] = () => qb;
                    qb.where = (_sql: string, params: any) => {
                        token = params?.verificationToken;
                        return qb;
                    };
                    qb.getMany = () => Promise.resolve(user ? [cloneUser()] : []);
                    qb.getOne = () => {
                        if (alias === 'tokenUser' && beforeLock) {
                            const change = beforeLock;
                            beforeLock = undefined;
                            change();
                        }
                        return Promise.resolve(
                            token && token !== method?.verificationToken ? undefined : cloneUser(),
                        );
                    };
                    return qb;
                },
            };
        if (entity === NativeAuthenticationMethod)
            return {
                save: vi.fn((value: NativeAuthenticationMethod) => {
                    value.id = 20;
                    method = value;
                    return Promise.resolve(value);
                }),
                findOne: vi.fn(() =>
                    Promise.resolve(method && new NativeAuthenticationMethod({ ...method })),
                ),
                update: vi.fn((criteria: any, values: any) => {
                    if (
                        typeof criteria === 'object' &&
                        Object.entries(criteria).some(([key, value]) => (method as any)?.[key] !== value)
                    )
                        return Promise.resolve({ affected: 0 });
                    Object.assign(requireValue(method, 'Expected a native authentication method'), values);
                    return Promise.resolve({ affected: 1 });
                }),
                createQueryBuilder: () => {
                    let token: string | undefined;
                    const qb: any = {};
                    for (const name of ['addSelect', 'setLock']) qb[name] = () => qb;
                    qb.where = (_sql: string, params: any) => {
                        token = params.verificationToken;
                        return qb;
                    };
                    qb.getOne = () =>
                        Promise.resolve(
                            method && (!token || method.verificationToken === token)
                                ? new NativeAuthenticationMethod({ ...method })
                                : undefined,
                        );
                    return qb;
                },
            };
        if (entity === Customer)
            return {
                findOne: vi.fn(() => Promise.resolve(customer)),
                save: vi.fn((value: Customer) => {
                    customer = value;
                    return Promise.resolve(value);
                }),
            };
        if (entity === CustomerHistoryEntry)
            return {
                save: (value: CustomerHistoryEntry) => {
                    value.createdAt = new Date();
                    claims.push(value);
                    return Promise.resolve(value);
                },
                createQueryBuilder: () => {
                    const qb: any = {};
                    for (const name of ['where', 'andWhere', 'orderBy', 'take', 'setLock'])
                        qb[name] = () => qb;
                    qb.getMany = () => Promise.resolve(claims.slice().reverse());
                    return qb;
                },
            };
        throw new Error('Unexpected test entity');
    };
    const connection: any = {
        rawConnection: { options: { type: 'mysql' } },
        getRepository: repo,
        withTransaction: async (context: RequestContext, work: (tx: RequestContext) => Promise<unknown>) =>
            work(context),
    };
    const users = new UserService(
        connection,
        config,
        { getCustomerRole: () => Promise.resolve({ id: 5, channels: [{ id: 1 }] }) } as never,
        cipher,
        {
            generateVerificationToken: () => Promise.resolve(String(++sequence)),
            verifyVerificationToken: () => Promise.resolve(!expired),
        } as never,
        {} as never,
    );
    const customers: CustomerService = Object.assign(Object.create(CustomerService.prototype), {
        connection,
        configService: config,
        userService: users,
        eventBus: { publish },
        historyService: { createHistoryEntryForCustomer: vi.fn().mockResolvedValue(undefined) },
        customerStoreEntryService: { recordRegistration: vi.fn().mockResolvedValue(undefined) },
        createOrUpdate: (_ctx: RequestContext, input: any) =>
            Promise.resolve((customer = new Customer({ id: 30, ...input }))),
        findOneByUserId: () => Promise.resolve(customer),
    });
    const native: NativeAuthenticationStrategy = Object.assign(
        Object.create(NativeAuthenticationStrategy.prototype),
        {
            connection,
            userService: users,
            passwordCipher: cipher,
        },
    );
    return {
        ctx,
        users,
        customers,
        native,
        publish,
        currentUser: () => requireValue(user, 'Expected a seeded user'),
        currentMethod: () => requireValue(method, 'Expected a native authentication method'),
        seedPending: async (password?: string) => {
            await users.createCustomerUser(ctx, 'owner@example.invalid', password);
            customer = new Customer({ id: 30, user });
        },
        ageClaims: () =>
            claims.forEach(claim => {
                claim.createdAt = new Date(Date.now() - 61_000);
            }),
        setInvalidPassword: () => {
            invalidPassword = true;
        },
        setExpired: () => {
            expired = true;
        },
        beforeLock: (change: () => void) => {
            beforeLock = change;
        },
    };
}

describe('Shop registration password ownership', () => {
    it('does not save a password submitted before mailbox ownership is proven', async () => {
        const test = harness();
        await expect(
            test.customers.registerCustomerAccount(test.ctx, {
                emailAddress: 'owner@example.invalid',
                password: 'synthetic-untrusted-password',
            }),
        ).resolves.toEqual({ success: true });
        expect(Boolean(test.currentMethod().passwordHash)).toBe(false);
        expect(test.currentUser().verified).toBe(false);
    });

    it('requires the mailbox owner to replace a legacy pending password and rejects the first registrant password', async () => {
        const test = harness();
        const oldPassword = 'synthetic-first-registrant-password';
        const ownerPassword = 'synthetic-mailbox-owner-password';
        await test.seedPending(oldPassword);
        await test.customers.registerCustomerAccount(test.ctx, {
            emailAddress: 'owner@example.invalid',
            password: ownerPassword,
        });
        const proof = requireValue(test.currentMethod().verificationToken, 'Expected a verification token');
        const previousHash = test.currentMethod().passwordHash;
        expect(errorCode(await test.users.verifyUserByToken(test.ctx, proof))).toBe('MISSING_PASSWORD_ERROR');
        expect(test.currentUser().verified).toBe(false);
        expect(test.currentMethod().verificationToken === proof).toBe(true);
        expect(test.currentMethod().passwordHash === previousHash).toBe(true);
        expect('id' in (await test.users.verifyUserByToken(test.ctx, proof, ownerPassword))).toBe(true);
        expect(
            await test.native.authenticate(test.ctx, {
                username: 'owner@example.invalid',
                password: oldPassword,
            }),
        ).toBe(false);
        expect(
            Boolean(
                await test.native.authenticate(test.ctx, {
                    username: 'owner@example.invalid',
                    password: ownerPassword,
                }),
            ),
        ).toBe(true);
        expect(errorCode(await test.users.verifyUserByToken(test.ctx, proof, oldPassword))).toBe(
            'VERIFICATION_TOKEN_INVALID_ERROR',
        );
    });

    it('keeps the pending token and password unchanged for invalid passwords and expired tokens', async () => {
        const test = harness();
        await test.seedPending('synthetic-legacy-password');
        const proof = requireValue(test.currentMethod().verificationToken, 'Expected a verification token');
        const previousHash = test.currentMethod().passwordHash;
        test.setInvalidPassword();
        expect(errorCode(await test.users.verifyUserByToken(test.ctx, proof, 'invalid'))).toBe(
            'PASSWORD_VALIDATION_ERROR',
        );
        expect(test.currentMethod().verificationToken === proof).toBe(true);
        expect(test.currentMethod().passwordHash === previousHash).toBe(true);
        test.setExpired();
        expect(errorCode(await test.users.verifyUserByToken(test.ctx, proof))).toBe(
            'VERIFICATION_TOKEN_EXPIRED_ERROR',
        );
        expect(test.currentUser().verified).toBe(false);
    });

    it('rejects already verified state read under the user lock without changing its password', async () => {
        const test = harness();
        await test.seedPending('synthetic-legacy-password');
        const proof = requireValue(test.currentMethod().verificationToken, 'Expected a verification token');
        const previousHash = test.currentMethod().passwordHash;
        test.beforeLock(() => {
            test.currentUser().verified = true;
        });
        expect(
            errorCode(await test.users.verifyUserByToken(test.ctx, proof, 'synthetic-other-password')),
        ).toBe('VERIFICATION_TOKEN_INVALID_ERROR');
        expect(test.currentMethod().passwordHash === previousHash).toBe(true);
    });

    it('does not consume a token replaced by a resend before the account lock', async () => {
        const test = harness();
        await test.seedPending('synthetic-legacy-password');
        const proof = requireValue(test.currentMethod().verificationToken, 'Expected a verification token');
        const previousHash = test.currentMethod().passwordHash;
        test.beforeLock(() => {
            test.currentMethod().verificationToken = String(999);
        });
        expect(
            errorCode(await test.users.verifyUserByToken(test.ctx, proof, 'synthetic-other-password')),
        ).toBe('VERIFICATION_TOKEN_INVALID_ERROR');
        expect(test.currentMethod().verificationToken === proof).toBe(false);
        expect(test.currentMethod().passwordHash === previousHash).toBe(true);
        expect(test.currentUser().verified).toBe(false);
    });

    it('preserves Admin token-only verification and PasswordAlreadySet compatibility', async () => {
        const test = harness();
        await test.seedPending('synthetic-admin-created-password');
        const adminCtx = { ...test.ctx, apiType: 'admin' } as RequestContext;
        const proof = requireValue(test.currentMethod().verificationToken, 'Expected a verification token');
        expect(
            errorCode(await test.users.verifyUserByToken(adminCtx, proof, 'synthetic-other-password')),
        ).toBe('PASSWORD_ALREADY_SET_ERROR');
        expect('id' in (await test.users.verifyUserByToken(adminCtx, proof))).toBe(true);
    });

    it('preserves the password requirement and password authentication without email verification', async () => {
        const test = harness(false);
        expect(
            await test.customers.registerCustomerAccount(test.ctx, { emailAddress: 'owner@example.invalid' }),
        ).toMatchObject({ errorCode: 'MISSING_PASSWORD_ERROR' });
        const password = 'synthetic-no-verification-password';
        await test.customers.registerCustomerAccount(test.ctx, {
            emailAddress: 'owner@example.invalid',
            password,
        });
        expect(test.currentUser().verified).toBe(true);
        expect(
            Boolean(
                await test.native.authenticate(test.ctx, { username: 'owner@example.invalid', password }),
            ),
        ).toBe(true);
    });

    it('returns a new customer id only to the service caller that actually creates the account', async () => {
        const test = harness();
        const created = await test.customers.registerCustomerAccountWithOutcome(test.ctx, {
            emailAddress: 'owner@example.invalid',
        });
        expect(created).toEqual({ result: { success: true }, createdCustomerId: 30 });
        const duplicate = await test.customers.registerCustomerAccountWithOutcome(
            { ...test.ctx, channelId: 2 } as RequestContext,
            { emailAddress: 'owner@example.invalid', firstName: 'Untrusted overwrite' },
        );
        expect(duplicate).toEqual({ result: { success: true } });
        expect(
            await test.customers.registerCustomerAccount(test.ctx, { emailAddress: 'owner@example.invalid' }),
        ).toEqual({ success: true });
    });

    it('does not expose a created customer id for a losing unique-identity conflict', async () => {
        const test = harness();
        vi.spyOn(test.users, 'createCustomerUser').mockRejectedValue({
            code: 'ER_DUP_ENTRY',
            message: 'IDX_user_customer_identifier',
        });
        expect(
            await test.customers.registerCustomerAccountWithOutcome(test.ctx, {
                emailAddress: 'owner@example.invalid',
            }),
        ).toEqual({ result: { success: true } });
    });
});

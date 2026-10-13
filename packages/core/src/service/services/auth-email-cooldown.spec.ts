// Initialize the entity graph before loading authentication subclasses.
import './user.service.js';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { RequestContext } from '../../api/common/request-context';
import { ShopAuthResolver } from '../../api/resolvers/shop/shop-auth.resolver';
import { NativeAuthenticationMethod } from '../../entity/authentication-method/native-authentication-method.entity';
import { Customer } from '../../entity/customer/customer.entity';
import { CustomerHistoryEntry } from '../../entity/history-entry/customer-history-entry.entity';
import { User } from '../../entity/user/user.entity';

import { CustomerService } from './customer.service';
import { UserService } from './user.service';

function harness() {
    const ctx = { apiType: 'shop', channelId: 1 } as RequestContext;
    const method = new NativeAuthenticationMethod({
        id: 20,
        identifier: 'customer@example.invalid',
        passwordResetToken: 'previous-reset',
        verificationToken: 'previous-verification',
    });
    const user = new User({
        id: 10,
        identifier: 'Customer@Example.Invalid',
        verified: false,
        authenticationMethods: [method],
        roles: [],
    });
    const customer = new Customer({ id: 30, user });
    const claims: CustomerHistoryEntry[] = [];
    const locks: Array<{ alias: string; mode: string }> = [];
    let mutex = Promise.resolve();
    let issued = 0;
    let missing = false;
    const cloneUser = () =>
        new User({ ...user, authenticationMethods: [new NativeAuthenticationMethod({ ...method })] });
    const repository = (context: any, entity: unknown): any => {
        if (entity === NativeAuthenticationMethod)
            return {
                update: vi.fn((_id: unknown, values: any) => {
                    Object.assign(method, values);
                    return Promise.resolve({ affected: 1 });
                }),
            };
        if (entity === Customer) return { findOne: vi.fn(() => Promise.resolve(missing ? null : customer)) };
        if (entity === User)
            return {
                findOne: vi.fn(() => Promise.resolve(missing ? null : cloneUser())),
                createQueryBuilder: (alias: string) => {
                    const qb: any = {};
                    for (const name of ['leftJoinAndSelect', 'innerJoin', 'where', 'andWhere', 'take'])
                        qb[name] = () => qb;
                    qb.setLock = (mode: string) => {
                        locks.push({ alias, mode });
                        return qb;
                    };
                    qb.getMany = () => Promise.resolve(missing ? [] : [cloneUser()]);
                    qb.getOne = async () => {
                        if (alias === 'tokenUser') {
                            const previous = mutex;
                            mutex = new Promise<void>(resolve => {
                                context.releaseLock = resolve;
                            });
                            await previous;
                        }
                        return missing ? null : cloneUser();
                    };
                    return qb;
                },
            };
        if (entity === CustomerHistoryEntry)
            return {
                save: (claim: CustomerHistoryEntry) => {
                    claim.createdAt = new Date();
                    claims.push(claim);
                    return Promise.resolve(claim);
                },
                createQueryBuilder: (alias: string) => {
                    let key = '';
                    let cutoff = new Date(0);
                    const qb: any = {
                        where: () => qb,
                        andWhere: (_sql: string, parameters: any) => {
                            if (parameters.requestKey) key = parameters.requestKey.slice(1, -1);
                            if (parameters.cutoff) cutoff = parameters.cutoff;
                            return qb;
                        },
                        orderBy: () => qb,
                        take: () => qb,
                        setLock: (mode: string) => {
                            locks.push({ alias, mode });
                            return qb;
                        },
                        getMany: () =>
                            Promise.resolve(
                                claims
                                    .filter(
                                        claim =>
                                            JSON.stringify(claim.data).includes(key) &&
                                            claim.createdAt > cutoff,
                                    )
                                    .reverse()
                                    .slice(0, 5),
                            ),
                    };
                    return qb;
                },
            };
        throw new Error('Unexpected fixture entity');
    };
    const connection = {
        rawConnection: { options: { type: 'mysql' } },
        getRepository: repository,
        withTransaction: async (context: RequestContext, work: (tx: RequestContext) => Promise<unknown>) => {
            const tx: any = { ...context };
            try {
                return await work(tx);
            } finally {
                tx.releaseLock?.();
            }
        },
    };
    const generateVerificationToken = vi.fn(() => Promise.resolve(`synthetic-token-${++issued}`));
    const newUserService = () =>
        new UserService(
            connection as never,
            {} as never,
            {} as never,
            {} as never,
            { generateVerificationToken } as never,
            {} as never,
        );
    const users = newUserService();
    const publish = vi.fn().mockResolvedValue(undefined);
    const historyEntry = vi.fn().mockResolvedValue(undefined);
    const customers: CustomerService = Object.assign(Object.create(CustomerService.prototype), {
        connection,
        userService: users,
        configService: { authOptions: { requireVerification: true } },
        eventBus: { publish },
        historyService: { createHistoryEntryForCustomer: historyEntry },
        findOneByUserId: vi.fn(() => Promise.resolve(missing ? undefined : customer)),
    });
    const resolver: ShopAuthResolver = Object.assign(Object.create(ShopAuthResolver.prototype), {
        customerService: customers,
        requireNativeAuthStrategy: () => undefined,
    });
    return {
        ctx,
        method,
        user,
        claims,
        locks,
        users,
        customers,
        resolver,
        publish,
        generateVerificationToken,
        newUserService,
        setMissing: (value: boolean) => {
            missing = value;
        },
    };
}

afterEach(() => vi.useRealTimers());

describe('persistent authentication email cooldown', () => {
    it('generates one reset and event across concurrent API instances and channel aliases', async () => {
        const test = harness();
        const instances = [test.users, test.newUserService(), test.newUserService()].map(
            userService =>
                Object.assign(Object.create(CustomerService.prototype), test.customers, {
                    userService,
                }) as CustomerService,
        );
        await Promise.all(
            Array.from({ length: 12 }, (_, index) =>
                instances[index % 3].requestPasswordReset(
                    { ...test.ctx, channelId: (index % 2) + 1 } as RequestContext,
                    index % 2 ? 'CUSTOMER@example.invalid' : 'customer@example.invalid',
                ),
            ),
        );
        expect(test.publish).toHaveBeenCalledTimes(1);
        expect(test.generateVerificationToken).toHaveBeenCalledTimes(1);
        expect(test.claims).toHaveLength(1);
        expect(test.method.passwordResetToken).toBe('synthetic-token-1');
        expect(test.locks).toContainEqual({ alias: 'tokenUser', mode: 'pessimistic_write' });
        expect(test.locks).toContainEqual({ alias: 'history', mode: 'pessimistic_read' });
        expect(test.claims[0].isPublic).toBe(false);
        expect(JSON.stringify(test.claims[0].data)).not.toContain('example.invalid');
        expect(JSON.stringify(test.claims[0].data)).not.toContain('synthetic-token');
    });
    it('does not overwrite the working reset link or send another email during the minute', async () => {
        const test = harness();
        await test.customers.requestPasswordReset(test.ctx, 'customer@example.invalid');
        await test.customers.requestPasswordReset(test.ctx, 'CUSTOMER@example.invalid');
        expect(test.publish).toHaveBeenCalledTimes(1);
        expect(test.method.passwordResetToken).toBe('synthetic-token-1');
        expect(test.generateVerificationToken).toHaveBeenCalledTimes(1);
    });
    it('shares verification budget across repeated registration and refresh without replacing its link', async () => {
        const test = harness();
        await test.customers.refreshVerificationToken(test.ctx, 'customer@example.invalid');
        await test.customers.registerCustomerAccount(test.ctx, {
            emailAddress: 'CUSTOMER@example.invalid',
            firstName: 'must not alter owner',
            lastName: '',
        });
        await test.customers.refreshVerificationToken(test.ctx, 'customer@example.invalid');
        expect(test.publish).toHaveBeenCalledTimes(1);
        expect(test.method.verificationToken).toBe('synthetic-token-1');
        expect(test.generateVerificationToken).toHaveBeenCalledTimes(1);
    });
    it('keeps independent verification/reset budgets and caps each at five requests per rolling hour', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-10-13T03:00:00Z'));
        const test = harness();
        for (let attempt = 0; attempt < 5; attempt++) {
            await expect(
                test.users.setPasswordResetToken(test.ctx, 'customer@example.invalid'),
            ).resolves.toBeDefined();
            vi.setSystemTime(new Date(Date.now() + 61_000));
        }
        await expect(
            test.users.setPasswordResetToken(test.ctx, 'customer@example.invalid'),
        ).resolves.toBeUndefined();
        await expect(test.users.setVerificationTokenIfAllowed(test.ctx, test.user)).resolves.toBeDefined();
        expect(test.generateVerificationToken).toHaveBeenCalledTimes(6);
        vi.setSystemTime(new Date('2026-10-13T04:00:01Z'));
        await expect(
            test.users.setPasswordResetToken(test.ctx, 'customer@example.invalid'),
        ).resolves.toBeDefined();
    });
    it('returns identical public success for sent, cooled-down and nonexistent accounts', async () => {
        const test = harness();
        const first = await test.resolver.requestPasswordReset(test.ctx, {
            emailAddress: 'customer@example.invalid',
        });
        const cooled = await test.resolver.requestPasswordReset(test.ctx, {
            emailAddress: 'CUSTOMER@example.invalid',
        });
        test.setMissing(true);
        const missing = await test.resolver.requestPasswordReset(test.ctx, {
            emailAddress: 'absent@example.invalid',
        });
        expect([first, cooled, missing]).toEqual([{ success: true }, { success: true }, { success: true }]);
        expect(
            await test.resolver.refreshCustomerVerification(test.ctx, {
                emailAddress: 'absent@example.invalid',
            }),
        ).toEqual({ success: true });
        expect(test.publish).toHaveBeenCalledTimes(1);
    });
    it('does not attach native authentication or issue tokens for external-only accounts', async () => {
        const test = harness();
        test.user.authenticationMethods = [];
        // Model a user with no native method in the persistent identity lookup.
        vi.spyOn(test.users, 'getUserById').mockResolvedValue(
            new User({ ...test.user, authenticationMethods: [] }),
        );
        await expect(
            test.users.setPasswordResetToken(test.ctx, 'customer@example.invalid'),
        ).resolves.toBeUndefined();
        await expect(test.users.setVerificationTokenIfAllowed(test.ctx, test.user)).resolves.toBeUndefined();
        expect(test.generateVerificationToken).not.toHaveBeenCalled();
        expect(test.claims).toHaveLength(0);
    });
});

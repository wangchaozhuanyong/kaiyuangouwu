// Initialize the service's entity graph before loading authentication subclasses.
import './user.service.js';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { RequestContext } from '../../api/common/request-context';
import { Administrator } from '../../entity/administrator/administrator.entity';
import { NativeAuthenticationMethod } from '../../entity/authentication-method/native-authentication-method.entity';
import { AuthenticatedSession } from '../../entity/session/authenticated-session.entity';
import { User } from '../../entity/user/user.entity';

import { SessionService } from './session.service';
import { UserService } from './user.service';

function fixture() {
    const ctx = { activeUserId: 10, apiType: 'shop', channelId: 1 } as RequestContext;
    const method = new NativeAuthenticationMethod({
        passwordHash: 'synthetic-old-hash',
        passwordResetToken: 'synthetic-reset-token',
    });
    const user = new User({
        id: 10,
        identifier: 'customer@example.invalid',
        verified: true,
        roles: [],
        authenticationMethods: [method],
    });
    const other = new User({ id: 11, identifier: 'other@example.invalid', verified: true, roles: [] });
    const rows = new Map<string, AuthenticatedSession>();
    for (const [id, owner] of [
        [20, user],
        [21, user],
        [22, other],
    ] as const) {
        const token = `synthetic-session-${id}`;
        rows.set(
            token,
            new AuthenticatedSession({
                id,
                token,
                user: owner,
                authenticationStrategy: 'native',
                invalidated: false,
                expires: new Date(Date.now() + 86_400_000),
            }),
        );
    }
    const cache = new Map<string, ReturnType<SessionService['serializeSession']>>();
    const sessionCacheStrategy = {
        get: (token: string) => cache.get(token),
        set: (value: ReturnType<SessionService['serializeSession']>) => {
            cache.set(value.token, value);
        },
        delete: vi.fn((token: string) => {
            cache.delete(token);
        }),
    };
    const administratorUserIds = new Set<number>();
    const sessionRepository = {
        existsBy: vi.fn(({ id, token }: { id: number; token: string }) =>
            Promise.resolve(rows.get(token)?.id === id && rows.get(token)?.invalidated === false),
        ),
        update: vi.fn().mockResolvedValue({ affected: 1 }),
        find: vi.fn(({ where }: any) =>
            Promise.resolve([...rows.values()].filter(row => row.user.id === where.user.id)),
        ),
        remove: vi.fn((userSessions: AuthenticatedSession[]) => {
            for (const session of userSessions) rows.delete(session.token);
            return Promise.resolve();
        }),
        createQueryBuilder: () => {
            let token = '';
            const qb: any = {
                leftJoinAndSelect: () => qb,
                andWhere: () => qb,
                where: (_where: string, parameters: { token: string }) => {
                    token = parameters.token;
                    return qb;
                },
                getOne: () => Promise.resolve(rows.get(token) ?? null),
            };
            return qb;
        },
    };
    const query: any = {};
    for (const methodName of [
        'leftJoinAndSelect',
        'leftJoin',
        'innerJoin',
        'where',
        'andWhere',
        'addSelect',
        'setLock',
    ])
        query[methodName] = () => query;
    query.getOne = vi.fn().mockResolvedValue(user);
    const savePassword = vi.fn().mockResolvedValue(method);
    const userRepository = {
        createQueryBuilder: () => query,
        save: vi.fn().mockResolvedValue(user),
        update: vi.fn().mockResolvedValue({ affected: 1 }),
    };
    const connection = {
        withTransaction: (transactionCtx: RequestContext, work: (txCtx: RequestContext) => any) =>
            work(transactionCtx),
        getRepository: (_ctx: RequestContext, entity: unknown) =>
            entity === AuthenticatedSession
                ? sessionRepository
                : entity === NativeAuthenticationMethod
                  ? {
                        save: savePassword,
                        update: vi.fn().mockImplementation((_criteria: any, values: any) => {
                            Object.assign(method, values);
                            return Promise.resolve({ affected: 1 });
                        }),
                    }
                  : userRepository,
        rawConnection: {
            subscribers: [],
            getRepository: (entity: unknown) =>
                entity === Administrator
                    ? {
                          existsBy: ({ user: { id } }: { user: { id: number } }) =>
                              Promise.resolve(administratorUserIds.has(id)),
                      }
                    : sessionRepository,
            options: { type: 'sqljs' },
        },
    };
    const validate = vi.fn().mockReturnValue(true);
    const config = {
        authOptions: {
            requireVerification: true,
            passwordValidationStrategy: { validate },
            sessionCacheStrategy,
            sessionCacheTTL: 300,
            sessionDuration: '1y',
        },
    };
    const sessions = new SessionService(connection as any, config as any, {} as any, {} as any, {} as any);
    for (const row of rows.values()) cache.set(row.token, sessions.serializeSession(row, null));
    const checkPassword = vi.fn().mockResolvedValue(true);
    const verifyToken = vi.fn().mockResolvedValue(true);
    const service = new UserService(
        connection as any,
        config as any,
        {} as any,
        { hash: () => Promise.resolve('synthetic-new-hash'), check: checkPassword } as any,
        { verifyVerificationToken: verifyToken } as any,
        { get: () => sessions } as any,
    );
    return {
        ctx,
        method,
        service,
        sessions,
        rows,
        cache,
        query,
        validate,
        verifyToken,
        checkPassword,
        savePassword,
        sessionCacheStrategy,
        sessionRepository,
        administratorUserIds,
    };
}

describe('UserService password change revokes sessions (F-02)', () => {
    it('rejects a revoked session retained in another API instance cache', async () => {
        const x = fixture();
        const staleSession = x.cache.get('synthetic-session-20');
        if (!staleSession) throw new Error('Expected a cached customer session');
        await x.service.resetPasswordByToken(x.ctx, 'synthetic-reset-token', 'synthetic-new-password');
        x.cache.set(staleSession.token, staleSession);
        expect(await x.sessions.getSessionFromToken(staleSession.token)).toBeUndefined();
    });
    it('reset revokes all previous devices in both the cache and database, leaving other users alone', async () => {
        const x = fixture();
        await expect(
            x.service.resetPasswordByToken(x.ctx, 'synthetic-reset-token', 'synthetic-new-password'),
        ).resolves.toMatchObject({ id: 10 });
        expect(x.method.passwordHash).toBe('synthetic-new-hash');
        expect(x.method.passwordResetToken).toBeNull();
        for (const token of ['synthetic-session-20', 'synthetic-session-21']) {
            expect(x.cache.has(token)).toBe(false);
            expect(x.rows.has(token)).toBe(false);
            expect(await x.sessions.getSessionFromToken(token)).toBeUndefined();
        }
        expect(await x.sessions.getSessionFromToken('synthetic-session-22')).toMatchObject({
            user: { id: 11 },
        });
    });

    it('normal password change also revokes prior devices and any outstanding reset token', async () => {
        const x = fixture();
        await expect(
            x.service.updatePassword(x.ctx, 10, 'synthetic-old-password', 'synthetic-new-password'),
        ).resolves.toBe(true);
        expect(x.method.passwordResetToken).toBeNull();
        for (const token of ['synthetic-session-20', 'synthetic-session-21']) {
            expect(x.cache.has(token)).toBe(false);
            expect(await x.sessions.getSessionFromToken(token)).toBeUndefined();
        }
        expect(x.rows.has('synthetic-session-22')).toBe(true);
    });

    it('does not let a revoked session return through a fresh database lookup', async () => {
        const x = fixture();
        x.cache.clear();
        await x.service.resetPasswordByToken(x.ctx, 'synthetic-reset-token', 'synthetic-new-password');
        expect(await x.sessions.getSessionFromToken('synthetic-session-20')).toBeUndefined();
        expect(await x.sessions.getSessionFromToken('synthetic-session-22')).toMatchObject({
            user: { id: 11 },
        });
    });

    it('keeps existing sessions when the old password is incorrect', async () => {
        const x = fixture();
        x.checkPassword.mockResolvedValueOnce(false);
        await expect(
            x.service.updatePassword(x.ctx, 10, 'incorrect-password', 'synthetic-new-password'),
        ).resolves.toMatchObject({ __typename: 'InvalidCredentialsError' });
        expect(x.savePassword).not.toHaveBeenCalled();
        expect(x.sessionRepository.remove).not.toHaveBeenCalled();
        expect(await x.sessions.getSessionFromToken('synthetic-session-20')).toBeDefined();
    });

    it('keeps existing sessions when a reset token has expired', async () => {
        const x = fixture();
        x.verifyToken.mockResolvedValueOnce(false);
        await expect(
            x.service.resetPasswordByToken(x.ctx, 'synthetic-reset-token', 'synthetic-new-password'),
        ).resolves.toMatchObject({ __typename: 'PasswordResetTokenExpiredError' });
        expect(x.savePassword).not.toHaveBeenCalled();
        expect(x.sessionRepository.remove).not.toHaveBeenCalled();
    });

    it('keeps existing sessions when the new password fails validation', async () => {
        const x = fixture();
        x.validate.mockReturnValueOnce(false);
        await expect(
            x.service.updatePassword(x.ctx, 10, 'synthetic-old-password', 'short'),
        ).resolves.toMatchObject({ __typename: 'PasswordValidationError' });
        expect(x.savePassword).not.toHaveBeenCalled();
        expect(x.sessionRepository.remove).not.toHaveBeenCalled();
    });

    it('does not revoke sessions before a failed password save', async () => {
        const x = fixture();
        x.savePassword.mockRejectedValueOnce(new Error('synthetic failed password save'));
        await expect(
            x.service.updatePassword(x.ctx, 10, 'synthetic-old-password', 'synthetic-new-password'),
        ).rejects.toThrow('synthetic failed password save');
        expect(x.sessionRepository.remove).not.toHaveBeenCalled();
        expect(x.sessionCacheStrategy.delete).not.toHaveBeenCalled();
    });
});

describe('administrator session expiration', () => {
    afterEach(() => vi.useRealTimers());

    it('requires reauthentication of a legacy administrator session retained in cache', async () => {
        vi.useFakeTimers();
        const now = Date.now();
        const x = fixture();
        const row = x.rows.get('synthetic-session-20');
        if (!row) throw new Error('Missing fixture session');
        row.createdAt = new Date(now - 1_000);
        x.administratorUserIds.add(10);
        x.cache.set(row.token, x.sessions.serializeSession(row));
        await expect(x.sessions.getSessionFromToken(row.token)).resolves.toBeUndefined();
        expect(x.sessionCacheStrategy.delete).toHaveBeenCalledWith(row.token);
        await expect(x.sessions.getSessionFromToken('synthetic-session-22')).resolves.toBeDefined();
    });

    it('caps cached administrator renewal and never renews expiry for pushed events', async () => {
        vi.useFakeTimers();
        const now = Date.now();
        const x = fixture();
        const row = x.rows.get('synthetic-session-20');
        if (!row) throw new Error('Missing fixture session');
        const deadline = now + 9 * 60_000;
        row.createdAt = new Date(deadline - 12 * 60 * 60_000);
        row.expires = new Date(now + 2 * 60_000);
        x.administratorUserIds.add(10);
        x.cache.set(row.token, x.sessions.serializeSession(row, deadline));
        await expect(
            x.sessions.getSessionFromToken(row.token, { touchAdministrator: false }),
        ).resolves.toMatchObject({ expires: row.expires });
        expect(x.sessionRepository.update).not.toHaveBeenCalled();

        await expect(x.sessions.getSessionFromToken(row.token)).resolves.toMatchObject({
            expires: new Date(deadline),
        });
        expect(x.sessionRepository.update).toHaveBeenCalledWith(expect.anything(), {
            expires: new Date(deadline),
        });

        vi.setSystemTime(deadline);
        await expect(x.sessions.getSessionFromToken(row.token)).resolves.toBeUndefined();
    });
});

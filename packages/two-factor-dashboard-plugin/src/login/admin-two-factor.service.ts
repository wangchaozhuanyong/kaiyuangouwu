import { Injectable } from '@nestjs/common';
import {
    AdministratorService,
    API_KEY_AUTH_STRATEGY_NAME,
    AuthenticatedSession,
    AuthService,
    ForbiddenError,
    ID,
    isGraphQlErrorResult,
    Logger,
    NativeAuthenticationMethod,
    PasswordCipher,
    RequestContext,
    SessionService,
    TransactionalConnection,
    User,
    UserInputError,
    UserService,
} from '@vendure/core';
import { IsNull, LessThan, MoreThan } from 'typeorm';

import {
    AdminTwoFactorCrypto,
    createRecoveryCodes,
    createTotpSecret,
    hashValue,
    matchTotpStep,
    newOpaqueToken,
    normalizeRecoveryCode,
} from './admin-two-factor.crypto';
import {
    AdminTwoFactorChallenge,
    AdminTwoFactorCredential,
    AdminTwoFactorRateLimit,
    AdminTwoFactorSession,
} from './admin-two-factor.entity';

const LOGIN_ERROR = '管理员账号或密码不正确，请重新输入';
const CODE_ERROR = '验证失败，动态码可能错误、过期或已使用，请重试或使用恢复码';
const DUMMY_HASH = '$2b$12$SFfIOqrqph9N4yvWLtbqteiV5C6GEN/YOumGLryDDbHeMLtSQo4/6';

export interface AdminLoginResult {
    status: 'SUCCESS' | 'REQUIRES_2FA' | 'ERROR';
    message?: string;
    challengeToken?: string;
    expiresAt?: Date;
    activeChannelToken?: string;
    session?: AuthenticatedSession;
    rememberMe?: boolean;
}

@Injectable()
export class AdminTwoFactorService {
    readonly crypto = new AdminTwoFactorCrypto();

    constructor(
        private readonly connection: TransactionalConnection,
        private readonly administrators: AdministratorService,
        private readonly users: UserService,
        private readonly passwords: PasswordCipher,
        private readonly auth: AuthService,
        private readonly sessions: SessionService,
    ) {}

    // Security state and attempt counters deliberately use committed storage. A rejected GraphQL
    // mutation must not roll back its failed-attempt counter or a consumed one-time credential.
    private get credentials() {
        return this.connection.rawConnection.getRepository(AdminTwoFactorCredential);
    }
    private get challenges() {
        return this.connection.rawConnection.getRepository(AdminTwoFactorChallenge);
    }
    private get proofs() {
        return this.connection.rawConnection.getRepository(AdminTwoFactorSession);
    }

    async credential(userId: ID) {
        return this.credentials.findOne({ where: { userId } });
    }

    async rateLimit(scope: string, limit: number, durationMs = 300000): Promise<void> {
        const repository = this.connection.rawConnection.getRepository(AdminTwoFactorRateLimit);
        const bucket = hashValue(scope);
        const now = new Date();
        const expiresAt = new Date(now.getTime() + durationMs);
        await repository
            .createQueryBuilder()
            .insert()
            .values({ bucket, expiresAt, attempts: 0 })
            .orIgnore()
            .execute();
        await repository.update({ bucket, expiresAt: LessThan(now) }, { expiresAt, attempts: 0 });
        const result = await repository
            .createQueryBuilder()
            .update()
            .set({ attempts: () => 'attempts + 1' })
            .where({ bucket, expiresAt: MoreThan(now), attempts: LessThan(limit) })
            .execute();
        if (result.affected !== 1) throw new UserInputError('尝试次数过多，请 5 分钟后重试');
    }

    async loginBudget(username: string, ip: string): Promise<void> {
        await this.rateLimit(`login-ip:${ip}`, 60);
        await this.rateLimit(`login-account:${username.trim().toLowerCase().slice(0, 254)}`, 15);
    }

    private async passwordHash(ctx: RequestContext, userId: ID): Promise<string> {
        const method = await this.connection.getRepository(ctx, NativeAuthenticationMethod).findOne({
            where: { user: { id: userId } },
            select: ['id', 'passwordHash'],
        });
        return method?.passwordHash ?? '';
    }

    private async passwordMatches(
        ctx: RequestContext,
        userId: ID | undefined,
        password: string,
    ): Promise<boolean> {
        if (!password || password.length > 256) return false;
        const hash = userId ? await this.passwordHash(ctx, userId) : '';
        const matches = await this.passwords.check(password, hash || DUMMY_HASH);
        return !!hash && matches;
    }

    async beginLogin(
        ctx: RequestContext,
        username: string,
        password: string,
        rememberMe: boolean,
        ip: string,
    ): Promise<AdminLoginResult> {
        await this.loginBudget(username, ip);
        const user =
            username.length <= 254 ? await this.users.getUserByEmailAddress(ctx, username.trim()) : undefined;
        if (
            !(await this.passwordMatches(ctx, user?.id, password)) ||
            !user ||
            !user.verified ||
            !(await this.administrators.findOneByUserId(ctx, user.id))
        ) {
            return { status: 'ERROR', message: LOGIN_ERROR };
        }
        const credential = await this.credential(user.id);
        if (!credential?.enabledAt) return this.issueSession(ctx, user, rememberMe);

        const challengeToken = newOpaqueToken();
        const expiresAt = new Date(Date.now() + 300000);
        await this.challenges.save(
            new AdminTwoFactorChallenge({
                userId: user.id,
                tokenHash: hashValue(challengeToken),
                authVersion: credential.authVersion,
                passwordFingerprint: this.crypto.passwordFingerprint(await this.passwordHash(ctx, user.id)),
                expiresAt,
                consumedAt: null,
                attempts: 0,
                rememberMe,
            }),
        );
        // Expired challenges contain no usable credentials; keep storage bounded without retaining tokens.
        await this.challenges.delete({ expiresAt: LessThan(new Date(Date.now() - 86400000)) });
        await this.connection.rawConnection
            .getRepository(AdminTwoFactorRateLimit)
            .delete({ expiresAt: LessThan(new Date(Date.now() - 86400000)) });
        return { status: 'REQUIRES_2FA', challengeToken, expiresAt };
    }

    async completeLogin(
        ctx: RequestContext,
        token: string,
        code: string,
        ip: string,
    ): Promise<AdminLoginResult> {
        await this.rateLimit(`verify-ip:${ip}`, 60);
        if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return { status: 'ERROR', message: CODE_ERROR };
        const challenge = await this.challenges.findOne({ where: { tokenHash: hashValue(token) } });
        const now = new Date();
        if (!challenge || challenge.consumedAt || challenge.expiresAt <= now) {
            return { status: 'ERROR', message: '验证请求已失效，请重新输入账号密码' };
        }
        await this.rateLimit(`verify-user:${challenge.userId}`, 10);
        const attempt = await this.challenges
            .createQueryBuilder()
            .update()
            .set({ attempts: () => 'attempts + 1' })
            .where({
                id: challenge.id,
                consumedAt: IsNull(),
                expiresAt: MoreThan(now),
                attempts: LessThan(5),
            })
            .execute();
        if (attempt.affected !== 1) return { status: 'ERROR', message: '验证请求已失效，请重新输入账号密码' };
        const credential = await this.credential(challenge.userId);
        if (
            !credential?.enabledAt ||
            credential.authVersion !== challenge.authVersion ||
            challenge.passwordFingerprint !==
                this.crypto.passwordFingerprint(await this.passwordHash(ctx, challenge.userId))
        ) {
            return { status: 'ERROR', message: '账号安全设置已变更，请重新登录' };
        }
        if (!(await this.consumeFactor(credential, code))) {
            this.audit('verification-failed', challenge.userId);
            return { status: 'ERROR', message: CODE_ERROR };
        }
        const claimed = await this.challenges.update(
            { id: challenge.id, consumedAt: IsNull(), expiresAt: MoreThan(new Date()) },
            { consumedAt: new Date() },
        );
        if (claimed.affected !== 1) return { status: 'ERROR', message: '验证请求已失效，请重新登录' };
        const user = await this.users.getUserById(ctx, challenge.userId);
        if (!user?.verified || !(await this.administrators.findOneByUserId(ctx, challenge.userId))) {
            return { status: 'ERROR', message: LOGIN_ERROR };
        }
        return this.issueSession(ctx, user, challenge.rememberMe, challenge);
    }

    private async issueSession(
        ctx: RequestContext,
        user: User,
        rememberMe: boolean,
        challenge?: AdminTwoFactorChallenge,
    ): Promise<AdminLoginResult> {
        const session = await this.auth.createAuthenticatedSessionForUser(ctx, user, 'native');
        if (isGraphQlErrorResult(session)) return { status: 'ERROR', message: LOGIN_ERROR };
        if (challenge) {
            await this.proofs.save(
                new AdminTwoFactorSession({
                    sessionId: session.id,
                    userId: user.id,
                    authVersion: challenge.authVersion,
                    passwordFingerprint: challenge.passwordFingerprint,
                }),
            );
        }
        // Re-check after session creation: enrollment/revocation may have raced with authentication.
        const current = await this.credential(user.id);
        if (
            (current?.enabledAt && !challenge) ||
            (challenge && current?.authVersion !== challenge.authVersion)
        ) {
            await this.connection.rawConnection
                .getRepository(AuthenticatedSession)
                .delete({ id: session.id });
            return { status: 'ERROR', message: '账号安全设置已变更，请重新登录' };
        }
        const channels = new Map(
            user.roles.flatMap(role => role.channels).map(channel => [channel.id, channel.token]),
        );
        this.audit(challenge ? 'two-factor-login' : 'password-login', user.id);
        return {
            status: 'SUCCESS',
            session,
            rememberMe,
            activeChannelToken: channels.size === 1 ? [...channels.values()][0] : undefined,
        };
    }

    async assertSession(ctx: RequestContext): Promise<void> {
        if (ctx.apiType !== 'admin' || !ctx.activeUserId || !ctx.session) return;
        const credential = await this.credential(ctx.activeUserId);
        if (!credential) return;
        const persisted = await this.connection.rawConnection
            .getRepository(AuthenticatedSession)
            .findOne({ where: { id: ctx.session.id, invalidated: false, user: { id: ctx.activeUserId } } });
        if (!persisted || persisted.expires <= new Date()) throw new ForbiddenError();
        // API keys remain machine credentials; they never qualify for personal security operations.
        if (ctx.session.authenticationStrategy === API_KEY_AUTH_STRATEGY_NAME) return;
        if (!credential.enabledAt) return;
        const proof = await this.proofs.findOne({
            where: { sessionId: ctx.session.id, userId: ctx.activeUserId },
        });
        if (
            !proof ||
            proof.authVersion !== credential.authVersion ||
            proof.passwordFingerprint !==
                this.crypto.passwordFingerprint(await this.passwordHash(ctx, ctx.activeUserId))
        ) {
            throw new ForbiddenError();
        }
    }

    private async activeUser(ctx: RequestContext): Promise<ID> {
        if (
            ctx.apiType !== 'admin' ||
            !ctx.activeUserId ||
            ctx.session?.authenticationStrategy === API_KEY_AUTH_STRATEGY_NAME ||
            !(await this.administrators.findOneByUserId(ctx, ctx.activeUserId))
        )
            throw new ForbiddenError();
        await this.assertSession(ctx);
        return ctx.activeUserId;
    }

    async status(ctx: RequestContext) {
        const credential = await this.credential(await this.activeUser(ctx));
        return {
            available: this.crypto.available,
            enabled: !!credential?.enabledAt,
            enabledAt: credential?.enabledAt,
            recoveryCodesRemaining: credential?.recoveryHashes.length ?? 0,
        };
    }

    private async reauthenticate(ctx: RequestContext, password: string, code?: string) {
        const userId = await this.activeUser(ctx);
        await this.rateLimit(`security-user:${userId}`, 10);
        if (!(await this.passwordMatches(ctx, userId, password))) throw new UserInputError('当前密码不正确');
        const credential = await this.credential(userId);
        if (credential?.enabledAt) {
            if (!(await this.consumeFactor(credential, code ?? ''))) throw new UserInputError(CODE_ERROR);
            const refreshed = await this.credential(userId);
            if (
                !refreshed ||
                refreshed.revision !== credential.revision + 1 ||
                refreshed.authVersion !== credential.authVersion
            ) {
                throw new UserInputError('账号安全设置已变化，请重新验证');
            }
            return { userId, credential: refreshed };
        }
        return { userId, credential };
    }

    async beginSetup(ctx: RequestContext, password: string, code?: string) {
        const approval = await this.reauthenticate(ctx, password, code);
        const { userId } = approval;
        const secret = createTotpSecret();
        const encrypted = this.crypto.encrypt(secret, String(userId));
        await this.credentials
            .createQueryBuilder()
            .insert()
            .values({
                userId,
                enabledAt: null,
                encryptedSecret: null,
                pendingSecret: null,
                pendingExpiresAt: null,
                recoveryHashes: [],
                lastUsedStep: -1,
                revision: 0,
                authVersion: newOpaqueToken(),
            })
            .orIgnore()
            .execute();
        const credential = approval.credential ?? (await this.credential(userId));
        if (!credential) throw new ForbiddenError();
        if (!approval.credential && credential.revision !== 0)
            throw new UserInputError('账号安全设置已变化，请重新验证');
        const expiresAt = new Date(Date.now() + 600000);
        await this.updateCredential(credential, { pendingSecret: encrypted, pendingExpiresAt: expiresAt });
        const user = await this.users.getUserById(ctx, userId);
        const issuer = 'Vendure Admin';
        const label = encodeURIComponent(`${issuer}:${user?.identifier ?? userId}`);
        return {
            secret,
            expiresAt,
            otpauthUri: `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`,
        };
    }

    async confirmSetup(ctx: RequestContext, password: string, code: string) {
        const userId = await this.activeUser(ctx);
        await this.rateLimit(`security-user:${userId}`, 10);
        if (!(await this.passwordMatches(ctx, userId, password))) throw new UserInputError('当前密码不正确');
        const credential = await this.credential(userId);
        if (
            !credential?.pendingSecret ||
            !credential.pendingExpiresAt ||
            credential.pendingExpiresAt <= new Date()
        ) {
            throw new UserInputError('绑定已过期，请重新开始');
        }
        const step = matchTotpStep(this.crypto.decrypt(credential.pendingSecret, String(userId)), code, -1);
        if (step === null) throw new UserInputError(CODE_ERROR);
        const recoveryCodes = createRecoveryCodes();
        await this.updateCredential(credential, {
            encryptedSecret: credential.pendingSecret,
            enabledAt: new Date(),
            pendingSecret: null,
            pendingExpiresAt: null,
            recoveryHashes: recoveryCodes.map(value => hashValue(normalizeRecoveryCode(value))),
            lastUsedStep: step,
            authVersion: newOpaqueToken(),
        });
        await this.revoke(ctx, userId, 'enabled-or-replaced');
        return { success: true, recoveryCodes };
    }

    async disable(ctx: RequestContext, password: string, code: string) {
        const { userId, credential } = await this.reauthenticate(ctx, password, code);
        if (!credential?.enabledAt) throw new UserInputError('当前账号尚未开启 2FA');
        await this.updateCredential(credential, {
            enabledAt: null,
            encryptedSecret: null,
            pendingSecret: null,
            pendingExpiresAt: null,
            recoveryHashes: [],
            lastUsedStep: -1,
            authVersion: newOpaqueToken(),
        });
        await this.revoke(ctx, userId, 'disabled');
        return { success: true };
    }

    async regenerateRecoveryCodes(ctx: RequestContext, password: string, code: string) {
        const { userId, credential } = await this.reauthenticate(ctx, password, code);
        if (!credential?.enabledAt) throw new UserInputError('请先开启 2FA');
        const recoveryCodes = createRecoveryCodes();
        await this.updateCredential(credential, {
            recoveryHashes: recoveryCodes.map(value => hashValue(normalizeRecoveryCode(value))),
            authVersion: newOpaqueToken(),
            pendingSecret: null,
            pendingExpiresAt: null,
        });
        await this.revoke(ctx, userId, 'recovery-codes-regenerated');
        return { success: true, recoveryCodes };
    }

    private async consumeFactor(credential: AdminTwoFactorCredential, rawCode: string): Promise<boolean> {
        if (!credential.enabledAt || !credential.encryptedSecret || rawCode.length > 100) return false;
        const code = rawCode.trim();
        let changes: Partial<AdminTwoFactorCredential>;
        if (/^\d{6}$/.test(code)) {
            const step = matchTotpStep(
                this.crypto.decrypt(credential.encryptedSecret, String(credential.userId)),
                code,
                credential.lastUsedStep,
            );
            if (step === null) return false;
            changes = { lastUsedStep: step };
        } else {
            const normalized = normalizeRecoveryCode(code);
            if (!/^[A-F0-9]{32}$/.test(normalized)) return false;
            const hash = hashValue(normalized);
            if (!credential.recoveryHashes.includes(hash)) return false;
            changes = { recoveryHashes: credential.recoveryHashes.filter(value => value !== hash) };
        }
        const result = await this.credentials.update(
            { id: credential.id, revision: credential.revision },
            { ...changes, revision: credential.revision + 1 },
        );
        if (result.affected === 1 && !/^\d{6}$/.test(code))
            this.audit('recovery-code-used', credential.userId);
        return result.affected === 1;
    }

    private async updateCredential(
        credential: AdminTwoFactorCredential,
        changes: Partial<AdminTwoFactorCredential>,
    ) {
        const result = await this.credentials.update(
            { id: credential.id, revision: credential.revision },
            { ...changes, revision: credential.revision + 1 },
        );
        if (result.affected !== 1) throw new UserInputError('账号安全设置已变化，请刷新后重试');
    }

    private async revoke(ctx: RequestContext, userId: ID, action: string) {
        await this.challenges.update({ userId, consumedAt: IsNull() }, { consumedAt: new Date() });
        const user = await this.users.getUserById(ctx, userId);
        if (user) await this.sessions.deleteSessionsByUser(ctx, user);
        this.audit(action, userId);
    }

    private audit(action: string, userId: ID) {
        Logger.info(
            JSON.stringify({ action, userId: String(userId), at: new Date().toISOString() }),
            'AdminLogin2FA',
        );
    }
}

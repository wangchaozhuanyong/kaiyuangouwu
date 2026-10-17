import { Injectable } from '@nestjs/common';
import { ConfigService, Logger, RequestContext } from '@vendure/core';
import { AdminNotificationService } from '@vendure/operations-dashboard-plugin';
import { createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { isIP } from 'node:net';
import sharp from 'sharp';

import { ShopAbuseError } from './error';
import { renderShopAbuseChallengeSvg, shopAbuseAlphabet } from './glyph-renderer';
import {
    AbuseOperation,
    cooldownMs,
    isChallengeAction,
    minute,
    normalizeAbuseTarget,
    requestLimits,
    riskFamily,
    riskWindow,
    ShopAbuseAction,
} from './policy';
import { ShopAbuseStore } from './store';

export interface AbuseAdmission {
    operation: AbuseOperation;
    ipHash: string;
    targetHash: string | null;
    globalHash: string;
    channelId: string;
}
const alphabet = shopAbuseAlphabet;
const challengeTtl = 2 * minute;

@Injectable()
export class ShopAbuseProtectionService {
    private pruningAt = 0;
    constructor(
        private readonly store: ShopAbuseStore,
        private readonly config: ConfigService,
        private readonly notifications: AdminNotificationService,
    ) {}

    private digest(...parts: string[]) {
        const secret = this.config.authOptions.cookieOptions?.secret;
        if (typeof secret !== 'string' || secret.length < 16) throw new Error('Missing security signing key');
        return createHmac('sha256', secret)
            .update(JSON.stringify(['shop-abuse-v1', ...parts]))
            .digest('hex');
    }
    private ip(ctx: RequestContext): string {
        // Express resolves this only through the configured trusted proxy boundary. Never read a client IP header here.
        const value = ctx.req?.ip?.replace(/^::ffff:/, '');
        if (!value || !isIP(value)) throw new Error('Invalid request source');
        return value;
    }
    private admission(ctx: RequestContext, operation: AbuseOperation): AbuseAdmission {
        const channelId = String(ctx.channelId);
        const family = riskFamily(operation.action);
        const ip = this.ip(ctx);
        // Native passwords belong to global Users; switching storefronts cannot reset their protection.
        const scope = family === 'ACCOUNT' ? 'shared-accounts' : channelId;
        return {
            operation,
            channelId,
            ipHash: this.digest('source', scope, family, ip),
            targetHash: operation.targetRisk ? this.digest('target', scope, family, operation.target) : null,
            globalHash: this.digest('global-risk', channelId, family),
        };
    }
    private binding(ctx: RequestContext, action: ShopAbuseAction, target: string) {
        return this.digest(
            'challenge-binding',
            String(ctx.channelId),
            this.ip(ctx),
            action,
            normalizeAbuseTarget(action, target),
        );
    }
    private async budget(
        bucket: string,
        maximum: number,
        duration: number,
        operation: AbuseOperation,
        now: Date,
    ) {
        const result = await this.store.consume(bucket, maximum, duration, now);
        if (!result.allowed)
            throw new ShopAbuseError('SHOP_ABUSE_RATE_LIMITED', operation.action, result.retryAfterMs);
    }
    private proof(ctx: RequestContext): { id: string; answer: string } | null {
        const id = ctx.req?.headers['x-shop-abuse-id'];
        const answer = ctx.req?.headers['x-shop-abuse-answer'];
        if (
            typeof id !== 'string' ||
            typeof answer !== 'string' ||
            !/^[a-f0-9]{48}$/.test(id) ||
            answer.length > 32
        )
            return null;
        return { id, answer: answer.replace(/\s/g, '').toUpperCase() };
    }
    async before(ctx: RequestContext, operation: AbuseOperation, now = new Date()): Promise<AbuseAdmission> {
        ctx.req?.res?.setHeader('Cache-Control', 'no-store');
        try {
            const admission = this.admission(ctx, operation);
            // Always charge every resolved root field, including aliases, batched operations and direct API calls.
            await this.budget(this.digest('shop-budget', admission.channelId), 2000, minute, operation, now);
            await this.budget(
                this.digest('request', admission.ipHash, operation.action),
                requestLimits[operation.action],
                minute,
                operation,
                now,
            );
            await this.budget(
                this.digest('family-budget', admission.ipHash),
                riskFamily(operation.action) === 'ACCOUNT' ? 30 : 100,
                minute,
                operation,
                now,
            );
            if (!isChallengeAction(operation.action)) return admission;
            const sourceFailures = await this.store.count(admission.ipHash, now);
            const targetFailures = admission.targetHash
                ? await this.store.count(admission.targetHash, now)
                : 0;
            const globalFailures = await this.store.count(admission.globalHash, now);
            const blocked = await this.store.blockedFor(admission.ipHash, now);
            if (blocked > 0) throw new ShopAbuseError('SHOP_ABUSE_RATE_LIMITED', operation.action, blocked);
            // Sending account email is sensitive even when the address is nonexistent (responses remain indistinguishable).
            let emailAttempts = 0;
            let emailPressure = 0;
            if (operation.action === 'REGISTER' || operation.action === 'PASSWORD_RESET') {
                emailAttempts = await this.store.signal(
                    this.digest('email-attempt', operation.target),
                    riskWindow,
                    now,
                );
                // Successful-looking registration/reset requests can also be automated; do not rely only on failures.
                emailPressure = await this.store.signal(this.digest('email-pressure'), minute, now);
            }
            const supplied = this.proof(ctx);
            const required =
                sourceFailures >= 3 ||
                targetFailures >= 3 ||
                globalFailures >= 50 ||
                emailAttempts >= 3 ||
                emailPressure >= 30;
            if (required || supplied) {
                if (!supplied) throw new ShopAbuseError('SHOP_ABUSE_CHALLENGE_REQUIRED', operation.action);
                const stored = await this.store.consumeChallenge(
                    supplied.id,
                    this.binding(ctx, operation.action, operation.target),
                    now,
                );
                const actual = this.digest('challenge-answer', supplied.id, supplied.answer);
                if (
                    !stored ||
                    !timingSafeEqual(Buffer.from(stored.answerDigest, 'hex'), Buffer.from(actual, 'hex'))
                ) {
                    await this.failed(admission, now);
                    throw new ShopAbuseError('SHOP_ABUSE_CHALLENGE_INVALID', operation.action);
                }
            }
            this.prune(now);
            return admission;
        } catch (error) {
            if (error instanceof ShopAbuseError) throw error;
            Logger.error(
                'Shop abuse protection unavailable; protected request rejected',
                'ShopAbuseProtection',
            );
            throw new ShopAbuseError('SHOP_ABUSE_UNAVAILABLE', operation.action);
        }
    }
    async failed(admission: AbuseAdmission, now = new Date()): Promise<void> {
        const sourceCount = await this.store.signal(admission.ipHash, riskWindow, now);
        if (admission.targetHash) await this.store.signal(admission.targetHash, riskWindow, now);
        const globalCount = await this.store.signal(admission.globalHash, minute, now);
        const duration = cooldownMs(sourceCount);
        if (duration) await this.store.cooldown(admission.ipHash, new Date(now.getTime() + duration), now);
        if (sourceCount >= 8 || globalCount >= 50) {
            // One persistent incident per shop/family/window. No raw IP, identifier, code, JSON or proof is logged.
            const gate = await this.store.consume(
                this.digest('alert', admission.globalHash),
                1,
                5 * minute,
                now,
            );
            if (gate.allowed) {
                Logger.warn(
                    JSON.stringify({
                        event: 'security.storefront.abuse',
                        channelId: admission.channelId,
                        action: admission.operation.action,
                        sourceFailures: sourceCount,
                        shopFailures: globalCount,
                    }),
                    'ShopAbuseProtection',
                );
                await this.notifications
                    .upsertIncident(null, {
                        eventType: 'security.storefront.abuse',
                        category: 'SECURITY',
                        severity: 'P1',
                        sourceType: 'ShopAbuseWindow',
                        sourceId: admission.globalHash,
                        fingerprint: `shop-abuse:${admission.globalHash}`,
                        title: '网站异常登录或兑换码尝试',
                        payload: {
                            channelId: admission.channelId,
                            action: `防刷已生效：${admission.operation.action}`,
                            failureCount: globalCount,
                        },
                    })
                    .catch(() => {
                        Logger.error('Shop abuse incident recording failed', 'ShopAbuseProtection');
                    });
            }
        }
        this.prune(now);
    }
    /** Observability must never turn an already completed business write into an apparent rejection. */
    async observeFailure(admission: AbuseAdmission) {
        try {
            await this.failed(admission);
        } catch {
            Logger.error('Shop abuse failure accounting unavailable', 'ShopAbuseProtection');
        }
    }
    async challenge(ctx: RequestContext, action: string, target: string, now = new Date()) {
        ctx.req?.res?.setHeader('Cache-Control', 'no-store');
        const safeAction = isChallengeAction(action) ? action : 'LOGIN';
        try {
            if (!isChallengeAction(action) || typeof target !== 'string' || target.length > 4096)
                throw new ShopAbuseError('SHOP_ABUSE_CHALLENGE_INVALID', safeAction);
            const operation: AbuseOperation = {
                action,
                target: normalizeAbuseTarget(action, target),
                email: false,
                targetRisk: false,
            };
            const sourceHash = this.digest('challenge-source', String(ctx.channelId), this.ip(ctx));
            await this.budget(
                this.digest('challenge-shop', String(ctx.channelId)),
                200,
                minute,
                operation,
                now,
            );
            await this.budget(sourceHash, 10, minute, operation, now);
            const id = randomBytes(24).toString('hex');
            const answer = Array.from({ length: 6 }, () => alphabet[randomInt(alphabet.length)]).join('');
            const expiresAt = new Date(now.getTime() + challengeTtl);
            // Keep the answer and vector glyphs in server memory; only the PNG may leave this process.
            const svg = renderShopAbuseChallengeSvg(answer);
            const png = await sharp(Buffer.from(svg)).png().toBuffer();
            await this.store.createChallenge({
                publicId: id,
                bindingHash: this.binding(ctx, action, operation.target),
                answerDigest: this.digest('challenge-answer', id, answer),
                expiresAt,
            });
            this.prune(now);
            return { id, imageDataUrl: `data:image/png;base64,${png.toString('base64')}`, expiresAt };
        } catch (error) {
            if (error instanceof ShopAbuseError) throw error;
            throw new ShopAbuseError('SHOP_ABUSE_UNAVAILABLE', safeAction);
        }
    }
    private prune(now: Date) {
        // Scheduling alone is local; all enforcement and cleanup predicates remain in the shared database.
        if (now.getTime() < this.pruningAt + minute) return;
        this.pruningAt = now.getTime();
        void this.store
            .pruneExpired(now)
            .catch(() => Logger.error('Shop abuse expiry cleanup failed', 'ShopAbuseProtection'));
    }
}

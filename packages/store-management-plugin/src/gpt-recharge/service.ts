import { Injectable } from '@nestjs/common';
import {
    ForbiddenError,
    Logger,
    RequestContext,
    TransactionalConnection,
    UserInputError,
} from '@vendure/core';
import { createHash } from 'node:crypto';
import { isIP } from 'node:net';

import { StorefrontClientPluginAccessService } from '../storefront-client-plugin-access.service';

import { GptRechargeConfig, GptRechargeReceipt } from './entities';
import {
    allowedRechargeOrigin,
    GptRechargeNotAcceptedError,
    openRechargeSecret,
    rechargeAllowedPlans,
    rechargeCredentialMatches,
    rechargeFingerprint,
    safeRechargeTask,
    sealRechargeSecret,
    validateRechargeSession,
} from './security';

type InternalCode = { plan: string; status: string; task?: unknown };
@Injectable()
export class GptRechargeService {
    private readonly limits = new Map<string, { count: number; expires: number }>();
    constructor(
        private readonly connection: TransactionalConnection,
        private readonly access: StorefrontClientPluginAccessService,
    ) {}
    private configs(ctx: RequestContext) {
        return this.connection.getRepository(ctx, GptRechargeConfig);
    }
    private receipts(ctx: RequestContext) {
        return this.connection.getRepository(ctx, GptRechargeReceipt);
    }
    private context(ctx: RequestContext) {
        return `gpt:${ctx.channelId}`;
    }
    private code(value: string) {
        if (typeof value !== 'string' || !value.trim() || value.trim().length > 190)
            throw new UserInputError('兑换码格式无效');
        return value.trim();
    }
    private limit(ctx: RequestContext, operation: string, maximum: number) {
        const ip = ctx.req?.ip?.replace(/^::ffff:/, '');
        if (!ip || !isIP(ip)) throw new ForbiddenError();
        const now = Date.now();
        for (const [expiredKey, item] of this.limits) if (item.expires <= now) this.limits.delete(expiredKey);
        const key = createHash('sha256').update(`${ctx.channelId}:${operation}:${ip}`).digest('hex');
        const row = this.limits.get(key) ?? { count: 0, expires: now + 60000 };
        if (++row.count > maximum || (this.limits.size >= 10000 && !this.limits.has(key)))
            throw new UserInputError('请求频繁，请稍后重试');
        this.limits.set(key, row);
        return ip;
    }
    async adminConfig(ctx: RequestContext) {
        const row = await this.configs(ctx).findOne({ where: { channelId: ctx.channelId } });
        return {
            enabled: row?.enabled ?? false,
            upstreamOrigin: row?.upstreamOrigin ?? '',
            credentialConfigured: Boolean(row?.encryptedServiceKey),
            revision: row?.revision ?? -1,
        };
    }
    async saveConfig(
        ctx: RequestContext,
        input: {
            enabled: boolean;
            upstreamOrigin: string;
            serviceKey?: string | null;
            expectedRevision: number;
        },
    ) {
        try {
            const origin = allowedRechargeOrigin(input.upstreamOrigin);
            const repository = this.configs(ctx);
            const prior = await repository.findOne({ where: { channelId: ctx.channelId } });
            if ((prior?.revision ?? -1) !== input.expectedRevision) throw new Error('Configuration changed');
            if (
                prior &&
                origin !== prior.upstreamOrigin &&
                (await this.receipts(ctx).count({ where: { channelId: ctx.channelId } }))
            )
                throw new Error('Existing tasks depend on this source');
            const encryptedServiceKey = input.serviceKey
                ? sealRechargeSecret(input.serviceKey, this.context(ctx))
                : prior?.encryptedServiceKey;
            if (
                !encryptedServiceKey ||
                (input.serviceKey && (input.serviceKey.length < 32 || input.serviceKey.length > 512))
            )
                throw new Error('Invalid credential');
            const values = {
                enabled: input.enabled,
                upstreamOrigin: origin,
                encryptedServiceKey,
                revision: (prior?.revision ?? -1) + 1,
            };
            if (prior) {
                const saved = await repository.update(
                    { id: prior.id, channelId: ctx.channelId, revision: input.expectedRevision },
                    values,
                );
                if (!saved.affected) throw new Error('Configuration changed');
            } else await repository.insert(new GptRechargeConfig({ channelId: ctx.channelId, ...values }));
            Logger.info(
                `Recharge connection configuration updated for channel ${ctx.channelId}`,
                'GptRecharge',
            );
            return this.adminConfig(ctx);
        } catch {
            throw new UserInputError(
                '配置未保存，请刷新并核对允许的服务地址和独立凭证；已有任务的服务地址不能更换',
            );
        }
    }
    private async connectionConfig(ctx: RequestContext, admit: boolean) {
        const row = await this.configs(ctx).findOne({ where: { channelId: ctx.channelId } });
        if (!row) throw new UserInputError('当前店铺尚未配置充值服务');
        if (admit) {
            if (!row.enabled) throw new UserInputError('当前充值服务暂未开放');
            await this.access.assertEnabled(ctx, 'gpt-recharge-entry');
        }
        return row;
    }
    private async upstream(ctx: RequestContext, config: GptRechargeConfig, action: string, body: object) {
        try {
            const origin = allowedRechargeOrigin(config.upstreamOrigin);
            const response = await fetch(
                `${origin}/api/id-business-v2/online-recharge/integrations/vendure/${action}`,
                {
                    method: 'POST',
                    redirect: 'error',
                    signal: AbortSignal.timeout(20000),
                    headers: {
                        'content-type': 'application/json',
                        'x-vendure-recharge-key': openRechargeSecret(
                            config.encryptedServiceKey,
                            this.context(ctx),
                        ),
                        'x-vendure-client-ip': ctx.req?.ip?.replace(/^::ffff:/, '') ?? '',
                    },
                    body: JSON.stringify(body),
                },
            );
            if (response.status === 400 && ['verify', 'query'].includes(action))
                throw new UserInputError('兑换码无效或已停用，请核对后重试');
            if (!response.ok) throw new Error('Upstream request rejected');
            const raw = await response.text();
            if (raw.length > 65536) throw new Error('Response too large');
            return JSON.parse(raw) as Record<string, unknown>;
        } catch (error) {
            if (error instanceof UserInputError) throw error;
            throw new UserInputError('充值服务暂时无法确认请求，请查询原兑换码');
        }
    }
    async publicConfig(ctx: RequestContext) {
        this.limit(ctx, 'config', 30);
        const configured = await this.configs(ctx).findOne({ where: { channelId: ctx.channelId } });
        if (!configured?.enabled || !(await this.access.isEnabled(ctx, 'gpt-recharge-entry')))
            return { enabled: false, maintenance: false };
        const result = await this.upstream(ctx, configured, 'config', {});
        return { enabled: true, maintenance: result.maintenance === true };
    }
    private validateCodeResult(value: Record<string, unknown>): InternalCode {
        if (
            !rechargeAllowedPlans.includes(String(value.plan)) ||
            !['available', 'reserved', 'used', 'disabled'].includes(String(value.status))
        )
            throw new UserInputError('兑换码状态暂不可用');
        return { plan: String(value.plan), status: String(value.status), task: value.task };
    }
    async verify(ctx: RequestContext, code: string) {
        this.limit(ctx, 'verify', 10);
        const config = await this.connectionConfig(ctx, true);
        code = this.code(code);
        await this.assertCodeOwner(ctx, code, config.upstreamOrigin);
        const result = this.validateCodeResult(await this.upstream(ctx, config, 'verify', { code }));
        return { plan: result.plan, status: result.status, task: null };
    }
    private codePublicId(code: string, origin: string) {
        // The existing unique publicId index also claims a code across channels using this source.
        const hash = rechargeFingerprint(code, `gpt:source:${origin}`);
        return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-${hash.slice(12, 16)}-${hash.slice(16, 20)}-${hash.slice(20, 32)}`;
    }
    private async assertCodeOwner(ctx: RequestContext, code: string, origin: string) {
        const prior = await this.receipts(ctx).findOne({
            where: { publicId: this.codePublicId(code, origin) },
        });
        if (prior && String(prior.channelId) !== String(ctx.channelId)) throw new ForbiddenError();
    }
    private async receipt(ctx: RequestContext, code: string, plan: string, origin: string) {
        const repository = this.receipts(ctx);
        const where = {
            channelId: ctx.channelId,
            codeFingerprint: rechargeFingerprint(code, this.context(ctx)),
        };
        await this.assertCodeOwner(ctx, code, origin);
        let row = await repository.findOne({ where });
        if (!row) {
            try {
                await repository.insert(
                    new GptRechargeReceipt({
                        ...where,
                        publicId: this.codePublicId(code, origin),
                        plan,
                        status: 'new',
                        encryptedUpstreamTask: null,
                    }),
                );
                row = await repository.findOneOrFail({ where });
            } catch (error) {
                // A concurrent other-channel claim must never fall through to its task.
                await this.assertCodeOwner(ctx, code, origin);
                row = await repository.findOne({ where });
                if (!row) throw error;
            }
        }
        return row;
    }
    private view(ctx: RequestContext, row: GptRechargeReceipt) {
        return {
            id: row.publicId,
            credential: rechargeFingerprint(row.publicId, `${this.context(ctx)}:task`),
            plan: row.plan,
            status: ['new', 'submitting', 'submission_unknown'].includes(row.status)
                ? 'awaiting_review'
                : row.status,
            updatedAt: row.upstreamUpdatedAt ?? row.updatedAt,
        };
    }
    private async capture(ctx: RequestContext, row: GptRechargeReceipt, raw: unknown) {
        const value = safeRechargeTask(raw);
        const repository = this.receipts(ctx);
        for (let attempt = 0; attempt < 4; attempt++) {
            const current = await repository.findOneOrFail({
                where: { id: row.id, channelId: ctx.channelId },
            });
            // Upstream timestamps and CAS keep late polls from replacing newer evidence.
            if (
                current.upstreamUpdatedAt &&
                value.updatedAt <= current.upstreamUpdatedAt &&
                current.encryptedUpstreamTask
            )
                return this.view(ctx, current);
            const encryptedUpstreamTask = value.taskToken
                ? sealRechargeSecret(
                      JSON.stringify({ id: value.id, taskToken: value.taskToken }),
                      `${this.context(ctx)}:${row.publicId}`,
                  )
                : current.encryptedUpstreamTask;
            if (!encryptedUpstreamTask) throw new UserInputError('任务凭证暂不可用，请使用兑换码查询');
            const updated = await repository.update(
                { id: current.id, channelId: ctx.channelId, revision: current.revision },
                {
                    encryptedUpstreamTask,
                    upstreamUpdatedAt: value.updatedAt,
                    plan: value.plan,
                    status: value.status,
                    revision: current.revision + 1,
                },
            );
            if (updated.affected)
                return this.view(
                    ctx,
                    await repository.findOneOrFail({ where: { id: row.id, channelId: ctx.channelId } }),
                );
        }
        return this.view(
            ctx,
            await repository.findOneOrFail({ where: { id: row.id, channelId: ctx.channelId } }),
        );
    }
    async query(ctx: RequestContext, codeInput: string) {
        this.limit(ctx, 'query', 20);
        const code = this.code(codeInput);
        const config = await this.connectionConfig(ctx, false);
        await this.assertCodeOwner(ctx, code, config.upstreamOrigin);
        const result = this.validateCodeResult(await this.upstream(ctx, config, 'query', { code }));
        if (!result.task) {
            const pending = await this.receipts(ctx).findOne({
                where: { publicId: this.codePublicId(code, config.upstreamOrigin), channelId: ctx.channelId },
            });
            // An available-code read cannot disprove a timed-out submission still in flight.
            if (pending && ['submitting', 'submission_unknown'].includes(pending.status))
                return { plan: pending.plan, status: 'reserved', task: this.view(ctx, pending) };
            return { plan: result.plan, status: result.status, task: null };
        }
        const row = await this.receipt(ctx, code, result.plan, config.upstreamOrigin);
        return { plan: result.plan, status: result.status, task: await this.capture(ctx, row, result.task) };
    }
    async submit(ctx: RequestContext, codeInput: string, session: string) {
        this.limit(ctx, 'submit', 5);
        const code = this.code(codeInput);
        validateRechargeSession(session);
        const config = await this.connectionConfig(ctx, true);
        await this.assertCodeOwner(ctx, code, config.upstreamOrigin);
        // Recover first. A transport error must never create another payment attempt.
        const queried = this.validateCodeResult(await this.upstream(ctx, config, 'query', { code }));
        const row = await this.receipt(ctx, code, queried.plan, config.upstreamOrigin);
        if (queried.task) return this.capture(ctx, row, queried.task);
        if (queried.status !== 'available') throw new UserInputError('兑换码暂不可用');
        const claimed = await this.receipts(ctx).update(
            { id: row.id, channelId: ctx.channelId, status: 'new' },
            { status: 'submitting' },
        );
        if (!claimed.affected)
            return this.view(
                ctx,
                await this.receipts(ctx).findOneOrFail({ where: { id: row.id, channelId: ctx.channelId } }),
            );
        try {
            const result = await this.upstream(ctx, config, 'submit', { code, session });
            if (result.rejected === true) {
                await this.receipts(ctx).update({ id: row.id, status: 'submitting' }, { status: 'new' });
                throw new GptRechargeNotAcceptedError();
            }
            return await this.capture(ctx, row, result);
        } catch (error) {
            if (error instanceof GptRechargeNotAcceptedError) throw error;
            // Persist only an ambiguous state, never raw account JSON or the code.
            await this.receipts(ctx).update(
                { id: row.id, status: 'submitting' },
                { status: 'submission_unknown' },
            );
            throw new UserInputError('提交结果待核对，请使用原兑换码查询');
        }
    }
    async task(ctx: RequestContext, publicId: string, credential: string) {
        this.limit(ctx, 'task', 60);
        const expected = rechargeFingerprint(publicId, `${this.context(ctx)}:task`);
        if (!rechargeCredentialMatches(expected, credential)) throw new ForbiddenError();
        const row = await this.receipts(ctx).findOne({ where: { publicId, channelId: ctx.channelId } });
        if (!row) throw new ForbiddenError();
        if (!row.encryptedUpstreamTask || ['succeeded', 'failed'].includes(row.status))
            return this.view(ctx, row);
        const config = await this.connectionConfig(ctx, false);
        const input = JSON.parse(
            openRechargeSecret(row.encryptedUpstreamTask, `${this.context(ctx)}:${row.publicId}`),
        ) as { id: string; taskToken: string };
        return this.capture(ctx, row, await this.upstream(ctx, config, 'task', input));
    }
}

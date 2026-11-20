import { Injectable } from '@nestjs/common';
import {
    ForbiddenError,
    Logger,
    RequestContext,
    TransactionalConnection,
    UserInputError,
} from '@vendure/core';
import { randomUUID } from 'node:crypto';

import { StorefrontClientPluginAccessService } from '../storefront-client-plugin-access.service';

import { GptRechargeConfig, GptRechargeReceipt } from './entities';
import { readRechargeProgressStream, type RechargeProgress } from './progress';
import {
    allowedRechargeOrigin,
    GptRechargeNotAcceptedError,
    openRechargeSecret,
    readRechargeResponse,
    rechargeAllowedPlans,
    rechargeCredentialMatches,
    rechargeFingerprint,
    rechargePartnerApiPath,
    safeRechargeStage,
    safeRechargeTask,
    sealRechargeSecret,
    validateRechargeSession,
} from './security';
import { isStandaloneRechargeRequest } from './standalone-api';

const retryReason = 'verified_retry_available';
const pendingSubmission = ['submitting', 'submission_unknown'];
const partnerCode = /^RA-[A-F0-9]{32}$/;
const partnerKey = /^rp_[a-f0-9]{24}\.[A-Za-z0-9_-]{43}$/;
const requestKeyPattern = /^[a-zA-Z0-9._-]{1,120}$/;
type InternalCode = {
    plan: string;
    status: string;
    reason?: 'manual_review_required' | typeof retryReason;
    task?: unknown;
};
type UpstreamTaskSnapshot = {
    id: string;
    taskToken: string;
    stage?: string;
    progress?: RechargeProgress;
    accountEmail?: string;
    updatedAt?: number;
    partner?: boolean;
};
type ReceiptSnapshot = (UpstreamTaskSnapshot | { id?: never }) & { submissionId?: string };

type RechargeCredentials = { legacy?: string; partner?: string };
@Injectable()
export class GptRechargeService {
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
        const code = value.trim();
        return /^KC-(?:[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{15}|[A-F0-9]{28})$/i.test(code) ||
            partnerCode.test(code.toUpperCase())
            ? code.toUpperCase()
            : code;
    }
    private credentials(ctx: RequestContext, encrypted: string): RechargeCredentials {
        const [legacy, partner] = encrypted.split('.partner.');
        return {
            legacy: openRechargeSecret(legacy, this.context(ctx)) || undefined,
            partner: partner ? openRechargeSecret(partner, this.context(ctx) + ':partner') : undefined,
        };
    }
    async adminConfig(ctx: RequestContext) {
        const row = await this.configs(ctx).findOne({ where: { channelId: ctx.channelId } });
        const keys = row && this.credentials(ctx, row.encryptedServiceKey);
        return {
            enabled: row?.enabled ?? false,
            upstreamOrigin: row?.upstreamOrigin ?? '',
            credentialConfigured: Boolean(row?.encryptedServiceKey),
            legacyConfigured: Boolean(keys?.legacy),
            partnerConfigured: Boolean(keys?.partner),
            revision: row?.revision ?? -1,
        };
    }
    async saveConfig(
        ctx: RequestContext,
        input: {
            enabled: boolean;
            upstreamOrigin: string;
            serviceKey?: string | null;
            partnerApiKey?: string | null;
            expectedRevision: number;
        },
    ) {
        try {
            const origin = allowedRechargeOrigin(input.upstreamOrigin, true);
            const repository = this.configs(ctx);
            const prior = await repository.findOne({ where: { channelId: ctx.channelId } });
            if ((prior?.revision ?? -1) !== input.expectedRevision) throw new Error('Configuration changed');
            if (
                prior &&
                origin !== prior.upstreamOrigin &&
                (await this.receipts(ctx).count({ where: { channelId: ctx.channelId } }))
            )
                throw new Error('Existing tasks depend on this source');
            const keys =
                prior && origin === prior.upstreamOrigin
                    ? this.credentials(ctx, prior.encryptedServiceKey)
                    : {};
            if (
                (input.serviceKey && (input.serviceKey.length < 32 || input.serviceKey.length > 512)) ||
                (input.partnerApiKey && !partnerKey.test(input.partnerApiKey))
            )
                throw new Error('Invalid credential');
            if (input.serviceKey) keys.legacy = input.serviceKey;
            if (input.partnerApiKey) {
                if (
                    keys.partner &&
                    keys.partner.split('.')[0] !== input.partnerApiKey.split('.')[0] &&
                    (await this.receipts(ctx).count({ where: { channelId: ctx.channelId } }))
                )
                    throw new Error('Existing tasks belong to another partner');
                keys.partner = input.partnerApiKey;
            }
            if (!keys.legacy && !keys.partner) throw new Error('Missing credential');
            // The existing three segments still decrypt with older releases during a staged rollout.
            const legacy = sealRechargeSecret(keys.legacy ?? '', this.context(ctx));
            const encryptedServiceKey = keys.partner
                ? legacy + '.partner.' + sealRechargeSecret(keys.partner, this.context(ctx) + ':partner')
                : legacy;
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
            const channel = ctx.channel?.code;
            const response = await fetch(
                `${origin}/api/id-business-v2/online-recharge/integrations/vendure/${action}`,
                {
                    method: 'POST',
                    redirect: 'error',
                    signal: AbortSignal.timeout(20000),
                    headers: {
                        'content-type': 'application/json',
                        'x-vendure-recharge-key':
                            this.credentials(ctx, config.encryptedServiceKey).legacy ?? '',
                        'x-vendure-client-ip': ctx.req?.ip?.replace(/^::ffff:/, '') ?? '',
                        ...(channel ? { 'x-vendure-recharge-channel': channel } : {}),
                    },
                    body: JSON.stringify(body),
                },
            );
            if (response.status === 400 && (action === 'verify' || action === 'query')) {
                await response.body?.cancel().catch(() => undefined);
                throw new UserInputError('兑换码无效或已停用，请核对后重试');
            }
            if (!response.ok) throw new Error('Upstream request rejected');
            const raw = await readRechargeResponse(response);
            return JSON.parse(raw) as Record<string, unknown>;
        } catch (error) {
            if (error instanceof UserInputError) throw error;
            throw new UserInputError('充值服务暂时无法确认请求，请查询原兑换码');
        }
    }
    private async partnerUpstream(
        ctx: RequestContext,
        config: GptRechargeConfig,
        path: string,
        body?: object,
        requestKey?: string,
    ) {
        const key = this.credentials(ctx, config.encryptedServiceKey).partner;
        if (!key) throw new UserInputError('当前店铺尚未配置合作方充值 API');
        try {
            const origin = allowedRechargeOrigin(config.upstreamOrigin);
            const response = await fetch(origin + rechargePartnerApiPath + path, {
                method: body ? 'POST' : 'GET',
                redirect: 'error',
                signal: AbortSignal.timeout(20000),
                headers: {
                    authorization: 'Bearer ' + key,
                    ...(body && { 'content-type': 'application/json' }),
                    ...(requestKey && { 'idempotency-key': requestKey }),
                },
                ...(body && { body: JSON.stringify(body) }),
            });
            if (!response.ok) {
                await response.body?.cancel().catch(() => undefined);
                if (response.status === 404) throw new UserInputError('兑换码或任务不可用，请核对后重试');
                if (response.status === 409)
                    throw new UserInputError('已有充值请求或兑换码状态已变化，请查询原兑换码');
                throw new Error('Partner recharge request rejected');
            }
            return JSON.parse(await readRechargeResponse(response)) as Record<string, unknown>;
        } catch (error) {
            if (error instanceof UserInputError) throw error;
            throw new UserInputError('充值服务暂时无法确认请求，请查询原兑换码');
        }
    }
    async publicConfig(ctx: RequestContext, partnerOnly = isStandaloneRechargeRequest(ctx.req)) {
        const configured = await this.configs(ctx).findOne({ where: { channelId: ctx.channelId } });
        if (!configured?.enabled || !(await this.access.isEnabled(ctx, 'gpt-recharge-entry')))
            return { enabled: false, maintenance: false };
        const keys = this.credentials(ctx, configured.encryptedServiceKey);
        const checks = await Promise.allSettled([
            ...(keys.legacy && !partnerOnly ? [this.upstream(ctx, configured, 'config', {})] : []),
            ...(keys.partner ? [this.partnerUpstream(ctx, configured, '/config')] : []),
        ]);
        if (checks.length === 0) return { enabled: false, maintenance: false };
        if (checks.every(result => result.status === 'rejected'))
            throw new UserInputError('暂时无法确认充值服务');
        return {
            enabled: true,
            maintenance: !checks.some(
                result => result.status === 'fulfilled' && result.value.maintenance === false,
            ),
        };
    }
    private validateCodeResult(value: Record<string, unknown>): InternalCode {
        if (
            !rechargeAllowedPlans.includes(String(value.plan)) ||
            !['available', 'reserved', 'used', 'disabled'].includes(String(value.status))
        )
            throw new UserInputError('兑换码状态暂不可用');
        return {
            plan: String(value.plan),
            status: String(value.status),
            ...((value.status === 'reserved' && value.reason === 'manual_review_required') ||
            (value.status === 'available' && value.reason === retryReason)
                ? { reason: value.reason }
                : {}),
            task: value.task,
        };
    }
    async verify(ctx: RequestContext, code: string) {
        const config = await this.connectionConfig(ctx, true);
        code = this.code(code);
        const partner = partnerCode.test(code);
        if (partner) await this.assertCodeOwner(ctx, code, config.upstreamOrigin);
        const result = this.validateCodeResult(
            partner
                ? await this.partnerUpstream(ctx, config, '/codes/verify', { code })
                : await this.upstream(ctx, config, 'verify', { code }),
        );
        if (!partner) {
            if (result.reason === retryReason) await this.assertCodeOwner(ctx, code, config.upstreamOrigin);
            const row = await this.receipts(ctx).findOne({
                where: { publicId: this.codePublicId(code, config.upstreamOrigin), channelId: ctx.channelId },
            });
            if (row && pendingSubmission.includes(row.status)) {
                return { plan: row.plan, status: 'reserved', reason: 'manual_review_required', task: null };
            }
        }
        return { ...result, task: null };
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
    private receiptSnapshot(ctx: RequestContext, row: GptRechargeReceipt): ReceiptSnapshot | null {
        return row.encryptedUpstreamTask
            ? (JSON.parse(
                  openRechargeSecret(row.encryptedUpstreamTask, `${this.context(ctx)}:${row.publicId}`),
              ) as ReceiptSnapshot)
            : null;
    }
    private sealSnapshot(ctx: RequestContext, row: GptRechargeReceipt, snapshot: ReceiptSnapshot) {
        return sealRechargeSecret(JSON.stringify(snapshot), `${this.context(ctx)}:${row.publicId}`);
    }
    private taskSnapshot(ctx: RequestContext, row: GptRechargeReceipt): UpstreamTaskSnapshot | null {
        const snapshot = this.receiptSnapshot(ctx, row);
        return snapshot?.id ? snapshot : null;
    }
    private view(ctx: RequestContext, row: GptRechargeReceipt) {
        const status = ['new', 'submitting', 'submission_unknown'].includes(row.status)
            ? 'awaiting_review'
            : row.status;
        const snapshot = this.taskSnapshot(ctx, row);
        return {
            id: row.publicId,
            credential: rechargeFingerprint(row.publicId, `${this.context(ctx)}:task`),
            plan: row.plan,
            status,
            stage: safeRechargeStage(status, snapshot?.stage),
            ...(snapshot?.accountEmail && {
                accountEmail:
                    snapshot.partner || isStandaloneRechargeRequest(ctx.req)
                        ? snapshot.accountEmail.replace(/^(.).*(@.+)$/u, '$1***$2')
                        : snapshot.accountEmail,
            }),
            ...(snapshot?.progress && {
                progress: {
                    ...snapshot.progress,
                    attempt: rechargeFingerprint(snapshot.progress.attempt, `${this.context(ctx)}:attempt`),
                },
            }),
            updatedAt:
                snapshot?.updatedAt === undefined
                    ? (row.upstreamUpdatedAt ?? row.updatedAt)
                    : new Date(snapshot.updatedAt),
        };
    }
    private async capture(
        ctx: RequestContext,
        row: GptRechargeReceipt,
        raw: unknown,
        partner = false,
        expectedId?: string,
    ) {
        const value = safeRechargeTask(raw);
        const repository = this.receipts(ctx);
        for (let attempt = 0; attempt < 4; attempt++) {
            const current = await repository.findOneOrFail({
                where: { id: row.id, channelId: ctx.channelId },
            });
            const previous = this.taskSnapshot(ctx, current);
            if (expectedId && previous?.id !== expectedId) return this.view(ctx, current);
            // Reading the previous failure cannot settle a new submit whose response is missing.
            if (previous?.id === value.id && pendingSubmission.includes(current.status))
                return this.view(ctx, current);
            if (
                previous?.id === value.id &&
                previous.progress &&
                value.progress &&
                previous.progress.attempt === value.progress.attempt &&
                value.progress.version <= previous.progress.version
            )
                return this.view(ctx, current);
            const previousTime = previous?.updatedAt ?? current.upstreamUpdatedAt?.getTime();
            const nextTime = value.updatedAt.getTime();
            // The production datetime column stores whole seconds. Preserve the bridge's
            // precise timestamp in the snapshot so repeated or late polls cannot replace it.
            if (previous && previousTime !== undefined) {
                if (nextTime < previousTime) return this.view(ctx, current);
                if (
                    nextTime === previousTime &&
                    (previous.stage !== undefined || current.status !== value.status) &&
                    !(
                        value.progress &&
                        (!previous.progress || value.progress.version > previous.progress.version)
                    )
                )
                    return this.view(ctx, current);
            }
            const snapshot = partner
                ? { id: value.id, taskToken: '', partner: true }
                : value.taskToken
                  ? { id: value.id, taskToken: value.taskToken }
                  : previous?.id === value.id
                    ? previous
                    : null;
            if (!snapshot) throw new UserInputError('任务凭证暂不可用，请使用兑换码查询');
            // Retain the safe stage with the existing encrypted snapshot, under the same
            // timestamp/CAS guard. Old receipts without a stage remain readable.
            const encryptedUpstreamTask = sealRechargeSecret(
                JSON.stringify({
                    id: snapshot.id,
                    taskToken: snapshot.taskToken,
                    ...(snapshot.partner && { partner: true }),
                    stage: value.stage,
                    progress: value.progress ?? (previous?.id === value.id ? previous.progress : undefined),
                    accountEmail:
                        value.accountEmail ?? (previous?.id === value.id ? previous.accountEmail : undefined),
                    updatedAt: nextTime,
                }),
                `${this.context(ctx)}:${row.publicId}`,
            );
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
        const code = this.code(codeInput);
        const config = await this.connectionConfig(ctx, false);
        await this.assertCodeOwner(ctx, code, config.upstreamOrigin);
        const partner = partnerCode.test(code);
        const result = this.validateCodeResult(
            partner
                ? await this.partnerUpstream(ctx, config, '/codes/query', { code })
                : await this.upstream(ctx, config, 'query', { code }),
        );
        if (!result.task) {
            const pending = await this.receipts(ctx).findOne({
                where: { publicId: this.codePublicId(code, config.upstreamOrigin), channelId: ctx.channelId },
            });
            // An available-code read cannot disprove a timed-out submission still in flight.
            if (pending && pendingSubmission.includes(pending.status))
                return { plan: pending.plan, status: 'reserved', task: this.view(ctx, pending) };
            return { ...result, task: null };
        }
        const row = await this.receipt(ctx, code, result.plan, config.upstreamOrigin);
        const task = await this.capture(ctx, row, result.task, partner);
        if (result.reason !== retryReason || partner) return { ...result, task };
        const current = await this.receipts(ctx).findOneOrFail({
            where: { id: row.id, channelId: ctx.channelId },
        });
        const latest = this.view(ctx, current);
        if (
            latest.status === 'failed' &&
            this.taskSnapshot(ctx, current)?.id === safeRechargeTask(result.task).id
        )
            return { ...result, task: latest };
        return {
            plan: latest.plan,
            status: latest.status === 'succeeded' ? 'used' : 'reserved',
            ...(latest.status === 'awaiting_review' && { reason: 'manual_review_required' }),
            task: latest,
        };
    }
    async submit(ctx: RequestContext, codeInput: string, session: string) {
        const code = this.code(codeInput);
        if (partnerCode.test(code)) throw new GptRechargeNotAcceptedError();
        validateRechargeSession(session);
        const config = await this.connectionConfig(ctx, true);
        await this.assertCodeOwner(ctx, code, config.upstreamOrigin);
        // Recover first. A transport error must never create another payment attempt.
        const queried = this.validateCodeResult(await this.upstream(ctx, config, 'query', { code }));
        if (!queried.task && (queried.status !== 'available' || queried.reason === retryReason))
            throw new UserInputError(
                queried.reason === 'manual_review_required' ? '上次开通结果待核对' : '兑换码暂不可用',
            );
        const repository = this.receipts(ctx);
        let row = await this.receipt(ctx, code, queried.plan, config.upstreamOrigin);
        let afterFailedTask: string | undefined;
        if (queried.task) {
            const snapshot = await this.capture(ctx, row, queried.task);
            if (queried.reason !== retryReason || snapshot.status !== 'failed') return snapshot;
            const failed = safeRechargeTask(queried.task);
            if (failed.status !== 'failed' || failed.plan !== queried.plan) return snapshot;
            row = await repository.findOneOrFail({ where: { id: row.id, channelId: ctx.channelId } });
            if (row.status !== 'failed' || this.taskSnapshot(ctx, row)?.id !== failed.id)
                return this.view(ctx, row);
            afterFailedTask = failed.id;
        }
        const expectedStatus = afterFailedTask ? 'failed' : 'new';
        const claimRevision = row.revision + 1;
        const submissionId = randomUUID();
        const prior = this.taskSnapshot(ctx, row);
        const encryptedUpstreamTask = this.sealSnapshot(
            ctx,
            row,
            prior ? { ...prior, submissionId } : { submissionId },
        );
        const claimed = await repository.update(
            { id: row.id, channelId: ctx.channelId, revision: row.revision, status: expectedStatus },
            { status: 'submitting', revision: claimRevision, encryptedUpstreamTask },
        );
        if (!claimed.affected)
            return this.view(
                ctx,
                await repository.findOneOrFail({ where: { id: row.id, channelId: ctx.channelId } }),
            );
        const claim = { id: row.id, channelId: ctx.channelId, revision: claimRevision, status: 'submitting' };
        try {
            const result = await this.upstream(ctx, config, 'submit', {
                code,
                session,
                submissionId,
                ...(afterFailedTask && { afterFailedTask }),
            });
            if (result.rejected === true) {
                await repository.update(claim, {
                    status: expectedStatus,
                    revision: claimRevision + 1,
                    encryptedUpstreamTask: row.encryptedUpstreamTask,
                });
                throw new GptRechargeNotAcceptedError();
            }
            if (afterFailedTask && result.id === afterFailedTask)
                throw new Error('Retry reply identifies the previous receipt');
            return await this.capture(ctx, row, result);
        } catch (error) {
            if (error instanceof GptRechargeNotAcceptedError) throw error;
            // Persist only an ambiguous state, never raw account JSON or the code.
            await repository.update(claim, { status: 'submission_unknown', revision: claimRevision + 1 });
            throw new UserInputError('提交结果待核对，请使用原兑换码查询');
        }
    }
    private async submissionReceipt(ctx: RequestContext, input: string) {
        const code = this.code(input);
        if (partnerCode.test(code)) throw new UserInputError('合作方兑换码请在 ID 后台核对');
        const config = await this.connectionConfig(ctx, false);
        const row = await this.receipts(ctx).findOne({
            where: { publicId: this.codePublicId(code, config.upstreamOrigin), channelId: ctx.channelId },
        });
        return { code, config, row };
    }

    async submissionReview(ctx: RequestContext, input: string) {
        const { row } = await this.submissionReceipt(ctx, input);
        return { pending: !!row && pendingSubmission.includes(row.status), revision: row?.revision ?? -1 };
    }

    async recoverSubmission(ctx: RequestContext, input: string, expectedRevision: number) {
        const { code, config, row } = await this.submissionReceipt(ctx, input);
        if (!row || !pendingSubmission.includes(row.status) || row.revision !== expectedRevision)
            throw new UserInputError('待核对记录已变化，请重新查询');
        const priorTask = this.taskSnapshot(ctx, row);
        const submissionId = this.receiptSnapshot(ctx, row)?.submissionId;
        const result = await this.upstream(ctx, config, 'task', {
            action: 'reconcile',
            code,
            ...(submissionId && { submissionId }),
            ...(priorTask && { afterFailedTask: priorTask.id }),
        });
        if (result.fenced !== true) throw new UserInputError('原提交仍无法确认未受理，已保留锁定');
        const status = priorTask ? 'failed' : 'new';
        const update = await this.receipts(ctx).update(
            { id: row.id, channelId: ctx.channelId, status: row.status, revision: row.revision },
            {
                status,
                revision: row.revision + 1,
                encryptedUpstreamTask: priorTask
                    ? this.sealSnapshot(ctx, row, { ...priorTask, submissionId: undefined })
                    : null,
            },
        );
        if (!update.affected) throw new UserInputError('待核对记录已变化，请重新查询');
        Logger.info(
            `Recovered unaccepted recharge submission ${row.publicId} for channel ${ctx.channelId} ` +
                `at revision ${row.revision} by administrator ${ctx.activeUserId ?? 'unknown'}`,
            'GptRecharge',
        );
        return { pending: false, revision: row.revision + 1 };
    }
    async startAuthorization(ctx: RequestContext, codeInput: string, requestKey: string) {
        const code = this.code(codeInput);
        if (!partnerCode.test(code) || !requestKeyPattern.test(requestKey))
            throw new UserInputError('兑换码或请求编号格式无效');
        const config = await this.connectionConfig(ctx, true);
        await this.assertCodeOwner(ctx, code, config.upstreamOrigin);
        const checked = this.validateCodeResult(
            await this.partnerUpstream(ctx, config, '/codes/query', { code }),
        );
        const row = await this.receipt(ctx, code, checked.plan, config.upstreamOrigin);
        const raw = await this.partnerUpstream(ctx, config, '/redemptions', { code }, requestKey);
        const task = await this.capture(ctx, row, raw, true);
        let authorizationUrl: string | undefined;
        if (
            typeof raw.authorizationUrl === 'string' &&
            typeof raw.id === 'string' &&
            task.status === 'awaiting_authorization'
        ) {
            const url = new URL(raw.authorizationUrl);
            if (
                url.origin !== config.upstreamOrigin ||
                url.username ||
                url.password ||
                url.search ||
                url.pathname !== '/recharge/authorize' ||
                !/^#[a-f0-9-]{36}\.[A-Za-z0-9_-]{43}$/.test(url.hash) ||
                !url.hash.startsWith('#' + raw.id + '.')
            )
                throw new UserInputError('充值授权链接暂不可用');
            authorizationUrl = url.href;
        }
        return { authorizationUrl, task };
    }
    async watchTask(
        ctx: RequestContext,
        publicId: string,
        credential: string,
        signal: AbortSignal,
        onReady: () => void,
        onTask: (task: ReturnType<GptRechargeService['view']>) => void,
    ) {
        const expected = rechargeFingerprint(publicId, `${this.context(ctx)}:task`);
        if (!rechargeCredentialMatches(expected, credential)) throw new ForbiddenError();
        const row = await this.receipts(ctx).findOne({ where: { publicId, channelId: ctx.channelId } });
        if (!row) throw new ForbiddenError();
        if (['succeeded', 'failed', 'expired'].includes(row.status)) {
            onReady();
            onTask(this.view(ctx, row));
            return;
        }
        const input = this.taskSnapshot(ctx, row);
        if (!input) throw new UserInputError('进度推送暂不可用，请查询原任务');
        const config = await this.connectionConfig(ctx, false);
        const origin = allowedRechargeOrigin(config.upstreamOrigin);
        const keys = this.credentials(ctx, config.encryptedServiceKey);
        const connect = new AbortController();
        const timer = setTimeout(() => connect.abort(), 10000);
        let response: Response;
        try {
            response = await fetch(
                origin +
                    (input.partner
                        ? rechargePartnerApiPath + '/redemptions/' + input.id
                        : '/api/id-business-v2/online-recharge/integrations/vendure/task'),
                {
                    method: input.partner ? 'GET' : 'POST',
                    redirect: 'error',
                    signal: AbortSignal.any([signal, connect.signal]),
                    headers: {
                        accept: 'text/event-stream',
                        ...(input.partner
                            ? { authorization: 'Bearer ' + (keys.partner ?? '') }
                            : {
                                  'content-type': 'application/json',
                                  'x-vendure-recharge-key': keys.legacy ?? '',
                                  'x-vendure-client-ip': ctx.req?.ip?.replace(/^::ffff:/, '') ?? '',
                                  'x-vendure-recharge-channel': ctx.channel.code,
                              }),
                    },
                    ...(!input.partner && {
                        body: JSON.stringify({ id: input.id, taskToken: input.taskToken }),
                    }),
                },
            );
        } finally {
            clearTimeout(timer);
        }
        if (
            !response.ok ||
            !response.body ||
            !response.headers.get('content-type')?.startsWith('text/event-stream')
        ) {
            await response.body?.cancel().catch(() => undefined);
            throw new UserInputError('进度推送暂不可用，请查询原任务');
        }
        onReady();
        await readRechargeProgressStream(response.body, signal, async raw => {
            if ((raw as { id?: unknown })?.id !== input.id) throw new ForbiddenError();
            const task = await this.capture(ctx, row, raw, Boolean(input.partner), input.id);
            if (!signal.aborted) onTask(task);
        });
    }
    async task(ctx: RequestContext, publicId: string, credential: string) {
        const expected = rechargeFingerprint(publicId, `${this.context(ctx)}:task`);
        if (!rechargeCredentialMatches(expected, credential)) throw new ForbiddenError();
        const row = await this.receipts(ctx).findOne({ where: { publicId, channelId: ctx.channelId } });
        if (!row) throw new ForbiddenError();
        if (!row.encryptedUpstreamTask || ['succeeded', 'failed', 'expired'].includes(row.status))
            return this.view(ctx, row);
        const input = this.taskSnapshot(ctx, row);
        if (!input) return this.view(ctx, row);
        const config = await this.connectionConfig(ctx, false);
        if (input.partner)
            return this.capture(
                ctx,
                row,
                await this.partnerUpstream(ctx, config, '/redemptions/' + input.id),
                true,
                input.id,
            );
        return this.capture(
            ctx,
            row,
            await this.upstream(ctx, config, 'task', {
                id: input.id,
                taskToken: input.taskToken,
            }),
            false,
            input.id,
        );
    }
}

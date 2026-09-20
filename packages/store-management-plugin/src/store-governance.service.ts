import { Inject, Injectable } from '@nestjs/common';
import { ID } from '@vendure/common/lib/shared-types';
import {
    ForbiddenError,
    idsAreEqual,
    RequestContext,
    TransactionalConnection,
    UserInputError,
} from '@vendure/core';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

import { AdministratorAccessService } from './administrator-access.service';
import { AdministratorPermissionAuditService } from './administrator-permission-audit.service';
import { STOREFRONT_PROMOTION_OPTIONS } from './constants';
import {
    StoreGovernanceChangeRequest,
    StoreGovernanceChangeType,
} from './entities/store-governance-change-request.entity';
import { StoreProfile } from './entities/store-profile.entity';
import { StorefrontPromotionPluginOptions } from './types';

export interface SubmitStoreGovernanceChangeInput {
    requestType: StoreGovernanceChangeType;
    payload: Record<string, unknown>;
}

export interface ReviewStoreGovernanceChangeInput {
    id: ID;
    decision: 'APPROVED' | 'REJECTED';
    reason?: string | null;
}

@Injectable()
export class StoreGovernanceService {
    private readonly key: Buffer;

    constructor(
        private readonly connection: TransactionalConnection,
        private readonly accessService: AdministratorAccessService,
        private readonly audit: AdministratorPermissionAuditService,
        @Inject(STOREFRONT_PROMOTION_OPTIONS) options: Required<StorefrontPromotionPluginOptions>,
    ) {
        this.key = createHash('sha256').update(options.signingSecret).digest();
    }

    async myRequests(ctx: RequestContext): Promise<StoreGovernanceChangeRequest[]> {
        const actor = await this.accessService.current(ctx);
        if (actor.scope !== 'STORE' || !actor.channelId) throw new ForbiddenError();
        return this.connection.getRepository(ctx, StoreGovernanceChangeRequest).find({
            where: { channelId: actor.channelId },
            relations: { channel: true },
            order: { createdAt: 'DESC' },
        });
    }

    async reviewQueue(ctx: RequestContext, channelId?: ID | null): Promise<StoreGovernanceChangeRequest[]> {
        const actor = await this.accessService.current(ctx);
        if (actor.scope !== 'PLATFORM') {
            throw new ForbiddenError();
        }
        return this.connection.getRepository(ctx, StoreGovernanceChangeRequest).find({
            where: channelId ? { channelId } : {},
            relations: { channel: true },
            order: { createdAt: 'DESC' },
        });
    }

    async reviewPayload(
        ctx: RequestContext,
        request: StoreGovernanceChangeRequest,
    ): Promise<Record<string, unknown>> {
        const actor = await this.accessService.current(ctx);
        if (actor.scope !== 'PLATFORM') throw new ForbiddenError();
        return this.decrypt(request.encryptedPayload);
    }

    async submit(
        ctx: RequestContext,
        input: SubmitStoreGovernanceChangeInput,
    ): Promise<StoreGovernanceChangeRequest> {
        const actor = await this.accessService.current(ctx);
        if (actor.scope !== 'STORE' || !actor.channelId || actor.status !== 'ACTIVE') {
            throw new ForbiddenError();
        }
        if (
            !['LEGAL_IDENTITY', 'PAYOUT_ACCOUNT', 'PAYMENT_CONFIGURATION', 'USDT_WALLET'].includes(
                input.requestType,
            )
        ) {
            throw new UserInputError('不支持的店铺治理申请类型');
        }
        this.validatePayload(input.requestType, input.payload);
        const repository = this.connection.getRepository(ctx, StoreGovernanceChangeRequest);
        const latest = await repository.findOne({
            where: { channelId: actor.channelId, requestType: input.requestType },
            order: { version: 'DESC' },
        });
        if (latest?.status === 'PENDING') {
            throw new UserInputError('该类型已有待审核申请，请等待审核完成后再提交');
        }
        const pending = new StoreGovernanceChangeRequest({
            channelId: actor.channelId,
            requestType: input.requestType,
            version: (latest?.version ?? 0) + 1,
            status: 'PENDING',
            submittedByUserId: actor.userId,
            reviewedByUserId: null,
            encryptedPayload: this.encrypt(input.payload),
            reviewReason: null,
            submittedAt: new Date(),
            reviewedAt: null,
        });
        pending.maskedSummary = maskPayload(input.payload);
        const request = await repository.save(pending);
        await this.audit.record(ctx, {
            action: 'SUBMIT_STORE_GOVERNANCE_CHANGE',
            channelId: actor.channelId,
            afterSummary: {
                requestId: String(request.id),
                requestType: request.requestType,
                version: request.version,
            },
        });
        return request;
    }

    async review(
        ctx: RequestContext,
        input: ReviewStoreGovernanceChangeInput,
    ): Promise<StoreGovernanceChangeRequest> {
        const actor = await this.accessService.current(ctx);
        if (actor.scope !== 'PLATFORM') {
            throw new ForbiddenError();
        }
        const repository = this.connection.getRepository(ctx, StoreGovernanceChangeRequest);
        const request = await repository.findOne({ where: { id: input.id }, relations: { channel: true } });
        if (!request) throw new UserInputError('店铺治理申请不存在');
        if (request.status !== 'PENDING') throw new UserInputError('该申请已经完成审核');
        if (!['APPROVED', 'REJECTED'].includes(input.decision)) {
            throw new UserInputError('审核结果只能是通过或驳回');
        }
        if (input.decision === 'REJECTED' && !input.reason?.trim()) {
            throw new UserInputError('驳回时必须填写原因');
        }
        if (input.decision === 'APPROVED') {
            await this.applyApprovedChange(ctx, request);
        }
        request.status = input.decision;
        request.reviewedByUserId = actor.userId;
        request.reviewedAt = new Date();
        request.reviewReason = input.reason?.trim() || null;
        const saved = await repository.save(request);
        await this.audit.record(ctx, {
            action: 'REVIEW_STORE_GOVERNANCE_CHANGE',
            channelId: request.channelId,
            afterSummary: {
                requestId: String(request.id),
                requestType: request.requestType,
                decision: request.status,
            },
        });
        return saved;
    }

    async assertRequestBelongsToActiveStore(ctx: RequestContext, requestId: ID): Promise<void> {
        const actor = await this.accessService.current(ctx);
        const request = await this.connection.getRepository(ctx, StoreGovernanceChangeRequest).findOne({
            where: { id: requestId },
        });
        if (!request || !idsAreEqual(request.channelId, actor.channelId)) throw new ForbiddenError();
    }

    private async applyApprovedChange(
        ctx: RequestContext,
        request: StoreGovernanceChangeRequest,
    ): Promise<void> {
        const payload = this.decrypt(request.encryptedPayload);
        if (request.requestType === 'LEGAL_IDENTITY') {
            const repository = this.connection.getRepository(ctx, StoreProfile);
            const profile = await repository.findOne({ where: { channelId: request.channelId } });
            if (!profile) throw new UserInputError('店铺资料不存在');
            profile.legalEntityName = requiredText(payload.legalEntityName, '主体名称');
            profile.legalRegistrationCountry = requiredText(
                payload.legalRegistrationCountry,
                '主体注册国家或地区',
            );
            await repository.save(profile);
        }
    }

    private validatePayload(type: StoreGovernanceChangeType, payload: Record<string, unknown>): void {
        if (!payload || Array.isArray(payload) || typeof payload !== 'object') {
            throw new UserInputError('申请内容格式不正确');
        }
        if (type === 'LEGAL_IDENTITY') {
            requiredText(payload.legalEntityName, '主体名称');
            requiredText(payload.legalRegistrationCountry, '主体注册国家或地区');
            return;
        }
        if (type === 'PAYOUT_ACCOUNT') {
            requiredText(payload.provider, '收款机构');
            requiredText(payload.accountHolder, '账户持有人');
            requiredText(payload.accountIdentifier, '收款账号');
            return;
        }
        if (type === 'PAYMENT_CONFIGURATION') {
            throw new UserInputError('支付方式请使用本店支付选项的专用启停流程');
        }
        if (type === 'USDT_WALLET') {
            throw new UserInputError('USDT 钱包请使用专用的钱包提交审核流程');
        }
    }

    private encrypt(payload: Record<string, unknown>): string {
        const iv = randomBytes(12);
        const cipher = createCipheriv('aes-256-gcm', this.key, iv);
        const ciphertext = Buffer.concat([cipher.update(JSON.stringify(payload), 'utf8'), cipher.final()]);
        return [
            'v1',
            iv.toString('base64url'),
            cipher.getAuthTag().toString('base64url'),
            ciphertext.toString('base64url'),
        ].join('.');
    }

    private decrypt(envelope: string): Record<string, unknown> {
        const [version, iv, tag, ciphertext] = envelope.split('.');
        if (version !== 'v1' || !iv || !tag || !ciphertext) throw new UserInputError('申请内容无法解密');
        const decipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(iv, 'base64url'));
        decipher.setAuthTag(Buffer.from(tag, 'base64url'));
        return JSON.parse(
            Buffer.concat([decipher.update(Buffer.from(ciphertext, 'base64url')), decipher.final()]).toString(
                'utf8',
            ),
        ) as Record<string, unknown>;
    }
}

function maskPayload(payload: Record<string, unknown>): Record<string, unknown> {
    return Object.fromEntries(
        Object.entries(payload).map(([key, value]) => {
            if (typeof value !== 'string') return [key, value];
            if (/country|type|provider|method/i.test(key)) return [key, value];
            if (value.length <= 4) return [key, '*'.repeat(value.length)];
            return [key, `${value.slice(0, 2)}***${value.slice(-2)}`];
        }),
    );
}

function requiredText(value: unknown, label: string): string {
    if (typeof value !== 'string' || !value.trim()) throw new UserInputError(`${label}不能为空`);
    return value.trim();
}

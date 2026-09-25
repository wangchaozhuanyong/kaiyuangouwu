import { Injectable } from '@nestjs/common';
import {
    Customer,
    CustomerService,
    ID,
    Order,
    Permission,
    RequestContext,
    TransactionalConnection,
    UserInputError,
} from '@vendure/core';
import { IsNull, MoreThan, Not } from 'typeorm';

import { AfterSalesEvidenceStorageService, EvidenceUpload } from './after-sales-evidence-storage.service';
import { afterSalesEligibleOrderStates } from './after-sales.constants';
import { normalizeDigitalDeliveryHost } from './digital-delivery-token.service';
import { AfterSalesEvidence } from './entities/after-sales-evidence.entity';
import { AfterSalesRequest } from './entities/after-sales-request.entity';

export const AFTER_SALES_EVIDENCE_LIMIT = 6;
export const EVIDENCE_RETENTION_MS = 180 * 24 * 60 * 60_000;
export const EVIDENCE_DRAFT_RETENTION_MS = 24 * 60 * 60_000;

export function evidenceExpiresAt(
    evidence: Pick<AfterSalesEvidence, 'requestId' | 'request' | 'createdAt'>,
): Date | null {
    if (!evidence.requestId) return new Date(evidence.createdAt.getTime() + EVIDENCE_DRAFT_RETENTION_MS);
    const request = evidence.request;
    if (!request) return null;
    const closedAt =
        request.state === 'COMPLETED'
            ? request.completedAt
            : request.state === 'CANCELLED'
              ? request.cancelledAt
              : request.state === 'REJECTED'
                ? request.respondedAt
                : null;
    return closedAt ? new Date(closedAt.getTime() + EVIDENCE_RETENTION_MS) : null;
}

@Injectable()
export class AfterSalesEvidenceService {
    constructor(
        private readonly connection: TransactionalConnection,
        private readonly customers: CustomerService,
        private readonly storage: AfterSalesEvidenceStorageService,
    ) {}

    async upload(ctx: RequestContext, orderId: ID, upload: Promise<EvidenceUpload>) {
        const customer = await this.customer(ctx);
        const order = await this.ownedOrder(ctx, orderId, customer.id);
        if (!afterSalesEligibleOrderStates.includes(order.state))
            throw new UserInputError('当前订单状态暂不支持上传售后凭证');
        const prepared = await this.storage.prepare(await upload);
        // Reserve the row before writing bytes. A crash leaves a tracked draft,
        // so the scheduled draft cleanup can remove it without scanning other media.
        const evidence = await this.connection.withTransaction(ctx, async tx => {
            await this.lockOrder(tx, orderId);
            const currentOrder = await this.ownedOrder(tx, orderId, customer.id);
            if (!afterSalesEligibleOrderStates.includes(currentOrder.state))
                throw new UserInputError('当前订单状态暂不支持上传售后凭证');
            const repository = this.connection.getRepository(tx, AfterSalesEvidence);
            const count = await repository.count({
                where: {
                    customerId: customer.id,
                    channelId: tx.channelId,
                    orderId,
                    requestId: IsNull(),
                    deletedAt: IsNull(),
                    createdAt: MoreThan(new Date(Date.now() - EVIDENCE_DRAFT_RETENTION_MS)),
                },
            });
            if (count >= AFTER_SALES_EVIDENCE_LIMIT)
                throw new UserInputError('每次售后最多上传 6 张凭证，请先移除不需要的图片');
            return repository.save(
                new AfterSalesEvidence({
                    customerId: customer.id,
                    channelId: tx.channelId,
                    orderId,
                    requestId: null,
                    storageKey: prepared.storageKey,
                    sha256: prepared.sha256,
                    mimeType: prepared.mimeType,
                    byteSize: prepared.bytes.length,
                    readyAt: null,
                    deletedAt: null,
                    storageDeletedAt: null,
                }),
            );
        });
        try {
            await this.storage.write(evidence.storageKey, prepared.bytes);
            evidence.readyAt = new Date();
            await this.connection
                .getRepository(ctx, AfterSalesEvidence)
                .update(evidence.id, { readyAt: evidence.readyAt });
        } catch (error) {
            await this.connection
                .getRepository(ctx, AfterSalesEvidence)
                .update(evidence.id, { deletedAt: new Date() });
            await this.deleteBytes(evidence).catch(() => undefined);
            throw error;
        }
        return this.view(ctx, evidence);
    }

    async drafts(ctx: RequestContext, orderId: ID) {
        const customer = await this.customer(ctx);
        await this.ownedOrder(ctx, orderId, customer.id);
        const rows = await this.connection.getRepository(ctx, AfterSalesEvidence).find({
            where: {
                customerId: customer.id,
                channelId: ctx.channelId,
                orderId,
                requestId: IsNull(),
                deletedAt: IsNull(),
                readyAt: Not(IsNull()),
            },
            order: { createdAt: 'ASC', id: 'ASC' },
        });
        return rows.filter(row => this.available(row)).map(row => this.view(ctx, row));
    }

    async removeDraft(ctx: RequestContext, id: ID): Promise<boolean> {
        const customer = await this.customer(ctx);
        const removed = await this.connection.withTransaction(ctx, async tx => {
            const repository = this.connection.getRepository(tx, AfterSalesEvidence);
            const row = await repository.findOne({
                where: { id, customerId: customer.id, channelId: tx.channelId },
            });
            if (!row) throw new UserInputError('凭证不存在或无权访问');
            await this.lockOrder(tx, row.orderId);
            await this.ownedOrder(tx, row.orderId, customer.id);
            const current = await this.lockEvidence(tx, id);
            if (!current || current.requestId) throw new UserInputError('已提交的凭证不能移除');
            if (!current.deletedAt) await repository.update(id, { deletedAt: new Date() });
            return current;
        });
        await this.deleteBytes(removed).catch(() => undefined);
        return true;
    }

    async attach(ctx: RequestContext, request: AfterSalesRequest, ids: ID[] = []): Promise<void> {
        if (
            !Array.isArray(ids) ||
            ids.length > AFTER_SALES_EVIDENCE_LIMIT ||
            new Set(ids.map(String)).size !== ids.length
        )
            throw new UserInputError('凭证数量无效或重复');
        for (const id of [...ids].sort((a, b) => String(a).localeCompare(String(b)))) {
            const row = await this.lockEvidence(ctx, id);
            if (
                !row ||
                String(row.channelId) !== String(request.channelId) ||
                String(row.customerId) !== String(request.customerId) ||
                String(row.orderId) !== String(request.orderId) ||
                !this.available(row) ||
                (row.requestId && String(row.requestId) !== String(request.id))
            )
                throw new UserInputError('凭证不存在、已失效或不属于此订单');
            if (!row.requestId)
                await this.connection
                    .getRepository(ctx, AfterSalesEvidence)
                    .update(row.id, { requestId: request.id });
        }
    }

    async forRequest(ctx: RequestContext, requestId: ID) {
        const customer = ctx.apiType === 'shop' ? await this.customer(ctx) : undefined;
        if (ctx.apiType === 'admin' && !ctx.userHasPermissions([Permission.ReadOrder]))
            throw new UserInputError('无权查看售后凭证');
        const request = await this.connection.getRepository(ctx, AfterSalesRequest).findOne({
            where: {
                id: requestId,
                channelId: ctx.channelId,
                ...(customer ? { customerId: customer.id } : {}),
                order: { salesChannelId: ctx.channelId },
            },
        });
        if (!request) throw new UserInputError('售后申请不存在或无权访问');
        const rows = await this.connection.getRepository(ctx, AfterSalesEvidence).find({
            where: {
                requestId,
                channelId: ctx.channelId,
                customerId: request.customerId,
                orderId: request.orderId,
            },
            order: { createdAt: 'ASC', id: 'ASC' },
        });
        return rows.map(row => this.view(ctx, Object.assign(row, { request })));
    }

    async authorize(token: string, host: unknown): Promise<AfterSalesEvidence | undefined> {
        const link = this.storage.verify(token, host);
        if (!link) return;
        const row = await this.connection.rawConnection.getRepository(AfterSalesEvidence).findOne({
            where: {
                id: link.id,
                channelId: link.channelId,
                customerId: link.customerId,
                order: { salesChannelId: link.channelId, customerId: link.customerId },
            },
            relations: { request: true },
        });
        if (!row || !this.available(row)) return;
        if (
            row.requestId &&
            (!row.request ||
                String(row.request.channelId) !== String(row.channelId) ||
                String(row.request.customerId) !== String(row.customerId) ||
                String(row.request.orderId) !== String(row.orderId))
        )
            return;
        return row;
    }

    async read(row: AfterSalesEvidence): Promise<Buffer> {
        return this.storage.read(row.storageKey, row.byteSize, row.sha256);
    }

    async purgeExpired(): Promise<number> {
        const now = new Date();
        const repository = this.connection.rawConnection.getRepository(AfterSalesEvidence);
        const candidates = await repository
            .createQueryBuilder('evidence')
            .leftJoin('evidence.request', 'request')
            .where('(evidence.deletedAt IS NOT NULL AND evidence.storageDeletedAt IS NULL)')
            .orWhere(
                '(evidence.deletedAt IS NULL AND evidence.requestId IS NULL AND evidence.createdAt <= :draft)',
                { draft: new Date(now.getTime() - EVIDENCE_DRAFT_RETENTION_MS) },
            )
            .orWhere(
                `(evidence.deletedAt IS NULL AND (
                    (request.state = :completed AND request.completedAt <= :closed) OR
                    (request.state = :cancelled AND request.cancelledAt <= :closed) OR
                    (request.state = :rejected AND request.respondedAt <= :closed)
                ))`,
                {
                    completed: 'COMPLETED',
                    cancelled: 'CANCELLED',
                    rejected: 'REJECTED',
                    closed: new Date(now.getTime() - EVIDENCE_RETENTION_MS),
                },
            )
            .orderBy('evidence.createdAt', 'ASC')
            .take(100)
            .getMany();
        let removed = 0;
        for (const candidate of candidates) {
            const marked = await this.connection.withTransaction(async tx => {
                await this.lockOrder(tx, candidate.orderId);
                if (candidate.requestId) {
                    const requests = this.connection.getRepository(tx, AfterSalesRequest);
                    await requests
                        .createQueryBuilder()
                        .update()
                        .set({ updatedAt: () => 'updatedAt' })
                        .where('id = :id', { id: candidate.requestId })
                        .execute();
                }
                const current = await this.lockEvidence(tx, candidate.id);
                if (!current || current.storageDeletedAt) return null;
                if (current.requestId)
                    current.request = await this.connection
                        .getRepository(tx, AfterSalesRequest)
                        .findOne({ where: { id: current.requestId } });
                const expiry = evidenceExpiresAt(current);
                if (!current.deletedAt && (!expiry || expiry.getTime() > Date.now())) return null;
                if (!current.deletedAt)
                    await this.connection
                        .getRepository(tx, AfterSalesEvidence)
                        .update(current.id, { deletedAt: new Date() });
                return current;
            });
            if (marked) {
                try {
                    await this.deleteBytes(marked);
                    removed++;
                } catch {
                    /* Marked rows retry on the next sweep. */
                }
            }
        }
        return removed;
    }

    private available(row: AfterSalesEvidence): boolean {
        const expiry = evidenceExpiresAt(row);
        return Boolean(row.readyAt && !row.deletedAt && (!expiry || expiry.getTime() > Date.now()));
    }

    private view(ctx: RequestContext, row: AfterSalesEvidence) {
        const host = normalizeDigitalDeliveryHost(
            ctx.req?.headers?.['x-forwarded-host'] ?? ctx.req?.headers?.host,
        );
        const available = this.available(row);
        return {
            id: row.id,
            createdAt: row.createdAt,
            mimeType: row.mimeType,
            byteSize: row.byteSize,
            expiresAt: evidenceExpiresAt(row),
            available,
            previewUrl:
                available && host
                    ? this.storage.sign({
                          id: String(row.id),
                          customerId: String(row.customerId),
                          channelId: String(row.channelId),
                          host,
                      })
                    : null,
        };
    }

    private async customer(ctx: RequestContext): Promise<Customer> {
        if (!ctx.activeUserId) throw new UserInputError('请先登录');
        const customer = await this.customers.findOneByUserId(ctx, ctx.activeUserId);
        if (!customer) throw new UserInputError('当前账号没有客户资料');
        return customer;
    }

    private async ownedOrder(ctx: RequestContext, id: ID, customerId: ID): Promise<Order> {
        const order = await this.connection
            .getRepository(ctx, Order)
            .findOne({ where: { id, customerId, salesChannelId: ctx.channelId } });
        if (!order) throw new UserInputError('订单不存在或无权访问');
        return order;
    }

    private async lockOrder(ctx: RequestContext, id: ID): Promise<void> {
        await this.connection
            .getRepository(ctx, Order)
            .createQueryBuilder()
            .update()
            .set({ updatedAt: () => 'updatedAt' })
            .where('id = :id', { id })
            .execute();
    }

    private lockEvidence(ctx: RequestContext, id: ID): Promise<AfterSalesEvidence | null> {
        const query = this.connection
            .getRepository(ctx, AfterSalesEvidence)
            .createQueryBuilder('evidence')
            .where('evidence.id = :id', { id });
        if (['mysql', 'mariadb', 'postgres'].includes(this.connection.rawConnection.options.type))
            query.setLock('pessimistic_write');
        return query.getOne();
    }

    private async deleteBytes(row: AfterSalesEvidence): Promise<void> {
        await this.storage.remove(row.storageKey);
        await this.connection.rawConnection
            .getRepository(AfterSalesEvidence)
            .update(row.id, { storageDeletedAt: new Date() });
    }
}

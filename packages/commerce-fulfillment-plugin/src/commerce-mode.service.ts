import { Injectable } from '@nestjs/common';
import {
    Channel,
    ChannelService,
    ID,
    Order,
    Product,
    RequestContext,
    TransactionalConnection,
    UserInputError,
    isGraphQlErrorResult,
} from '@vendure/core';
import { In, Not } from 'typeorm';

import { ProductPackagingRule } from './entities/product-packaging-rule.entity';
import { FulfillmentType, StoreCommerceMode } from './types';

const TERMINAL_ORDER_STATES = ['Cancelled', 'Delivered'] as const;

export interface CommerceModeConflict {
    code: 'INCOMPATIBLE_PRODUCT' | 'OPEN_ORDER' | 'PACKAGING_CONFIGURATION';
    message: string;
    entityId: string;
}

@Injectable()
export class CommerceModeService {
    constructor(
        private readonly connection: TransactionalConnection,
        private readonly channelService: ChannelService,
    ) {}

    modeForChannel(channel: Pick<Channel, 'customFields'>): StoreCommerceMode {
        const value = channel.customFields?.commerceMode;
        return value === 'PHYSICAL_ONLY' || value === 'HYBRID' ? value : 'DIGITAL_ONLY';
    }

    async activeMode(ctx: RequestContext): Promise<StoreCommerceMode> {
        const channel = await this.connection.getEntityOrThrow(ctx, Channel, ctx.channelId);
        return this.modeForChannel(channel);
    }

    assertProductTypeAllowed(mode: StoreCommerceMode, fulfillmentType: FulfillmentType): void {
        if (mode === 'DIGITAL_ONLY' && fulfillmentType !== 'digital') {
            throw new UserInputError('当前店铺仅经营虚拟商品，不能创建或保存实物商品');
        }
        if (mode === 'PHYSICAL_ONLY' && fulfillmentType !== 'physical') {
            throw new UserInputError('当前店铺仅经营实物商品，不能创建或保存虚拟商品');
        }
    }

    async conflicts(
        ctx: RequestContext,
        channelId: ID,
        targetMode: StoreCommerceMode,
    ): Promise<CommerceModeConflict[]> {
        if (targetMode === 'HYBRID') {
            return [];
        }
        const requiredType: FulfillmentType = targetMode === 'DIGITAL_ONLY' ? 'digital' : 'physical';
        const [products, openOrders, packagingRules] = await Promise.all([
            this.connection.getRepository(ctx, Product).find({
                where: { channels: { id: channelId } },
                relations: { channels: true },
            }),
            this.connection.getRepository(ctx, Order).find({
                where: {
                    channels: { id: channelId },
                    state: Not(In([...TERMINAL_ORDER_STATES])),
                },
                relations: { channels: true, lines: true },
            }),
            targetMode === 'DIGITAL_ONLY'
                ? this.connection.getRepository(ctx, ProductPackagingRule).find({
                      where: { channelId, enabled: true },
                  })
                : Promise.resolve([]),
        ]);
        const conflicts: CommerceModeConflict[] = [];
        for (const product of products) {
            const type = product.customFields?.fulfillmentType ?? 'digital';
            if (type !== requiredType) {
                conflicts.push({
                    code: 'INCOMPATIBLE_PRODUCT',
                    entityId: String(product.id),
                    message: `商品 ${product.id} 属于${type === 'digital' ? '虚拟' : '实物'}商品`,
                });
            }
        }
        for (const order of openOrders) {
            const incompatible = order.lines.some(
                line => (line.customFields?.fulfillmentTypeSnapshot ?? 'digital') !== requiredType,
            );
            if (incompatible) {
                conflicts.push({
                    code: 'OPEN_ORDER',
                    entityId: String(order.id),
                    message: `未完成订单 ${order.code} 包含不兼容商品`,
                });
            }
        }
        for (const rule of packagingRules) {
            conflicts.push({
                code: 'PACKAGING_CONFIGURATION',
                entityId: String(rule.id),
                message: `商品 ${rule.productId} 仍启用了整箱/拆箱配置`,
            });
        }
        return conflicts;
    }

    async updateActiveMode(
        ctx: RequestContext,
        targetMode: StoreCommerceMode,
    ): Promise<{ mode: StoreCommerceMode; conflicts: CommerceModeConflict[] }> {
        this.assertMode(targetMode);
        const channel = await this.connection.getEntityOrThrow(ctx, Channel, ctx.channelId);
        const currentMode = this.modeForChannel(channel);
        if (currentMode === targetMode) {
            return { mode: currentMode, conflicts: [] };
        }
        const conflicts = await this.conflicts(ctx, channel.id, targetMode);
        if (conflicts.length) {
            const details = conflicts
                .slice(0, 10)
                .map(item => item.message)
                .join('；');
            throw new UserInputError(`经营模式切换被阻止，共发现 ${conflicts.length} 个冲突：${details}`);
        }
        const updated = await this.channelService.update(ctx, {
            id: channel.id,
            customFields: {
                ...channel.customFields,
                commerceMode: targetMode,
            },
        });
        if (isGraphQlErrorResult(updated)) {
            throw new UserInputError(updated.message);
        }
        return { mode: this.modeForChannel(updated), conflicts: [] };
    }

    private assertMode(mode: string): asserts mode is StoreCommerceMode {
        if (!['DIGITAL_ONLY', 'PHYSICAL_ONLY', 'HYBRID'].includes(mode)) {
            throw new UserInputError('店铺经营模式无效');
        }
    }
}

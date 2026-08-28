import { Injectable, OnApplicationBootstrap } from '@nestjs/common';
import { StockMovementType } from '@vendure/common/lib/generated-types';
import { ID } from '@vendure/common/lib/shared-types';
import {
    Cancellation,
    EventBus,
    RequestContext,
    Sale,
    StockMovement,
    StockMovementEvent,
    TransactionalConnection,
    UserInputError,
} from '@vendure/core';
import { In } from 'typeorm';

import { InventoryLotMovement } from './entities/inventory-lot-movement.entity';
import { InventoryLot } from './entities/inventory-lot.entity';

interface LotCandidate {
    id: ID;
    createdAt: Date;
    manufacturedAt: Date | null;
    expiresAt: Date | null;
    quantityOnHand: number;
    state: string;
}

interface LotMovementHistory {
    lotId: ID;
    quantity: number;
}

export interface LotQuantityPlan {
    lotId: ID;
    quantity: number;
}

@Injectable()
export class InventoryLotLifecycleService implements OnApplicationBootstrap {
    constructor(
        private readonly eventBus: EventBus,
        private readonly connection: TransactionalConnection,
    ) {}

    onApplicationBootstrap(): void {
        this.eventBus.registerBlockingEventHandler({
            event: StockMovementEvent,
            id: 'catalog-inventory-lot-fefo',
            handler: event => this.handleStockMovement(event),
        });
    }

    private async handleStockMovement(event: StockMovementEvent): Promise<void> {
        if (![StockMovementType.SALE, StockMovementType.CANCELLATION].includes(event.type)) return;
        for (const movement of event.stockMovements) {
            if (movement.type === StockMovementType.SALE) {
                await this.allocateSale(event.ctx, movement as Sale);
            } else if (movement.type === StockMovementType.CANCELLATION) {
                await this.restoreCancellation(event.ctx, movement as Cancellation);
            }
        }
    }

    private async allocateSale(ctx: RequestContext, movement: Sale): Promise<void> {
        if (await this.wasHandled(ctx, movement.id)) return;
        const scope = movementScope(movement);
        const lots = await this.findLotsForUpdate(ctx, scope.variantId, scope.stockLocationId);
        // Existing stores can keep using legacy aggregate inventory until a first batch is created.
        if (lots.length === 0) return;

        const requested = Math.abs(movement.quantity);
        const allocations = planFefoAllocation(lots, requested, new Date());
        const allocated = allocations.reduce((sum, allocation) => sum + allocation.quantity, 0);
        if (allocated !== requested) {
            throw new UserInputError(
                `SKU ${String(scope.variantId)} 在当前仓库的可售批次库存不足，需要 ${requested}，可用 ${allocated}`,
            );
        }

        const byId = new Map(lots.map(lot => [String(lot.id), lot]));
        const auditRows: InventoryLotMovement[] = [];
        for (const allocation of allocations) {
            const lot = byId.get(String(allocation.lotId));
            if (!lot) throw new UserInputError('批次库存在扣减前已发生变化');
            lot.quantityOnHand -= allocation.quantity;
            lot.state = lot.quantityOnHand === 0 ? 'DEPLETED' : 'ACTIVE';
            auditRows.push(
                new InventoryLotMovement({
                    lotId: lot.id,
                    stockMovementId: movement.id,
                    orderLineId: scope.orderLineId,
                    variantId: scope.variantId,
                    stockLocationId: scope.stockLocationId,
                    type: 'SALE',
                    quantity: -allocation.quantity,
                    actorId: ctx.activeUserId ? String(ctx.activeUserId) : null,
                }),
            );
        }
        await this.connection.getRepository(ctx, InventoryLot).save([...byId.values()]);
        await this.connection.getRepository(ctx, InventoryLotMovement).save(auditRows);
    }

    private async restoreCancellation(ctx: RequestContext, movement: Cancellation): Promise<void> {
        if (await this.wasHandled(ctx, movement.id)) return;
        const scope = movementScope(movement);
        if (!scope.orderLineId) return;
        const auditRepository = this.connection.getRepository(ctx, InventoryLotMovement);
        const history = await auditRepository.find({
            where: {
                orderLineId: scope.orderLineId,
                variantId: scope.variantId,
                stockLocationId: scope.stockLocationId,
            },
            order: { createdAt: 'ASC', id: 'ASC' },
        });
        // A cancellation for a sale made before batch tracking has no allocation to reverse.
        if (history.length === 0) return;

        const requested = Math.abs(movement.quantity);
        const restorations = planLotRestoration(history, requested);
        const restored = restorations.reduce((sum, restoration) => sum + restoration.quantity, 0);
        if (restored !== requested) {
            throw new UserInputError('退货数量超过该订单可恢复的批次数量');
        }

        const lotRepository = this.connection.getRepository(ctx, InventoryLot);
        const lotIds = restorations.map(item => item.lotId);
        const lots = await lotRepository.find({ where: { id: In(lotIds) } });
        const byId = new Map(lots.map(lot => [String(lot.id), lot]));
        if (byId.size !== new Set(lotIds.map(String)).size) {
            throw new UserInputError('原销售批次已不完整，无法安全恢复库存');
        }

        const now = new Date();
        const auditRows: InventoryLotMovement[] = [];
        for (const restoration of restorations) {
            const lot = byId.get(String(restoration.lotId));
            if (!lot) continue;
            lot.quantityOnHand += restoration.quantity;
            if (lot.state !== 'VOID') {
                lot.state = isExpired(lot.expiresAt, now) ? 'EXPIRED' : 'ACTIVE';
            }
            auditRows.push(
                new InventoryLotMovement({
                    lotId: lot.id,
                    stockMovementId: movement.id,
                    orderLineId: scope.orderLineId,
                    variantId: scope.variantId,
                    stockLocationId: scope.stockLocationId,
                    type: 'CANCELLATION',
                    quantity: restoration.quantity,
                    actorId: ctx.activeUserId ? String(ctx.activeUserId) : null,
                }),
            );
        }
        await lotRepository.save([...byId.values()]);
        await auditRepository.save(auditRows);
    }

    private async wasHandled(ctx: RequestContext, stockMovementId: ID): Promise<boolean> {
        return this.connection.getRepository(ctx, InventoryLotMovement).exists({
            where: { stockMovementId },
        });
    }

    private async findLotsForUpdate(
        ctx: RequestContext,
        variantId: ID,
        stockLocationId: ID,
    ): Promise<InventoryLot[]> {
        const repository = this.connection.getRepository(ctx, InventoryLot);
        const query = repository
            .createQueryBuilder('lot')
            .where('lot.variantId = :variantId', { variantId })
            .andWhere('lot.stockLocationId = :stockLocationId', { stockLocationId });
        const databaseType = repository.manager.connection.options.type;
        if (
            repository.manager.queryRunner?.isTransactionActive &&
            !['sqlite', 'better-sqlite3', 'sqljs'].includes(databaseType)
        ) {
            query.setLock('pessimistic_write');
        }
        return query.getMany();
    }
}

export function planFefoAllocation(lots: LotCandidate[], requested: number, now: Date): LotQuantityPlan[] {
    let remaining = requested;
    const result: LotQuantityPlan[] = [];
    const eligible = lots
        .filter(lot => lot.quantityOnHand > 0 && lot.state === 'ACTIVE' && !isExpired(lot.expiresAt, now))
        .sort(compareFefoLots);
    for (const lot of eligible) {
        if (remaining === 0) break;
        const quantity = Math.min(lot.quantityOnHand, remaining);
        result.push({ lotId: lot.id, quantity });
        remaining -= quantity;
    }
    return result;
}

export function planLotRestoration(history: LotMovementHistory[], requested: number): LotQuantityPlan[] {
    const balances = new Map<string, { lotId: ID; net: number; lastSaleIndex: number }>();
    history.forEach((movement, index) => {
        const key = String(movement.lotId);
        const current = balances.get(key) ?? { lotId: movement.lotId, net: 0, lastSaleIndex: -1 };
        current.net += movement.quantity;
        if (movement.quantity < 0) current.lastSaleIndex = index;
        balances.set(key, current);
    });
    let remaining = requested;
    const result: LotQuantityPlan[] = [];
    const candidates = [...balances.values()]
        .filter(balance => balance.net < 0)
        .sort((a, b) => b.lastSaleIndex - a.lastSaleIndex);
    for (const candidate of candidates) {
        if (remaining === 0) break;
        const quantity = Math.min(-candidate.net, remaining);
        result.push({ lotId: candidate.lotId, quantity });
        remaining -= quantity;
    }
    return result;
}

function movementScope(movement: StockMovement): {
    variantId: ID;
    stockLocationId: ID;
    orderLineId: ID | null;
} {
    const orderLineId = (movement as Sale | Cancellation).orderLine?.id ?? null;
    const variantId = movement.productVariant?.id;
    const stockLocationId = movement.stockLocationId ?? movement.stockLocation?.id;
    if (variantId == null || stockLocationId == null) {
        throw new UserInputError('库存流水缺少 SKU 或仓库信息，无法分配批次');
    }
    return { variantId, stockLocationId, orderLineId };
}

function compareFefoLots(left: LotCandidate, right: LotCandidate): number {
    return (
        nullableTime(left.expiresAt) - nullableTime(right.expiresAt) ||
        nullableTime(left.manufacturedAt) - nullableTime(right.manufacturedAt) ||
        left.createdAt.getTime() - right.createdAt.getTime() ||
        String(left.id).localeCompare(String(right.id), undefined, { numeric: true })
    );
}

function nullableTime(value: Date | null): number {
    return value?.getTime() ?? Number.MAX_SAFE_INTEGER;
}

function isExpired(expiresAt: Date | null, now: Date): boolean {
    if (!expiresAt) return false;
    const todayUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
    return expiresAt.getTime() < todayUtc;
}

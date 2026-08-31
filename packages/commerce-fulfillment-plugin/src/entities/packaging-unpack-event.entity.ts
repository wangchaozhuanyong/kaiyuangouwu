import { DeepPartial, ID } from '@vendure/common/lib/shared-types';
import { Channel, EntityId, Order, StockLocation, VendureEntity } from '@vendure/core';
import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';

import { ProductPackagingRule } from './product-packaging-rule.entity';

export type PackagingUnpackReason = 'ORDER_AUTO';

@Entity({ name: 'packaging_unpack_event' })
@Index('IDX_packaging_unpack_event_rule_created', ['ruleId', 'createdAt'])
@Index('IDX_packaging_unpack_event_order', ['orderId'])
export class PackagingUnpackEvent extends VendureEntity {
    constructor(input?: DeepPartial<PackagingUnpackEvent>) {
        super(input);
    }

    @Column({ type: 'varchar', length: 24 })
    reason: PackagingUnpackReason;

    @Column({ type: 'int' })
    packagesOpened: number;

    @Column({ type: 'int' })
    unitsCreated: number;

    @Column({ type: 'int' })
    packageStockBefore: number;

    @Column({ type: 'int' })
    packageStockAfter: number;

    @Column({ type: 'int' })
    unitStockBefore: number;

    @Column({ type: 'int' })
    unitStockAfter: number;

    @ManyToOne(() => ProductPackagingRule, rule => rule.unpackEvents, {
        onDelete: 'CASCADE',
        nullable: false,
    })
    @JoinColumn({ name: 'ruleId', foreignKeyConstraintName: 'FK_packaging_unpack_event_rule' })
    rule: ProductPackagingRule;

    @EntityId()
    ruleId: ID;

    @ManyToOne(() => Channel, { onDelete: 'CASCADE', nullable: false })
    @JoinColumn({ name: 'channelId', foreignKeyConstraintName: 'FK_packaging_unpack_event_channel' })
    channel: Channel;

    @EntityId()
    channelId: ID;

    @ManyToOne(() => StockLocation, { onDelete: 'CASCADE', nullable: false })
    @JoinColumn({
        name: 'stockLocationId',
        foreignKeyConstraintName: 'FK_packaging_unpack_event_stock_location',
    })
    stockLocation: StockLocation;

    @EntityId()
    stockLocationId: ID;

    @ManyToOne(() => Order, { onDelete: 'SET NULL', nullable: true })
    @JoinColumn({ name: 'orderId', foreignKeyConstraintName: 'FK_packaging_unpack_event_order' })
    order: Order | null;

    @EntityId({ nullable: true })
    orderId: ID | null;
}

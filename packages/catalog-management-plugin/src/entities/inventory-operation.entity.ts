import { DeepPartial, ID } from '@vendure/common/lib/shared-types';
import { Channel, EntityId, VendureEntity } from '@vendure/core';
import { Column, Entity, Index, JoinColumn, ManyToOne, OneToMany } from 'typeorm';

import { InventoryOperationLine } from './inventory-operation-line.entity';

export type InventoryOperationType =
    'MANUAL_LOT_COUNT' | 'LEGACY_STOCK_ADJUSTMENT' | 'LOT_TRANSFER' | 'RECONCILIATION';

@Entity({ name: 'catalog_inventory_operation' })
@Index('IDX_catalog_inventory_operation_channel_key', ['channelId', 'idempotencyKey'], { unique: true })
@Index('IDX_catalog_inventory_operation_channel_created', ['channelId', 'createdAt'])
export class InventoryOperation extends VendureEntity {
    constructor(input?: DeepPartial<InventoryOperation>) {
        super(input);
    }

    @ManyToOne(() => Channel, { nullable: false, onDelete: 'CASCADE' })
    @JoinColumn({ name: 'channelId', foreignKeyConstraintName: 'FK_catalog_inventory_operation_channel' })
    channel: Channel;

    @EntityId()
    channelId: ID;

    @Column({ type: 'varchar', length: 64 })
    code: string;

    @Column({ type: 'varchar', length: 80 })
    idempotencyKey: string;

    @Column({ type: 'varchar', length: 32 })
    type: InventoryOperationType;

    @Column({ type: 'varchar', length: 16, default: 'POSTED' })
    status: 'POSTED';

    @Column({ type: 'varchar', length: 128, nullable: true })
    actorUserId: string | null;

    @Column({ type: 'varchar', length: 500 })
    reason: string;

    @Column({ type: 'varchar', length: 160, nullable: true })
    reference: string | null;

    @Column({ type: Date })
    postedAt: Date;

    @OneToMany(() => InventoryOperationLine, line => line.operation)
    lines: InventoryOperationLine[];
}

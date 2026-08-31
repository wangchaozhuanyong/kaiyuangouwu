import { DeepPartial, ID } from '@vendure/common/lib/shared-types';
import { EntityId, VendureEntity } from '@vendure/core';
import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';

import { AutoCardPoolItemState } from '../auto-card.constants';

import { AutoCardConfig } from './auto-card-config.entity';
import { AutoCardDelivery } from './auto-card-delivery.entity';

@Entity({ name: 'auto_card_pool_item' })
@Index('IDX_auto_card_pool_config_state_sequence', ['configId', 'state', 'sequence'])
@Index('IDX_auto_card_pool_config_fingerprint', ['configId', 'fingerprint'], { unique: true })
@Index('IDX_auto_card_pool_config_sequence', ['configId', 'sequence'], { unique: true })
export class AutoCardPoolItem extends VendureEntity {
    constructor(input?: DeepPartial<AutoCardPoolItem>) {
        super(input);
    }

    @Column({ type: 'varchar', length: 16, default: 'AVAILABLE' })
    state: AutoCardPoolItemState;

    @Column({ type: 'int' })
    sequence: number;

    @Column({ type: 'text' })
    encryptedPayload: string;

    @Column({ type: 'text', nullable: true })
    encryptedRawPayload: string | null;

    @Column({ type: 'varchar', length: 64 })
    fingerprint: string;

    @Column({ type: Date, nullable: true })
    assignedAt: Date | null;

    @Column({ type: 'text', nullable: true })
    disabledReason: string | null;

    @ManyToOne(() => AutoCardConfig, config => config.poolItems, { onDelete: 'CASCADE', nullable: false })
    @JoinColumn({ name: 'configId', foreignKeyConstraintName: 'FK_auto_card_pool_config' })
    config: AutoCardConfig;

    @EntityId()
    configId: ID;

    @ManyToOne(() => AutoCardDelivery, delivery => delivery.poolItems, {
        onDelete: 'SET NULL',
        nullable: true,
    })
    @JoinColumn({ name: 'deliveryId', foreignKeyConstraintName: 'FK_auto_card_pool_delivery' })
    delivery: AutoCardDelivery | null;

    @EntityId({ nullable: true })
    deliveryId: ID | null;
}

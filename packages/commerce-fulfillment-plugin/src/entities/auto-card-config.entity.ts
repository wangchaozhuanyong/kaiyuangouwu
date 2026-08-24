import { DeepPartial, ID } from '@vendure/common/lib/shared-types';
import { Channel, EntityId, ProductVariant, VendureEntity } from '@vendure/core';
import { Column, Entity, Index, JoinColumn, ManyToOne, OneToMany } from 'typeorm';

import { AutoCardDelivery } from './auto-card-delivery.entity';
import { AutoCardPoolItem } from './auto-card-pool-item.entity';

@Entity({ name: 'auto_card_config' })
@Index('IDX_auto_card_config_channel_variant', ['channelId', 'productVariantId'], { unique: true })
export class AutoCardConfig extends VendureEntity {
    constructor(input?: DeepPartial<AutoCardConfig>) {
        super(input);
    }

    @Column({ type: 'boolean', default: true })
    enabled: boolean;

    @Column({ type: 'varchar', length: 80 })
    formatName: string;

    @Column({ type: 'varchar', length: 16, default: '----' })
    delimiter: string;

    @Column({ type: 'text' })
    fieldsJson: string;

    @Column({ type: 'text' })
    instructions: string;

    @Column({ type: 'text', nullable: true })
    instructionsZh: string | null;

    @Column({ type: 'text', nullable: true })
    instructionsEn: string | null;

    @Column({ type: 'int', default: 5 })
    lowStockThreshold: number;

    @ManyToOne(() => Channel, { onDelete: 'CASCADE', nullable: false })
    @JoinColumn({ name: 'channelId', foreignKeyConstraintName: 'FK_auto_card_config_channel' })
    channel: Channel;

    @EntityId()
    channelId: ID;

    @ManyToOne(() => ProductVariant, { onDelete: 'CASCADE', nullable: false })
    @JoinColumn({ name: 'productVariantId', foreignKeyConstraintName: 'FK_auto_card_config_variant' })
    productVariant: ProductVariant;

    @EntityId()
    productVariantId: ID;

    @OneToMany(() => AutoCardPoolItem, item => item.config)
    poolItems: AutoCardPoolItem[];

    @OneToMany(() => AutoCardDelivery, delivery => delivery.config)
    deliveries: AutoCardDelivery[];
}

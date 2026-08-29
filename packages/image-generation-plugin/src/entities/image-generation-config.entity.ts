import { DeepPartial, ID } from '@vendure/common/lib/shared-types';
import { Channel, EntityId, VendureEntity } from '@vendure/core';
import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';

@Entity({ name: 'image_generation_config' })
@Index('IDX_image_generation_config_channel', ['channelId'], { unique: true })
export class ImageGenerationConfig extends VendureEntity {
    constructor(input?: DeepPartial<ImageGenerationConfig>) {
        super(input);
    }

    @ManyToOne(() => Channel, { nullable: false, onDelete: 'CASCADE' })
    @JoinColumn({ name: 'channelId', foreignKeyConstraintName: 'FK_image_generation_config_channel' })
    channel: Channel;

    @EntityId()
    channelId: ID;

    @Column('boolean', { default: false })
    enabled: boolean;

    @Column('boolean', { default: true })
    promptOptimizationEnabled: boolean;

    @Column({ type: 'varchar', length: 48, default: 'OPENAI_HIGH_QUALITY' })
    defaultModelCode: string;

    @Column({ type: 'varchar', length: 32, default: '2026-08-27' })
    termsVersion: string;

    @Column({ type: 'text', default: '' })
    termsZh: string;

    @Column({ type: 'text', default: '' })
    termsEn: string;
}

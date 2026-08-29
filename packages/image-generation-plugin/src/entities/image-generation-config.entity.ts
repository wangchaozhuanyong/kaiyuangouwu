import { CurrencyCode } from '@vendure/common/lib/generated-types';
import { DeepPartial, ID } from '@vendure/common/lib/shared-types';
import { Channel, EntityId, Money, VendureEntity } from '@vendure/core';
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

    @Column('int', { default: 3 })
    promptRateLimitPerMinute: number;

    @Column('int', { default: 20 })
    promptDailyFreeLimit: number;

    @Column('boolean', { default: false })
    promptDailyFreeUnlimited: boolean;

    @Column('boolean', { default: false })
    paidPromptOptimizationEnabled: boolean;

    @Money({ default: 0 })
    paidPromptOptimizationPrice: number;

    @Column({ type: 'varchar', length: 3, default: CurrencyCode.CNY })
    paidPromptOptimizationCurrencyCode: CurrencyCode;

    @Column({ type: 'varchar', length: 48, default: 'OPENAI_HIGH_QUALITY' })
    defaultModelCode: string;

    @Column({ type: 'varchar', length: 32, default: '2026-08-28-audit' })
    termsVersion: string;

    // MySQL rejects literal defaults on TEXT columns, so callers must always provide both values.
    @Column({ type: 'text' })
    termsZh: string;

    @Column({ type: 'text' })
    termsEn: string;
}

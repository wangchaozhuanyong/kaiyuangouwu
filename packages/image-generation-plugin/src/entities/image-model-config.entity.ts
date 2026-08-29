import { CurrencyCode } from '@vendure/common/lib/generated-types';
import { DeepPartial, ID } from '@vendure/common/lib/shared-types';
import { Channel, EntityId, Money, VendureEntity } from '@vendure/core';
import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import type { ImageProviderProtocol } from '../types';

import { resolutionOptionsForModel } from '../image-resolution';

@Entity({ name: 'image_model_config' })
@Index('IDX_image_model_config_channel_code', ['channelId', 'code'], { unique: true })
@Index('IDX_image_model_config_channel_position', ['channelId', 'position'])
export class ImageModelConfig extends VendureEntity {
    constructor(input?: DeepPartial<ImageModelConfig>) {
        super(input);
    }

    @ManyToOne(() => Channel, { nullable: false, onDelete: 'CASCADE' })
    @JoinColumn({ name: 'channelId', foreignKeyConstraintName: 'FK_image_model_config_channel' })
    channel: Channel;

    @EntityId()
    channelId: ID;

    @Column({ type: 'varchar', length: 48 })
    code: string;

    @Column('boolean', { default: false })
    enabled: boolean;

    @Column({ type: 'varchar', length: 120 })
    displayNameZh: string;

    @Column({ type: 'varchar', length: 120 })
    displayNameEn: string;

    @Column({ type: 'varchar', length: 500 })
    descriptionZh: string;

    @Column({ type: 'varchar', length: 500 })
    descriptionEn: string;

    @Column({ type: 'varchar', length: 160 })
    officialModelId: string;

    @Column({ type: 'varchar', length: 160 })
    providerModelId: string;

    @Column({ type: 'varchar', length: 32 })
    protocol: ImageProviderProtocol;

    @Money({ default: 0 })
    unitPrice: number;

    @Money({ default: 0 })
    unitPrice2K: number;

    @Money({ default: 0 })
    unitPrice4K: number;

    @Column({ type: 'varchar', length: 3 })
    currencyCode: CurrencyCode;

    @Column('int', { default: 0 })
    position: number;

    @Column('boolean', { default: false })
    isDefault: boolean;

    @Column('boolean', { default: false })
    supportsIdempotency: boolean;

    @Column('boolean', { default: false })
    freeImageEnabled: boolean;

    @Column('int', { default: 0 })
    dailyFreeImageLimit: number;

    @Column('boolean', { default: false })
    dailyFreeImageUnlimited: boolean;

    @Column('boolean', { default: true })
    paidAfterFreeEnabled: boolean;

    @Column('int', { default: 20 })
    dailyGenerationSafetyLimit: number;

    @Column({ type: 'varchar', length: 24, default: 'UNTESTED' })
    healthStatus: string;

    @Column({ type: 'varchar', length: 500, nullable: true })
    healthMessage: string | null;

    @Column({ type: Date, nullable: true })
    lastTestedAt: Date | null;

    @Column('int', { default: 0 })
    consecutiveFailures: number;

    get resolutionOptions() {
        return resolutionOptionsForModel(this);
    }
}

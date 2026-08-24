import { DeepPartial, ID } from '@vendure/common/lib/shared-types';
import {
    Asset,
    Channel,
    EntityId,
    LocaleString,
    Translatable,
    Translation,
    VendureEntity,
} from '@vendure/core';
import { Column, Entity, Index, JoinColumn, ManyToOne, OneToMany } from 'typeorm';

import {
    StorefrontContentBlockType,
    StorefrontContentLayoutVariant,
    StorefrontContentTargetType,
} from '../constants';
import { StorefrontContentSettingsValue } from '../types';
import { StorefrontContentBlockTranslation } from './storefront-content-block-translation.entity';
import { StorefrontContentItem } from './storefront-content-item.entity';

@Entity({ name: 'storefront_content_block' })
@Index('IDX_storefront_content_block_channel_code', ['channelId', 'code'], { unique: true })
@Index('IDX_storefront_content_block_channel_position', ['channelId', 'position'])
export class StorefrontContentBlock extends VendureEntity implements Translatable {
    constructor(input?: DeepPartial<StorefrontContentBlock>) {
        super(input);
    }

    @Column({ type: 'varchar', length: 64 })
    code: string;

    @Column({ type: 'varchar', length: 128, default: '' })
    internalName: string;

    @Column({ type: 'varchar', length: 32 })
    type: StorefrontContentBlockType;

    @Column({ type: 'varchar', length: 32, default: 'AUTO' })
    layoutVariant: StorefrontContentLayoutVariant;

    @Column('boolean', { default: true })
    enabled: boolean;

    @Column({ type: 'int', default: 0 })
    position: number;

    @Column({ type: Date, nullable: true })
    startsAt: Date | null;

    @Column({ type: Date, nullable: true })
    endsAt: Date | null;

    @Column({ type: 'varchar', length: 2048, nullable: true })
    imageUrl: string | null;

    @Index('IDX_storefront_content_block_image_asset')
    @ManyToOne(() => Asset, { onDelete: 'SET NULL', nullable: true })
    @JoinColumn({
        name: 'imageAssetId',
        foreignKeyConstraintName: 'FK_storefront_content_block_image_asset',
    })
    imageAsset: Asset | null;

    @EntityId({ nullable: true })
    imageAssetId: ID | null;

    @Column({ type: 'varchar', length: 32, nullable: true })
    backgroundColor: string | null;

    @Column({ type: 'varchar', length: 32, nullable: true })
    textColor: string | null;

    @Column({ type: 'varchar', length: 32, default: 'NONE' })
    targetType: StorefrontContentTargetType;

    @Column({ type: 'varchar', length: 2048, nullable: true })
    targetValue: string | null;

    @Column({ type: 'simple-json', nullable: true })
    settings: StorefrontContentSettingsValue | null;

    title: LocaleString;

    subtitle: LocaleString;

    body: LocaleString;

    ctaLabel: LocaleString;

    @OneToMany(() => StorefrontContentBlockTranslation, translation => translation.base, { eager: true })
    translations: Array<Translation<StorefrontContentBlock>>;

    @OneToMany(() => StorefrontContentItem, item => item.block)
    items: StorefrontContentItem[];

    @Index('IDX_storefront_content_block_channel')
    @ManyToOne(() => Channel, { onDelete: 'CASCADE', nullable: false })
    @JoinColumn({ name: 'channelId', foreignKeyConstraintName: 'FK_storefront_content_block_channel' })
    channel: Channel;

    @EntityId()
    channelId: ID;
}

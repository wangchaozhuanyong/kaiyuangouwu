import { DeepPartial, ID } from '@vendure/common/lib/shared-types';
import { Asset, EntityId, LocaleString, Translatable, Translation, VendureEntity } from '@vendure/core';
import { Column, Entity, Index, JoinColumn, ManyToOne, OneToMany } from 'typeorm';

import { StorefrontContentTargetType } from '../constants';
import { StorefrontContentSettingsValue } from '../types';
import { StorefrontContentBlock } from './storefront-content-block.entity';
import { StorefrontContentItemTranslation } from './storefront-content-item-translation.entity';

@Entity({ name: 'storefront_content_item' })
@Index('IDX_storefront_content_item_block_position', ['blockId', 'position'])
export class StorefrontContentItem extends VendureEntity implements Translatable {
    constructor(input?: DeepPartial<StorefrontContentItem>) {
        super(input);
    }

    @Column('boolean', { default: true })
    enabled: boolean;

    @Column({ type: 'int', default: 0 })
    position: number;

    @Column({ type: 'varchar', length: 2048, nullable: true })
    imageUrl: string | null;

    @Index('IDX_storefront_content_item_image_asset')
    @ManyToOne(() => Asset, { onDelete: 'SET NULL', nullable: true })
    @JoinColumn({
        name: 'imageAssetId',
        foreignKeyConstraintName: 'FK_storefront_content_item_image_asset',
    })
    imageAsset: Asset | null;

    @EntityId({ nullable: true })
    imageAssetId: ID | null;

    @Column({ type: 'varchar', length: 32, default: 'NONE' })
    targetType: StorefrontContentTargetType;

    @Column({ type: 'varchar', length: 2048, nullable: true })
    targetValue: string | null;

    @Column({ type: 'simple-json', nullable: true })
    settings: StorefrontContentSettingsValue | null;

    label: LocaleString;

    description: LocaleString;

    @OneToMany(() => StorefrontContentItemTranslation, translation => translation.base, { eager: true })
    translations: Array<Translation<StorefrontContentItem>>;

    @ManyToOne(() => StorefrontContentBlock, block => block.items, {
        onDelete: 'CASCADE',
        nullable: false,
    })
    @JoinColumn({ name: 'blockId', foreignKeyConstraintName: 'FK_storefront_content_item_block' })
    block: StorefrontContentBlock;

    @EntityId()
    blockId: ID;
}

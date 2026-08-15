import { LanguageCode } from '@vendure/common/lib/generated-types';
import { DeepPartial } from '@vendure/common/lib/shared-types';
import { Translation, VendureEntity } from '@vendure/core';
import { Column, Entity, Index, ManyToOne } from 'typeorm';

import { StorefrontContentItem } from './storefront-content-item.entity';

@Entity({ name: 'storefront_content_item_translation' })
@Index('IDX_storefront_content_item_translation_language', ['base', 'languageCode'], { unique: true })
export class StorefrontContentItemTranslation
    extends VendureEntity
    implements Translation<StorefrontContentItem>
{
    constructor(input?: DeepPartial<Translation<StorefrontContentItem>>) {
        super(input);
    }

    @Column({ type: 'varchar', length: 16 })
    languageCode: LanguageCode;

    @Column({ type: 'varchar', length: 255, default: '' })
    label: string;

    @Column({ type: 'text' })
    description: string;

    @ManyToOne(() => StorefrontContentItem, base => base.translations, {
        onDelete: 'CASCADE',
        nullable: false,
    })
    base: StorefrontContentItem;
}

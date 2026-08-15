import { LanguageCode } from '@vendure/common/lib/generated-types';
import { DeepPartial } from '@vendure/common/lib/shared-types';
import { Translation, VendureEntity } from '@vendure/core';
import { Column, Entity, Index, ManyToOne } from 'typeorm';

import { StorefrontContentBlock } from './storefront-content-block.entity';

@Entity({ name: 'storefront_content_block_translation' })
@Index('IDX_storefront_content_block_translation_language', ['base', 'languageCode'], { unique: true })
export class StorefrontContentBlockTranslation
    extends VendureEntity
    implements Translation<StorefrontContentBlock>
{
    constructor(input?: DeepPartial<Translation<StorefrontContentBlock>>) {
        super(input);
    }

    @Column({ type: 'varchar', length: 16 })
    languageCode: LanguageCode;

    @Column({ type: 'varchar', length: 255, default: '' })
    title: string;

    @Column({ type: 'varchar', length: 500, default: '' })
    subtitle: string;

    @Column({ type: 'text' })
    body: string;

    @Column({ type: 'varchar', length: 120, default: '' })
    ctaLabel: string;

    @ManyToOne(() => StorefrontContentBlock, base => base.translations, {
        onDelete: 'CASCADE',
        nullable: false,
    })
    base: StorefrontContentBlock;
}

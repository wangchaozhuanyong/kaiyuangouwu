import 'reflect-metadata';

import { getMetadataArgsStorage } from 'typeorm';
import { describe, expect, it } from 'vitest';

import { StorefrontContentBlockTranslation } from './storefront-content-block-translation.entity';
import { StorefrontContentBlock } from './storefront-content-block.entity';
import { StorefrontContentItemTranslation } from './storefront-content-item-translation.entity';
import { StorefrontContentItem } from './storefront-content-item.entity';

describe('storefront content entity metadata', () => {
    it('registers all four plugin entities', () => {
        const targets = getMetadataArgsStorage().tables.map(table => table.target);

        expect(targets).toEqual(
            expect.arrayContaining([
                StorefrontContentBlock,
                StorefrontContentBlockTranslation,
                StorefrontContentItem,
                StorefrontContentItemTranslation,
            ]),
        );
    });

    it('keeps block codes unique inside each Channel', () => {
        const index = getMetadataArgsStorage().indices.find(
            item =>
                item.target === StorefrontContentBlock &&
                item.name === 'IDX_storefront_content_block_channel_code',
        );

        expect(index).toMatchObject({
            columns: ['channelId', 'code'],
            unique: true,
        });
    });

    it('cascades block, item, and translation cleanup', () => {
        const relations = getMetadataArgsStorage().relations;
        const channelRelation = relations.find(
            item => item.target === StorefrontContentBlock && item.propertyName === 'channel',
        );
        const itemRelation = relations.find(
            item => item.target === StorefrontContentItem && item.propertyName === 'block',
        );
        const blockTranslationRelation = relations.find(
            item => item.target === StorefrontContentBlockTranslation && item.propertyName === 'base',
        );
        const itemTranslationRelation = relations.find(
            item => item.target === StorefrontContentItemTranslation && item.propertyName === 'base',
        );

        for (const relation of [
            channelRelation,
            itemRelation,
            blockTranslationRelation,
            itemTranslationRelation,
        ]) {
            expect(relation?.options).toMatchObject({ nullable: false, onDelete: 'CASCADE' });
        }
    });
});

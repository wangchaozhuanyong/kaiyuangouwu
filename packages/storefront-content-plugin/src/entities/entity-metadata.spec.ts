import 'reflect-metadata';

import { getMetadataArgsStorage } from 'typeorm';
import { describe, expect, it } from 'vitest';

import { StorefrontContentBlockTranslation } from './storefront-content-block-translation.entity';
import { StorefrontContentBlock } from './storefront-content-block.entity';
import { StorefrontContentItemTranslation } from './storefront-content-item-translation.entity';
import { StorefrontContentItem } from './storefront-content-item.entity';
import { StorefrontContentSettings } from './storefront-content-settings.entity';

describe('storefront content entity metadata', () => {
    it('registers all five plugin entities', () => {
        const targets = getMetadataArgsStorage().tables.map(table => table.target);

        expect(targets).toEqual(
            expect.arrayContaining([
                StorefrontContentBlock,
                StorefrontContentBlockTranslation,
                StorefrontContentItem,
                StorefrontContentItemTranslation,
                StorefrontContentSettings,
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

    it('keeps one settings record per Channel', () => {
        const index = getMetadataArgsStorage().indices.find(
            item =>
                item.target === StorefrontContentSettings &&
                item.name === 'IDX_storefront_content_settings_channel',
        );

        expect(index).toMatchObject({
            columns: ['channelId'],
            unique: true,
        });
    });

    it('does not define unsupported defaults for text columns', () => {
        const columns = getMetadataArgsStorage().columns;
        const body = columns.find(
            item => item.target === StorefrontContentBlockTranslation && item.propertyName === 'body',
        );
        const description = columns.find(
            item => item.target === StorefrontContentItemTranslation && item.propertyName === 'description',
        );

        expect(body?.options).toMatchObject({ type: 'text' });
        expect(body?.options.default).toBeUndefined();
        expect(description?.options).toMatchObject({ type: 'text' });
        expect(description?.options.default).toBeUndefined();
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
        const settingsChannelRelation = relations.find(
            item => item.target === StorefrontContentSettings && item.propertyName === 'channel',
        );

        for (const relation of [
            channelRelation,
            itemRelation,
            blockTranslationRelation,
            itemTranslationRelation,
            settingsChannelRelation,
        ]) {
            expect(relation?.options).toMatchObject({ nullable: false, onDelete: 'CASCADE' });
        }
    });

    it('uses stable foreign key names that match production migrations', () => {
        const joinColumns = getMetadataArgsStorage().joinColumns;
        const expected = [
            [StorefrontContentBlock, 'channel', 'FK_storefront_content_block_channel'],
            [StorefrontContentBlockTranslation, 'base', 'FK_storefront_content_block_translation_base'],
            [StorefrontContentItem, 'block', 'FK_storefront_content_item_block'],
            [StorefrontContentItemTranslation, 'base', 'FK_storefront_content_item_translation_base'],
            [StorefrontContentSettings, 'channel', 'FK_storefront_content_settings_channel'],
        ] as const;

        for (const [target, propertyName, foreignKeyConstraintName] of expected) {
            expect(
                joinColumns.find(item => item.target === target && item.propertyName === propertyName),
            ).toMatchObject({ foreignKeyConstraintName });
        }
    });
});

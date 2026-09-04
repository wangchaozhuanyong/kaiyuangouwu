import { Injectable } from '@nestjs/common';
import { normalizeString } from '@vendure/common/lib/normalize-string';
import { ID } from '@vendure/common/lib/shared-types';
import { Collection, CollectionService, RequestContext, TransactionalConnection } from '@vendure/core';

import { normalizeIdentity } from './catalog-file-parser.service';
import { manualProductFilter, parseIdList, shortCode } from './catalog-import-helpers';

@Injectable()
export class CatalogImportCategoryService {
    constructor(
        private readonly connection: TransactionalConnection,
        private readonly collectionService: CollectionService,
    ) {}

    async moveImportedCategory(
        ctx: RequestContext,
        productId: ID,
        previousCategory: string,
        nextCategory: string,
    ): Promise<void> {
        if (previousCategory && normalizeIdentity(previousCategory) !== normalizeIdentity(nextCategory)) {
            await this.removeCategory(ctx, productId, previousCategory);
        }
        if (nextCategory) await this.assignCategory(ctx, productId, nextCategory);
    }

    private async categoryCollections(ctx: RequestContext): Promise<Collection[]> {
        return this.connection
            .getRepository(ctx, Collection)
            .createQueryBuilder('collection')
            .leftJoinAndSelect('collection.translations', 'translation')
            .innerJoin('collection.channels', 'channel', 'channel.id = :channelId', {
                channelId: ctx.channelId,
            })
            .where('collection.isRoot = :isRoot', { isRoot: false })
            .getMany();
    }

    private async removeCategory(ctx: RequestContext, productId: ID, category: string): Promise<void> {
        const collection = (await this.categoryCollections(ctx)).find(item =>
            item.translations.some(
                translation => normalizeIdentity(translation.name) === normalizeIdentity(category),
            ),
        );
        if (!collection) return;
        const filters = collection.filters.map(filter => ({
            code: filter.code,
            arguments: filter.args.map(filterArgument => ({
                name: filterArgument.name,
                value: filterArgument.value,
            })),
        }));
        const manual = filters.find(filter => filter.code === 'product-id-filter');
        const argument = manual?.arguments.find(item => item.name === 'productIds');
        if (!argument) return;
        const productIds = parseIdList(argument.value);
        if (!productIds.includes(String(productId))) return;
        argument.value = JSON.stringify(productIds.filter(id => id !== String(productId)));
        await this.collectionService.update(ctx, { id: collection.id, filters });
    }

    private async assignCategory(ctx: RequestContext, productId: ID, category: string): Promise<void> {
        const collections = await this.categoryCollections(ctx);
        let collection = collections.find(item =>
            item.translations.some(
                translation => normalizeIdentity(translation.name) === normalizeIdentity(category),
            ),
        );
        if (!collection) {
            collection = await this.collectionService.create(ctx, {
                inheritFilters: true,
                filters: [manualProductFilter([String(productId)])],
                translations: [
                    {
                        languageCode: ctx.languageCode,
                        name: category,
                        slug: await this.uniqueCollectionSlug(ctx, category),
                        description: '',
                    },
                ],
            });
            return;
        }
        const filters = collection.filters.map(filter => ({
            code: filter.code,
            arguments: filter.args.map(argument => ({ name: argument.name, value: argument.value })),
        }));
        const manual = filters.find(filter => filter.code === 'product-id-filter');
        if (manual) {
            const argument = manual.arguments.find(item => item.name === 'productIds');
            const ids = parseIdList(argument?.value);
            if (ids.includes(String(productId))) return;
            if (argument) argument.value = JSON.stringify([...ids, String(productId)]);
        } else {
            filters.push(manualProductFilter([String(productId)], filters.length > 0));
        }
        await this.collectionService.update(ctx, { id: collection.id, filters });
    }

    private async uniqueCollectionSlug(ctx: RequestContext, name: string): Promise<string> {
        const base = normalizeString(name, '-').slice(0, 100) || `category-${shortCode(name)}`;
        for (let index = 0; index < 100; index++) {
            const slug = index === 0 ? base : `${base}-${index + 1}`;
            if (!(await this.collectionService.findOneBySlug(ctx, slug))) return slug;
        }
        return `${base}-${Date.now()}`;
    }
}

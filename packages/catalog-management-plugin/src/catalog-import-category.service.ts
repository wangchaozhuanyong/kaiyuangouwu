import { Injectable } from '@nestjs/common';
import { normalizeString } from '@vendure/common/lib/normalize-string';
import { ID } from '@vendure/common/lib/shared-types';
import {
    Collection,
    CollectionService,
    FacetValue,
    RequestContext,
    TransactionalConnection,
    UserInputError,
} from '@vendure/core';

import { normalizeIdentity } from './catalog-file-parser.service';
import { splitCatalogCategoryPath } from './catalog-import-classification';
import { parseIdList, shortCode } from './catalog-import-helpers';

@Injectable()
export class CatalogImportCategoryService {
    private activeImports = 0;
    constructor(
        private readonly connection: TransactionalConnection,
        private readonly collectionService: CollectionService,
    ) {}

    async withDeferredFilters<T>(ctx: RequestContext, work: () => Promise<T>): Promise<T> {
        if (this.activeImports++ === 0) this.collectionService.setApplyAllFiltersOnProductUpdates(false);
        try {
            return await work();
        } finally {
            if (--this.activeImports === 0) {
                this.collectionService.setApplyAllFiltersOnProductUpdates(true);
                // Includes successful rows from a partially failed import and concurrent admin edits.
                await this.collectionService.triggerApplyFiltersJob(ctx, {
                    applyToChangedVariantsOnly: false,
                });
            }
        }
    }

    async moveImportedCategory(
        ctx: RequestContext,
        productId: ID,
        previousCategory: string,
        nextCategory: string,
    ): Promise<void> {
        if (previousCategory && normalizeIdentity(previousCategory) !== normalizeIdentity(nextCategory)) {
            await this.removeCategory(ctx, productId, previousCategory);
        }
        if (nextCategory) await this.assignCategory(ctx, nextCategory);
    }

    private async categoryCollections(ctx: RequestContext): Promise<Collection[]> {
        return this.connection
            .getRepository(ctx, Collection)
            .createQueryBuilder('collection')
            .leftJoinAndSelect('collection.translations', 'translation')
            .leftJoinAndSelect('collection.parent', 'parent')
            .innerJoin('collection.channels', 'channel', 'channel.id = :channelId', {
                channelId: ctx.channelId,
            })
            .where('collection.isRoot = :isRoot', { isRoot: false })
            .getMany();
    }

    private async removeCategory(ctx: RequestContext, productId: ID, category: string): Promise<void> {
        const collections = await this.categoryCollections(ctx);
        const { category: primary, secondaryCategory } = splitCatalogCategoryPath(category);
        const parent = this.findCategory(collections, primary);
        const collection =
            secondaryCategory && parent
                ? this.findCategory(collections, secondaryCategory, parent.id)
                : parent;
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

    private findCategory(collections: Collection[], name: string, parentId?: ID): Collection | undefined {
        const matches = collections.filter(
            item =>
                (parentId
                    ? String(item.parentId) === String(parentId)
                    : !item.parentId || item.parent?.isRoot) &&
                item.translations.some(
                    translation => normalizeIdentity(translation.name) === normalizeIdentity(name),
                ),
        );
        if (matches.length > 1) throw new UserInputError(`分类“${name}”在同一层级重复，请先整理分类`);
        return matches[0];
    }

    private async assignCategory(ctx: RequestContext, path: string): Promise<void> {
        const collections = await this.categoryCollections(ctx);
        const { category, secondaryCategory } = splitCatalogCategoryPath(path);
        const primaryFacetId = await this.categoryFacetId(ctx, 'catalog-import-primary-category', category);
        // Historical rollback rows may predate the primary marker. The path marker still identifies root-only products.
        const rootFacetId =
            primaryFacetId ?? (await this.categoryFacetId(ctx, 'catalog-import-category', category));
        if (!rootFacetId) throw new UserInputError(`缺少一级分类“${category}”的归类标记`);
        const parent = await this.ensureCategory(ctx, collections, category, rootFacetId);
        if (!secondaryCategory) return;
        const facetId = await this.categoryFacetId(ctx, 'catalog-import-category', path);
        if (!facetId) throw new UserInputError(`缺少二级分类“${secondaryCategory}”的归类标记`);
        await this.ensureCategory(ctx, collections, secondaryCategory, facetId, parent.id);
    }

    private async categoryFacetId(
        ctx: RequestContext,
        facetCode: string,
        name: string,
    ): Promise<ID | undefined> {
        const values = await this.connection.getRepository(ctx, FacetValue).find({
            where: { facet: { code: facetCode }, channels: { id: ctx.channelId } },
            relations: ['translations'],
        });
        return values.find(value =>
            value.translations.some(
                translation => normalizeIdentity(translation.name) === normalizeIdentity(name),
            ),
        )?.id;
    }

    private async ensureCategory(
        ctx: RequestContext,
        collections: Collection[],
        name: string,
        facetId: ID,
        parentId?: ID,
    ): Promise<Collection> {
        const collection = this.findCategory(collections, name, parentId);
        const filter = {
            code: 'facet-value-filter',
            arguments: [
                { name: 'facetValueIds', value: JSON.stringify([String(facetId)]) },
                { name: 'containsAny', value: 'true' },
                { name: 'combineWithAnd', value: 'false' },
            ],
        };
        if (!collection) {
            return this.collectionService.create(ctx, {
                ...(parentId ? { parentId } : {}),
                inheritFilters: false,
                filters: [filter],
                translations: [
                    {
                        languageCode: ctx.languageCode,
                        name,
                        slug: await this.uniqueCollectionSlug(ctx, name),
                        description: '',
                    },
                ],
            });
        }
        const filters = collection.filters.map(item => ({
            code: item.code,
            arguments: item.args.map(argument => ({ name: argument.name, value: argument.value })),
        }));
        const configured = filters.some(
            item =>
                item.code === filter.code &&
                item.arguments.some(
                    argument =>
                        argument.name === 'facetValueIds' && argument.value === filter.arguments[0].value,
                ) &&
                item.arguments.some(
                    argument => argument.name === 'containsAny' && argument.value === 'true',
                ) &&
                item.arguments.some(
                    argument => argument.name === 'combineWithAnd' && argument.value === 'false',
                ),
        );
        // Match the persisted category marker instead of growing a product-ID array on every imported row.
        // Existing manual and other rules are preserved; only this import rule is added once per category.
        if (configured) return collection;
        return this.collectionService.update(ctx, { id: collection.id, filters: [...filters, filter] });
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

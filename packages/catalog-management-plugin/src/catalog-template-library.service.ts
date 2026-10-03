import { Injectable } from '@nestjs/common';
import { DEFAULT_CHANNEL_CODE } from '@vendure/common/lib/shared-constants';
import { ID } from '@vendure/common/lib/shared-types';
import {
    Asset,
    CatalogResourceOwnership,
    Collection,
    Facet,
    FacetService,
    FacetValueService,
    ProductOptionGroup,
    ProductOptionGroupService,
    ProductOptionService,
    RequestContext,
    Tag,
    TransactionalConnection,
    UserInputError,
} from '@vendure/core';
import { CatalogGovernanceService } from '@vendure/store-management-plugin';
import { randomUUID } from 'node:crypto';
import { In } from 'typeorm';

@Injectable()
export class CatalogTemplateLibraryService {
    constructor(
        private readonly connection: TransactionalConnection,
        private readonly governance: CatalogGovernanceService,
        private readonly groups: ProductOptionGroupService,
        private readonly options: ProductOptionService,
        private readonly facets: FacetService,
        private readonly values: FacetValueService,
    ) {}

    async resources(
        ctx: RequestContext,
        type: 'Facet' | 'ProductOptionGroup' | 'Asset' | 'Tag' | 'Collection',
    ) {
        this.governance.assertPlatform(ctx);
        const entities = { Facet, ProductOptionGroup, Asset, Tag, Collection };
        const entity = entities[type];
        if (!entity) throw new UserInputError('资源类型无效');
        const records = await this.connection.getRepository(ctx, entity as typeof Facet).find({
            relations: ['Tag', 'Asset'].includes(type) ? [] : ['translations'],
            order: { id: 'ASC' },
        });
        const owners = await this.connection
            .getRepository(ctx, CatalogResourceOwnership)
            .find({ where: { resourceType: type } });
        return records
            .filter(r => !(r as any).deletedAt && !(r as any).isRoot)
            .map(r => ({
                resourceType: type,
                resourceId: String(r.id),
                name:
                    (r as any).value ??
                    (r as any).name ??
                    r.translations?.find(t => t.languageCode === ctx.languageCode)?.name ??
                    r.translations?.[0]?.name ??
                    '未命名',
                ownerChannelId:
                    owners.find(o => String(o.resourceId) === String(r.id))?.ownerChannelId ?? null,
                scope: owners.find(o => String(o.resourceId) === String(r.id))?.scope ?? 'REVIEW_REQUIRED',
            }));
    }

    async library(ctx: RequestContext) {
        const entries = await this.connection.getRepository(ctx, CatalogResourceOwnership).find({
            where: { scope: 'PLATFORM_TEMPLATE', resourceType: In(['Facet', 'ProductOptionGroup']) },
            order: { id: 'ASC' },
        });
        const result = [];
        for (const entry of entries) {
            const entity = entry.resourceType === 'Facet' ? Facet : ProductOptionGroup;
            // This deliberately bypasses the private row hook only after checking library membership.
            const resource = await this.connection
                .getRepository(ctx, entity as typeof Facet)
                .manager.getRepository(entity)
                .findOne({ where: { id: entry.resourceId }, relations: ['translations'] });
            if (!resource || ('deletedAt' in resource && resource.deletedAt)) continue;
            result.push({
                resourceType: entry.resourceType,
                resourceId: String(entry.resourceId),
                name:
                    resource.translations.find(t => t.languageCode === ctx.languageCode)?.name ??
                    resource.translations[0]?.name ??
                    '未命名',
            });
        }
        return result;
    }

    async claim(ctx: RequestContext, type: 'Facet' | 'ProductOptionGroup', id: ID) {
        if (ctx.channel.code === DEFAULT_CHANNEL_CODE) throw new UserInputError('请选择接收副本的经营店铺');
        const owner = await this.connection
            .getRepository(ctx, CatalogResourceOwnership)
            .findOne({ where: { resourceType: type, resourceId: id, scope: 'PLATFORM_TEMPLATE' } });
        if (!owner) throw new UserInputError('公共模板不存在');
        return this.copy(ctx, type, id);
    }

    async publish(ctx: RequestContext, type: 'Facet' | 'ProductOptionGroup', id: ID) {
        this.governance.assertPlatform(ctx);
        const owner = await this.connection
            .getRepository(ctx, CatalogResourceOwnership)
            .findOne({ where: { resourceType: type, resourceId: id } });
        if (!owner) throw new UserInputError('模板归属待核对');
        return this.copy(ctx, type, id);
    }

    private async copy(ctx: RequestContext, type: 'Facet' | 'ProductOptionGroup', id: ID) {
        if (!['Facet', 'ProductOptionGroup'].includes(type)) throw new UserInputError('不支持的模板类型');
        const code = `template-${ctx.channelId}-${randomUUID()}`;
        if (type === 'Facet') {
            const sourceFacet = await this.connection
                .getRepository(ctx, Facet)
                .manager.getRepository(Facet)
                .findOne({ where: { id }, relations: ['translations', 'values', 'values.translations'] });
            if (!sourceFacet) throw new UserInputError('模板不存在');
            const facetCopy = await this.facets.create(ctx, {
                code,
                isPrivate: sourceFacet.isPrivate,
                translations: sourceFacet.translations.map(t => ({
                    languageCode: t.languageCode,
                    name: t.name,
                })),
            });
            for (const value of sourceFacet.values)
                await this.values.create(ctx, facetCopy, {
                    facetId: facetCopy.id,
                    code: `${code}-${value.id}`,
                    translations: value.translations.map(t => ({
                        languageCode: t.languageCode,
                        name: t.name,
                    })),
                });
            return { resourceType: type, resourceId: String(facetCopy.id) };
        }
        const source = await this.connection
            .getRepository(ctx, ProductOptionGroup)
            .manager.getRepository(ProductOptionGroup)
            .findOne({ where: { id }, relations: ['translations', 'options', 'options.translations'] });
        if (!source || source.deletedAt) throw new UserInputError('模板不存在');
        const copy = await this.groups.create(ctx, {
            code,
            translations: source.translations.map(t => ({ languageCode: t.languageCode, name: t.name })),
        });
        for (const option of source.options.filter(o => !o.deletedAt))
            await this.options.create(ctx, copy.id, {
                productOptionGroupId: copy.id,
                code: `${code}-${option.id}`,
                translations: option.translations.map(t => ({ languageCode: t.languageCode, name: t.name })),
            });
        return { resourceType: type, resourceId: String(copy.id) };
    }
}

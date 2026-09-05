import { Injectable } from '@nestjs/common';
import { ID } from '@vendure/common/lib/shared-types';
import {
    Product,
    ProductOption,
    ProductOptionGroup,
    ProductOptionGroupService,
    ProductOptionService,
    ProductService,
    ProductVariant,
    ProductVariantService,
    RequestContext,
    TransactionalConnection,
} from '@vendure/core';
import { In, IsNull } from 'typeorm';

import { catalogImportOptionCode, catalogImportOptionGroupCode } from './catalog-import-planning';
import { CatalogSourceBinding } from './entities/catalog-source-binding.entity';

@Injectable()
export class CatalogImportOptionsService {
    constructor(
        private readonly connection: TransactionalConnection,
        private readonly productService: ProductService,
        private readonly productVariantService: ProductVariantService,
        private readonly productOptionGroupService: ProductOptionGroupService,
        private readonly productOptionService: ProductOptionService,
    ) {}

    async ensureImportVariantOptions(
        ctx: RequestContext,
        product: Product,
        sourceKey: string,
        sku: string,
        productHasMultipleImportRows: boolean,
    ): Promise<ID[]> {
        const variantRepository = this.connection.getRepository(ctx, ProductVariant);
        const existingVariants = await variantRepository.find({
            where: { productId: product.id, deletedAt: IsNull() },
            relations: ['options', 'options.group', 'translations'],
        });
        let groups = await this.productOptionGroupService.getOptionGroupsByProductId(ctx, product.id);
        if (existingVariants.length === 0 && !productHasMultipleImportRows && groups.length === 0) return [];

        const importGroupCode = catalogImportOptionGroupCode(product.id);
        let importGroup = groups.find(group => group.code === importGroupCode);
        if (!importGroup) {
            importGroup = await this.productOptionGroupService.create(ctx, {
                code: importGroupCode,
                translations: [{ languageCode: ctx.languageCode, name: '导入 SKU' }],
            });
            await this.productService.addOptionGroupToProduct(ctx, product.id, importGroup.id);
            groups = [...groups, importGroup];
        }

        const bindings = existingVariants.length
            ? await this.connection.getRepository(ctx, CatalogSourceBinding).find({
                  where: {
                      channelId: ctx.channelId,
                      productId: product.id,
                      variantId: In(existingVariants.map(variant => variant.id)),
                  },
                  order: { sourceKey: 'ASC' },
              })
            : [];
        const sourceKeyByVariantId = new Map<string, string>();
        for (const binding of bindings) {
            const variantId = String(binding.variantId);
            if (!sourceKeyByVariantId.has(variantId)) sourceKeyByVariantId.set(variantId, binding.sourceKey);
        }

        for (const existingVariant of existingVariants) {
            const optionIds: ID[] = [];
            for (const group of groups) {
                const current = existingVariant.options?.find(
                    existingOption => String(existingOption.groupId) === String(group.id),
                );
                if (current) {
                    optionIds.push(current.id);
                    continue;
                }
                const isImportGroup = String(group.id) === String(importGroup.id);
                const fallbackKey = isImportGroup
                    ? (sourceKeyByVariantId.get(String(existingVariant.id)) ??
                      `existing-${String(existingVariant.id)}`)
                    : `unspecified-${String(group.id)}`;
                const option = await this.ensureProductOption(
                    ctx,
                    group,
                    catalogImportOptionCode(fallbackKey),
                    isImportGroup ? existingVariant.sku : '未指定',
                );
                optionIds.push(option.id);
            }
            const currentOptionIds = (existingVariant.options ?? []).map(option => String(option.id)).sort();
            const nextOptionIds = optionIds.map(String).sort();
            if (currentOptionIds.join(',') !== nextOptionIds.join(',')) {
                await this.productVariantService.update(ctx, [{ id: existingVariant.id, optionIds }]);
            }
        }

        const result: ID[] = [];
        for (const group of groups) {
            const isImportGroup = String(group.id) === String(importGroup.id);
            const option = await this.ensureProductOption(
                ctx,
                group,
                catalogImportOptionCode(isImportGroup ? sourceKey : `unspecified-${String(group.id)}`),
                isImportGroup ? sku : '未指定',
            );
            result.push(option.id);
        }
        return result;
    }

    private async ensureProductOption(
        ctx: RequestContext,
        group: ProductOptionGroup,
        code: string,
        name: string,
    ): Promise<ProductOption> {
        const existing = group.options?.find(option => option.code === code && !option.deletedAt);
        if (existing) return existing;
        const created = await this.productOptionService.create(ctx, group, {
            code,
            translations: [{ languageCode: ctx.languageCode, name }],
        });
        group.options = [...(group.options ?? []), created];
        return created;
    }
}

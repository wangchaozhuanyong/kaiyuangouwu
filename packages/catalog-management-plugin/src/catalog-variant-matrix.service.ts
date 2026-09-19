import { Injectable } from '@nestjs/common';
import type {
    CreateProductVariantInput,
    UpdateProductVariantInput,
} from '@vendure/common/lib/generated-types';
import type { ID } from '@vendure/common/lib/shared-types';
import {
    EntityNotFoundError,
    ProductOptionGroupService,
    ProductService,
    ProductVariantService,
    RequestContext,
    TransactionalConnection,
    UserInputError,
} from '@vendure/core';

export interface ApplyCatalogVariantMatrixInput {
    productId: ID;
    targetOptionGroupIds: ID[];
    updateVariants: UpdateProductVariantInput[];
    createVariants: CreateProductVariantInput[];
}

@Injectable()
export class CatalogVariantMatrixService {
    constructor(
        private readonly connection: TransactionalConnection,
        private readonly products: ProductService,
        private readonly variants: ProductVariantService,
        private readonly optionGroups: ProductOptionGroupService,
    ) {}

    async apply(ctx: RequestContext, input: ApplyCatalogVariantMatrixInput) {
        const targetIds = input.targetOptionGroupIds.map(String);
        if (new Set(targetIds).size !== targetIds.length) {
            throw new UserInputError('目标规格模板包含重复项');
        }
        if (input.createVariants.some(variant => String(variant.productId) !== String(input.productId))) {
            throw new UserInputError('新增 SKU 不属于当前商品');
        }

        return this.connection.withTransaction(ctx, async txCtx => {
            const product = await this.products.findOne(txCtx, input.productId, ['optionGroups', 'variants']);
            if (!product) throw new EntityNotFoundError('Product', input.productId);

            const productVariantIds = new Set(product.variants.map(variant => String(variant.id)));
            if (input.updateVariants.some(variant => !productVariantIds.has(String(variant.id)))) {
                throw new UserInputError('要更新的 SKU 不属于当前商品');
            }

            const currentGroups = await this.optionGroups.getOptionGroupsByProductId(txCtx, input.productId);
            const currentIds = currentGroups.map(group => String(group.id));
            const addedIds = input.targetOptionGroupIds.filter(id => !currentIds.includes(String(id)));
            const removedIds = currentGroups
                .filter(group => !targetIds.includes(String(group.id)))
                .map(group => group.id);

            for (const optionGroupId of addedIds) {
                await this.products.addOptionGroupToProduct(txCtx, input.productId, optionGroupId);
            }
            if (input.updateVariants.length > 0) {
                await this.variants.update(txCtx, input.updateVariants);
            }
            if (input.createVariants.length > 0) {
                await this.variants.create(txCtx, input.createVariants);
            }
            if (removedIds.length > 0) {
                const latest = await this.products.findOne(txCtx, input.productId);
                if (!latest) throw new EntityNotFoundError('Product', input.productId);
                await this.products.removeOptionGroupsFromProduct(
                    txCtx,
                    input.productId,
                    removedIds,
                    latest.updatedAt,
                );
            }

            const updated = await this.products.findOne(txCtx, input.productId, ['optionGroups', 'variants']);
            if (!updated) throw new EntityNotFoundError('Product', input.productId);
            return updated;
        });
    }
}

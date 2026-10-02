import { DEFAULT_CHANNEL_CODE } from '@vendure/common/lib/shared-constants';
import {
    CatalogResourceOwnership,
    DefaultEntityAccessControlStrategy,
    RequestContext,
    VendureEntity,
} from '@vendure/core';
import { SelectQueryBuilder } from 'typeorm';

/** Uses Vendure's existing row access hook, including direct service reads and counts. */
export class CatalogGovernanceAccessStrategy extends DefaultEntityAccessControlStrategy {
    readonly platformStoreGovernance = true;

    applyAccessControl<T extends VendureEntity>(
        qb: SelectQueryBuilder<T>,
        entity: new (...args: any[]) => T,
        ctx: RequestContext,
    ): void {
        const type = entity.name;
        const privateTypes = ['ProductOptionGroup', 'ProductOption', 'Facet', 'FacetValue', 'Tag', 'Asset'];
        if (!ctx.channelId) return;
        if (ctx.channel.code === DEFAULT_CHANNEL_CODE) {
            // Keep historical account/order access, but never expose the management
            // center's global catalog through the public Shop API.
            if (
                ctx.apiType === 'shop' &&
                [
                    ...privateTypes,
                    'Product',
                    'ProductVariant',
                    'SearchIndexItem',
                    'Collection',
                    'Asset',
                ].includes(type)
            ) {
                qb.andWhere('1 = 0');
            }
            return;
        }
        if (privateTypes.includes(type)) {
            // The product dependency reader adds a bounded product/variant query itself.
            if (qb.expressionMap.comment === 'catalog-authorized-product-dependencies') return;
            const ownership = qb
                .subQuery()
                .select('1')
                .from(CatalogResourceOwnership, 'catalogOwner')
                .where(`catalogOwner.resourceId = ${qb.alias}.id`)
                .andWhere('catalogOwner.resourceType = :catalogResourceType')
                .andWhere('catalogOwner.ownerChannelId = :catalogOwnerChannelId')
                .andWhere("catalogOwner.scope = 'STORE'")
                .getQuery();
            const existing = qb
                .subQuery()
                .select('1')
                .from(CatalogResourceOwnership, 'existingOwner')
                .where(`existingOwner.resourceId = ${qb.alias}.id`)
                .andWhere('existingOwner.resourceType = :catalogResourceType')
                .getQuery();
            const legacy = this.exclusiveLegacyScope(qb, entity, ctx);
            qb.andWhere(`(EXISTS ${ownership} OR (NOT EXISTS ${existing} AND ${legacy}))`, {
                catalogResourceType: type,
                catalogOwnerChannelId: ctx.channelId,
                catalogDefaultCode: DEFAULT_CHANNEL_CODE,
            });
        }
        if (
            type === 'Product' ||
            type === 'ProductVariant' ||
            (type === 'SearchIndexItem' && ctx.apiType === 'shop')
        ) {
            const productId = type === 'Product' ? `${qb.alias}.id` : `${qb.alias}.productId`;
            const variantId =
                type === 'ProductVariant'
                    ? `${qb.alias}.id`
                    : type === 'SearchIndexItem'
                      ? `${qb.alias}.productVariantId`
                      : null;
            const database = qb.connection.options.type;
            const variantClause = !variantId
                ? ''
                : database === 'mysql' || database === 'mariadb'
                  ? ` AND JSON_CONTAINS(sale.variantIds, JSON_QUOTE(CAST(${variantId} AS CHAR)))`
                  : database === 'postgres'
                    ? ` AND EXISTS (SELECT 1 FROM jsonb_array_elements_text(sale.\"variantIds\"::jsonb) variantGrant WHERE variantGrant = CAST(${variantId} AS TEXT))`
                    : ` AND EXISTS (SELECT 1 FROM json_each(sale.variantIds) variantGrant WHERE variantGrant.value = CAST(${variantId} AS TEXT))`;
            const pendingClause =
                ctx.apiType !== 'shop' || !variantId
                    ? ''
                    : database === 'mysql' || database === 'mariadb'
                      ? ` AND (sale.pendingVariantIds IS NULL OR NOT JSON_CONTAINS(sale.pendingVariantIds, JSON_QUOTE(CAST(${variantId} AS CHAR))))`
                      : database === 'postgres'
                        ? ` AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements_text(COALESCE(sale.\"pendingVariantIds\", '[]')::jsonb)
                            pendingGrant WHERE pendingGrant = CAST(${variantId} AS TEXT))`
                        : ` AND NOT EXISTS (SELECT 1 FROM json_each(COALESCE(sale.pendingVariantIds, '[]'))
                            pendingGrant WHERE pendingGrant.value = CAST(${variantId} AS TEXT))`;
            const salesSql = `(
                EXISTS (SELECT 1 FROM product_sales_authorization sale
                    WHERE sale.productId = ${productId} AND sale.channelId = :catalogSalesChannel
                    AND ${ctx.apiType === 'shop' ? "sale.state = 'ACTIVE'" : "sale.state <> 'REVOKED'"}${variantClause}${pendingClause})
                OR (NOT EXISTS (SELECT 1 FROM product_sales_authorization sale
                    WHERE sale.productId = ${productId} AND sale.channelId = :catalogSalesChannel)
                    AND EXISTS (SELECT 1 FROM catalog_resource_ownership owner
                    WHERE owner.resourceType = 'Product' AND owner.resourceId = ${productId}
                    AND owner.ownerChannelId = :catalogSalesChannel))
                OR (NOT EXISTS (SELECT 1 FROM catalog_resource_ownership owner WHERE owner.resourceType = 'Product' AND owner.resourceId = ${productId})
                    AND NOT EXISTS (SELECT 1 FROM product_sales_authorization sale WHERE sale.productId = ${productId} AND sale.channelId = :catalogSalesChannel)
                    AND ${this.legacyProductScope(qb, productId)})
            )`;
            const quotedSql = salesSql.replace(
                /\b(sale|owner)\.(productId|channelId|resourceType|resourceId|ownerChannelId|variantIds|pendingVariantIds)\b/g,
                (_, alias, column) => `${alias}.${qb.escape(column)}`,
            );
            qb.andWhere(quotedSql, {
                catalogSalesChannel: ctx.channelId,
                catalogDefaultCode: DEFAULT_CHANNEL_CODE,
            });
        }
    }
    private legacyProductScope(qb: SelectQueryBuilder<any>, productId: string) {
        const escape = (column: string) => qb.escape(column);
        return `EXISTS (SELECT 1 FROM product_channels_channel legacyLink WHERE legacyLink.${escape('productId')} = ${productId}
            AND legacyLink.${escape('channelId')} = :catalogSalesChannel)
            AND NOT EXISTS (SELECT 1 FROM product_channels_channel legacyLink JOIN channel legacyChannel ON legacyChannel.id = legacyLink.${escape('channelId')}
            WHERE legacyLink.${escape('productId')} = ${productId} AND legacyChannel.id <> :catalogSalesChannel AND legacyChannel.code <> :catalogDefaultCode)`;
    }

    private exclusiveLegacyScope(
        qb: SelectQueryBuilder<any>,
        entity: new (...args: any[]) => any,
        ctx: RequestContext,
    ) {
        if (entity.name === 'Tag') return `${qb.alias}.ownerChannelId = :catalogOwnerChannelId`;
        const current = qb
            .subQuery()
            .select('1')
            .from(entity, 'legacyResource')
            .innerJoin('legacyResource.channels', 'legacyChannel')
            .where(`legacyResource.id = ${qb.alias}.id`)
            .andWhere('legacyChannel.id = :catalogOwnerChannelId')
            .getQuery();
        const other = qb
            .subQuery()
            .select('1')
            .from(entity, 'otherResource')
            .innerJoin('otherResource.channels', 'otherChannel')
            .where(`otherResource.id = ${qb.alias}.id`)
            .andWhere(
                'otherChannel.id <> :catalogOwnerChannelId AND otherChannel.code <> :catalogDefaultCode',
            )
            .getQuery();
        return `(EXISTS ${current} AND NOT EXISTS ${other})`;
    }
}

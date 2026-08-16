import { Injectable } from '@nestjs/common';
import { ID, Type } from '@vendure/common/lib/shared-types';
import {
    Asset,
    ChannelAware,
    ChannelService,
    Collection,
    Facet,
    FacetValue,
    ForbiddenError,
    Fulfillment,
    idsAreEqual,
    Order,
    OrderLine,
    Product,
    ProductOption,
    ProductOptionGroup,
    ProductVariant,
    RequestContext,
    StockLocation,
    TransactionalConnection,
    User,
    VendureEntity,
} from '@vendure/core';

import { StoreAdministratorAccess } from './entities/store-administrator-access.entity';

const merchantScopeExemptions = new Set([
    'Query.activeAdministrator',
    'Query.me',
    'Query.merchantInitialPasswordStatus',
    'Mutation.completeInitialPasswordChange',
    'Mutation.login',
    'Mutation.logout',
]);

const channelTransferMutations = new Set([
    'assignAssetsToChannel',
    'assignCollectionsToChannel',
    'assignFacetsToChannel',
    'assignPaymentMethodsToChannel',
    'assignProductOptionGroupsToChannel',
    'assignProductsToChannel',
    'assignProductVariantsToChannel',
    'assignPromotionsToChannel',
    'assignShippingMethodsToChannel',
    'assignStockLocationsToChannel',
    'removeCollectionsFromChannel',
    'removeFacetsFromChannel',
    'removePaymentMethodsFromChannel',
    'removeProductOptionGroupsFromChannel',
    'removeProductsFromChannel',
    'removeProductVariantsFromChannel',
    'removePromotionsFromChannel',
    'removeShippingMethodsFromChannel',
    'removeStockLocationsFromChannel',
    'createStockLocation',
    'deleteStockLocation',
    'deleteStockLocations',
    'updateStockLocation',
]);

const platformOrderMutations = new Set([
    'cancelOrder',
    'modifyOrder',
    'setOrderCustomFields',
    'setOrderCustomer',
    'transitionOrderToState',
    'updateOrderNote',
    'deleteOrderNote',
]);

interface CatalogMutationInput {
    assetId?: ID;
    assetIds?: ID[];
    collectionId?: ID;
    facetId?: ID;
    id?: ID;
    parentId?: ID;
    lines?: Array<{ orderLineId: ID }> | null;
    productId?: ID;
    productOptionGroupId?: ID;
    stockLevels?: Array<{ stockLocationId: ID }> | null;
}

@Injectable()
export class MerchantCatalogAccessService {
    constructor(
        private readonly connection: TransactionalConnection,
        private readonly channelService: ChannelService,
    ) {}

    async assertRootFieldAccess(
        ctx: RequestContext,
        parentType: string,
        fieldName: string,
        args: Record<string, unknown>,
    ): Promise<void> {
        if (
            ctx.apiType !== 'admin' ||
            !ctx.activeUserId ||
            merchantScopeExemptions.has(`${parentType}.${fieldName}`)
        ) {
            return;
        }

        const channelIds = await this.getMerchantChannelIds(ctx);
        if (channelIds == null) {
            return;
        }
        if (channelIds.length !== 1 || !idsAreEqual(channelIds[0], ctx.channelId)) {
            throw new ForbiddenError();
        }

        if (parentType !== 'Mutation') {
            return;
        }
        if (channelTransferMutations.has(fieldName)) {
            throw new ForbiddenError();
        }
        if (this.isPlatformOrderMutation(fieldName)) {
            throw new ForbiddenError();
        }

        const inputs = this.getInputs(args);
        await this.assertMerchantOrderOperation(ctx, fieldName, args, inputs);
        await this.assertExclusiveCatalogEntities(ctx, fieldName, args, inputs);
        if (fieldName === 'createProductVariants') {
            await this.assertEntitiesExclusiveToActiveChannel(
                ctx,
                Product,
                inputs.flatMap(input => (input.productId == null ? [] : [input.productId])),
            );
        }
        if (
            fieldName === 'createProductVariants' ||
            fieldName === 'updateProductVariant' ||
            fieldName === 'updateProductVariants'
        ) {
            await this.assertStockLocationsBelongToActiveChannel(
                ctx,
                inputs.flatMap(input => input.stockLevels?.map(level => level.stockLocationId) ?? []),
            );
        }
    }

    private isPlatformOrderMutation(fieldName: string): boolean {
        return (
            platformOrderMutations.has(fieldName) ||
            fieldName.includes('DraftOrder') ||
            /payment|refund/i.test(fieldName)
        );
    }

    private async assertMerchantOrderOperation(
        ctx: RequestContext,
        fieldName: string,
        args: Record<string, unknown>,
        inputs: CatalogMutationInput[],
    ): Promise<void> {
        switch (fieldName) {
            case 'addFulfillmentToOrder':
                return this.assertOrderLinesBelongToActiveChannel(
                    ctx,
                    inputs.flatMap(input => input.lines?.map(line => line.orderLineId) ?? []),
                );
            case 'transitionFulfillmentToState':
                return this.assertFulfillmentsBelongToActiveChannel(ctx, this.namedIds(args, 'id'));
            case 'addNoteToOrder':
                return this.assertEntitiesBelongToActiveChannel(
                    ctx,
                    Order,
                    inputs.flatMap(input => (input.id == null ? [] : [input.id])),
                );
        }
    }

    private async assertOrderLinesBelongToActiveChannel(ctx: RequestContext, ids: ID[]): Promise<void> {
        const uniqueIds = this.uniqueIds(ids);
        if (uniqueIds.length === 0) {
            throw new ForbiddenError();
        }
        const lines = await this.connection.getRepository(ctx, OrderLine).find({
            where: uniqueIds.map(id => ({ id })),
            relations: ['order', 'order.channels'],
        });
        if (
            lines.length !== uniqueIds.length ||
            lines.some(line => !line.order.channels.some(channel => idsAreEqual(channel.id, ctx.channelId)))
        ) {
            throw new ForbiddenError();
        }
    }

    private async assertFulfillmentsBelongToActiveChannel(ctx: RequestContext, ids: ID[]): Promise<void> {
        const uniqueIds = this.uniqueIds(ids);
        if (uniqueIds.length === 0) {
            throw new ForbiddenError();
        }
        const fulfillments = await this.connection.getRepository(ctx, Fulfillment).find({
            where: uniqueIds.map(id => ({ id })),
            relations: ['orders', 'orders.channels'],
        });
        if (
            fulfillments.length !== uniqueIds.length ||
            fulfillments.some(
                fulfillment =>
                    fulfillment.orders.length === 0 ||
                    fulfillment.orders.some(
                        order => !order.channels.some(channel => idsAreEqual(channel.id, ctx.channelId)),
                    ),
            )
        ) {
            throw new ForbiddenError();
        }
    }

    private async getMerchantChannelIds(ctx: RequestContext): Promise<ID[] | null> {
        const access = await this.connection
            .getRepository(ctx, StoreAdministratorAccess)
            .findOne({ where: { userId: ctx.activeUserId } });
        if (!access) {
            return null;
        }
        const user = await this.connection.getRepository(ctx, User).findOne({
            where: { id: ctx.activeUserId },
            relations: { roles: { channels: true } },
        });
        if (!user) {
            throw new ForbiddenError();
        }
        return this.uniqueIds(user.roles.flatMap(role => role.channels.map(channel => channel.id)));
    }

    private async assertStockLocationsBelongToActiveChannel(ctx: RequestContext, ids: ID[]): Promise<void> {
        const uniqueIds = this.uniqueIds(ids);
        if (uniqueIds.length === 0) {
            return;
        }
        const stockLocations = await this.connection.findByIdsInChannel(
            ctx,
            StockLocation,
            uniqueIds,
            ctx.channelId,
            {},
        );
        if (stockLocations.length !== uniqueIds.length) {
            throw new ForbiddenError();
        }
    }

    private getInputs(args: Record<string, unknown>): CatalogMutationInput[] {
        const input = args.input;
        if (Array.isArray(input)) {
            return input as CatalogMutationInput[];
        }
        return input && typeof input === 'object' ? [input as CatalogMutationInput] : [];
    }

    private async assertExclusiveCatalogEntities(
        ctx: RequestContext,
        fieldName: string,
        args: Record<string, unknown>,
        inputs: CatalogMutationInput[],
    ): Promise<void> {
        const inputIds = inputs.flatMap(input => (input.id == null ? [] : [input.id]));
        const directIds = this.directIds(args);
        switch (fieldName) {
            case 'updateProduct':
            case 'updateProducts':
            case 'deleteProduct':
            case 'deleteProducts':
            case 'addOptionGroupToProduct':
            case 'removeOptionGroupFromProduct':
                return this.assertEntitiesExclusiveToActiveChannel(ctx, Product, [
                    ...inputIds,
                    ...directIds,
                    ...this.namedIds(args, 'productId'),
                ]);
            case 'updateProductVariant':
            case 'updateProductVariants':
            case 'deleteProductVariant':
            case 'deleteProductVariants':
                return this.assertEntitiesExclusiveToActiveChannel(ctx, ProductVariant, [
                    ...inputIds,
                    ...directIds,
                ]);
            case 'updateAsset':
            case 'deleteAsset':
            case 'deleteAssets':
                return this.assertEntitiesExclusiveToActiveChannel(ctx, Asset, [
                    ...inputIds,
                    ...inputs.flatMap(input => (input.assetId == null ? [] : [input.assetId])),
                    ...inputs.flatMap(input => input.assetIds ?? []),
                ]);
            case 'updateCollection':
            case 'deleteCollection':
            case 'deleteCollections':
                return this.assertEntitiesExclusiveToActiveChannel(ctx, Collection, [
                    ...inputIds,
                    ...directIds,
                ]);
            case 'moveCollection':
                await this.assertEntitiesExclusiveToActiveChannel(
                    ctx,
                    Collection,
                    inputs.flatMap(input => (input.collectionId == null ? [] : [input.collectionId])),
                );
                return this.assertEntitiesBelongToActiveChannel(
                    ctx,
                    Collection,
                    inputs.flatMap(input => (input.parentId == null ? [] : [input.parentId])),
                );
            case 'updateFacet':
            case 'deleteFacet':
            case 'deleteFacets':
                return this.assertEntitiesExclusiveToActiveChannel(ctx, Facet, [...inputIds, ...directIds]);
            case 'createFacetValue':
            case 'createFacetValues':
                return this.assertEntitiesExclusiveToActiveChannel(
                    ctx,
                    Facet,
                    inputs.flatMap(input => (input.facetId == null ? [] : [input.facetId])),
                );
            case 'updateFacetValue':
            case 'updateFacetValues':
            case 'deleteFacetValues':
                return this.assertEntitiesExclusiveToActiveChannel(ctx, FacetValue, [
                    ...inputIds,
                    ...directIds,
                ]);
            case 'updateProductOptionGroup':
            case 'deleteProductOptionGroup':
            case 'deleteProductOptionGroups':
                return this.assertEntitiesExclusiveToActiveChannel(ctx, ProductOptionGroup, [
                    ...inputIds,
                    ...directIds,
                ]);
            case 'createProductOption':
                return this.assertEntitiesExclusiveToActiveChannel(
                    ctx,
                    ProductOptionGroup,
                    inputs.flatMap(input =>
                        input.productOptionGroupId == null ? [] : [input.productOptionGroupId],
                    ),
                );
            case 'updateProductOption':
            case 'deleteProductOption':
                return this.assertEntitiesExclusiveToActiveChannel(ctx, ProductOption, [
                    ...inputIds,
                    ...directIds,
                ]);
        }
    }

    private async assertEntitiesExclusiveToActiveChannel<T extends VendureEntity & ChannelAware>(
        ctx: RequestContext,
        entity: Type<T>,
        ids: ID[],
    ): Promise<void> {
        const uniqueIds = this.uniqueIds(ids);
        if (uniqueIds.length === 0) {
            return;
        }
        const entities = await this.connection.findByIdsInChannel(ctx, entity, uniqueIds, ctx.channelId, {
            relations: ['channels'],
        });
        const defaultChannel = await this.channelService.getDefaultChannel(ctx);
        const allowedChannelIds = [ctx.channelId, defaultChannel.id];
        const containsForeignOrSharedEntity = entities.some(
            item =>
                !item.channels.some(channel => idsAreEqual(channel.id, ctx.channelId)) ||
                item.channels.some(
                    channel => !allowedChannelIds.some(allowedId => idsAreEqual(channel.id, allowedId)),
                ),
        );
        if (entities.length !== uniqueIds.length || containsForeignOrSharedEntity) {
            throw new ForbiddenError();
        }
    }

    private async assertEntitiesBelongToActiveChannel<T extends VendureEntity & ChannelAware>(
        ctx: RequestContext,
        entity: Type<T>,
        ids: ID[],
    ): Promise<void> {
        const uniqueIds = this.uniqueIds(ids);
        if (uniqueIds.length === 0) {
            return;
        }
        const entities = await this.connection.findByIdsInChannel(ctx, entity, uniqueIds, ctx.channelId, {});
        if (entities.length !== uniqueIds.length) {
            throw new ForbiddenError();
        }
    }

    private directIds(args: Record<string, unknown>): ID[] {
        return [...this.namedIds(args, 'id'), ...this.namedIds(args, 'ids')];
    }

    private namedIds(args: Record<string, unknown>, key: string): ID[] {
        const value = args[key];
        if (Array.isArray(value)) {
            return value as ID[];
        }
        return value == null ? [] : [value as ID];
    }

    private uniqueIds(ids: ID[]): ID[] {
        return ids.filter((id, index) => ids.findIndex(candidate => idsAreEqual(candidate, id)) === index);
    }
}

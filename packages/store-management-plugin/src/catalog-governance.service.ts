import { Injectable } from '@nestjs/common';
import { DEFAULT_CHANNEL_CODE } from '@vendure/common/lib/shared-constants';
import { ID } from '@vendure/common/lib/shared-types';
import {
    CATALOG_RESOURCE_TYPES,
    CatalogResourceOwnership,
    CatalogResourceType,
    ForbiddenError,
    Permission,
    Product,
    ProductSalesAuthorization,
    RequestContext,
    TransactionalConnection,
    UserInputError,
} from '@vendure/core';

import { managePlatformCatalogPermission } from './constants';

@Injectable()
export class CatalogGovernanceService {
    constructor(private readonly connection: TransactionalConnection) {}

    assertPlatform(ctx: RequestContext) {
        if (
            ctx.apiType !== 'admin' ||
            ctx.channel.code !== DEFAULT_CHANNEL_CODE ||
            !ctx.userHasPermissions([managePlatformCatalogPermission.Permission, Permission.SuperAdmin])
        ) {
            throw new ForbiddenError();
        }
    }

    async assertOwned(ctx: RequestContext, resourceType: CatalogResourceType, id: ID) {
        if (!CATALOG_RESOURCE_TYPES.includes(resourceType)) throw new UserInputError('资源类型无效');
        let owner = await this.connection.getRepository(ctx, CatalogResourceOwnership).findOne({
            where: { resourceType, resourceId: id },
        });
        if (!owner && ctx.channel.code !== DEFAULT_CHANNEL_CODE && resourceType !== 'Tag') {
            const target = this.connection.rawConnection.getMetadata(resourceType).target;
            const resource = await this.connection
                .getRepository(ctx, CatalogResourceOwnership)
                .manager.getRepository(target)
                .findOne({ where: { id }, relations: ['channels'] });
            const operatingIds = (resource?.channels ?? [])
                .filter((c: any) => c.code !== DEFAULT_CHANNEL_CODE)
                .map((c: any) => String(c.id));
            if (operatingIds.length === 1 && operatingIds[0] === String(ctx.channelId))
                owner = new CatalogResourceOwnership({
                    resourceType,
                    resourceId: id,
                    ownerChannelId: ctx.channelId,
                    scope: 'STORE',
                });
        }
        if (!owner) throw new UserInputError('资源维护归属待核对，请先在平台管理中心整理');
        if (ctx.channel.code === DEFAULT_CHANNEL_CODE) {
            this.assertPlatform(ctx);
            return owner;
        }
        if (String(owner.ownerChannelId) !== String(ctx.channelId) || owner.scope !== 'STORE') {
            throw new UserInputError('只能修改当前店铺维护的资源；授权商品请使用本店经营设置');
        }
        return owner;
    }

    async myOffer(ctx: RequestContext, productId: ID) {
        if (ctx.channel.code === DEFAULT_CHANNEL_CODE) throw new ForbiddenError();
        const product = await this.connection.findOneInChannel(ctx, Product, productId, ctx.channelId);
        if (!product || product.deletedAt) throw new ForbiddenError();
        const recordedOwner = await this.connection.getRepository(ctx, CatalogResourceOwnership).findOne({
            where: { resourceType: 'Product', resourceId: productId },
        });
        const owner = recordedOwner ?? (await this.assertOwned(ctx, 'Product', productId));
        const grant = await this.connection.getRepository(ctx, ProductSalesAuthorization).findOne({
            where: { productId, channelId: ctx.channelId },
        });
        if (!owner || (!grant && String(owner.ownerChannelId) !== String(ctx.channelId))) {
            throw new UserInputError('没有有效销售授权');
        }
        return { product, owner, grant };
    }
}

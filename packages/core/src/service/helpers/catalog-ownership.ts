import { DEFAULT_CHANNEL_CODE } from '@vendure/common/lib/shared-constants';
import { ID } from '@vendure/common/lib/shared-types';

import { RequestContext } from '../../api/common/request-context';
import { UserInputError } from '../../common/error/errors';
import { TransactionalConnection } from '../../connection/transactional-connection';
import { CatalogResourceOwnership } from '../../entity/catalog-governance/catalog-resource-ownership.entity';
import { Product } from '../../entity/product/product.entity';

/** Internal import/worker writes must obey the same canonical ownership as GraphQL writes. */
export async function assertCatalogProductMaintainer(
    connection: TransactionalConnection,
    ctx: RequestContext,
    productId: ID,
) {
    if (!connection.platformStoreGovernanceEnabled) return;
    const owner = await connection
        .getRepository(ctx, CatalogResourceOwnership)
        .findOne({ where: { resourceType: 'Product', resourceId: productId } });
    if (!owner && ctx.channel.code !== DEFAULT_CHANNEL_CODE) {
        const product = await connection
            .getRepository(ctx, Product)
            .manager.getRepository(Product)
            .findOne({ where: { id: productId }, relations: ['channels'] });
        const operating = (product?.channels ?? []).filter(c => c.code !== DEFAULT_CHANNEL_CODE);
        if (operating.length !== 1 || String(operating[0].id) !== String(ctx.channelId))
            throw new UserInputError('商品维护归属待核对，不能修改历史共享商品');
    }
    if (
        owner &&
        ctx.channel.code !== DEFAULT_CHANNEL_CODE &&
        String(owner.ownerChannelId) !== String(ctx.channelId)
    ) {
        throw new UserInputError('授权销售商品的公共资料和规格只能由维护店铺修改');
    }
}

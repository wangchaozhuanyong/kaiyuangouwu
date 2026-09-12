import { idsAreEqual, RequestContext, TransactionalConnection, UserInputError } from '@vendure/core';

import { StoreCouponCampaignConfig } from '../entities/store-coupon-campaign-config.entity';

/** All coupon mutations serialize with issuance on the owning campaign configuration. */
export async function lockCouponCampaign(
    connection: TransactionalConnection,
    ctx: RequestContext,
    config: StoreCouponCampaignConfig,
): Promise<StoreCouponCampaignConfig> {
    if (!idsAreEqual(config.channelId, ctx.channelId)) throw new UserInputError('该优惠券属于其他店铺');
    const repository = connection.getRepository(ctx, StoreCouponCampaignConfig);
    await repository
        .createQueryBuilder()
        .update()
        .set({ updatedAt: () => 'updatedAt' })
        .where('id = :id', { id: config.id })
        .execute();
    const fresh = await repository.findOneOrFail({ where: { id: config.id } });
    if (!idsAreEqual(fresh.channelId, ctx.channelId)) throw new UserInputError('该优惠券属于其他店铺');
    return fresh;
}

import { Injectable } from '@nestjs/common';
import { DEFAULT_CHANNEL_CODE } from '@vendure/common/lib/shared-constants';
import {
    Channel,
    ListQueryOptions,
    Permission,
    Product,
    ProductService,
    RequestContext,
    TransactionalConnection,
    UserInputError,
} from '@vendure/core';
import { In } from 'typeorm';

/** Read-only assignment view. Core Product.channels intentionally hides other stores outside the default channel. */
@Injectable()
export class CatalogChannelAssignmentsService {
    constructor(
        private readonly connection: TransactionalConnection,
        private readonly products: ProductService,
    ) {}

    async list(ctx: RequestContext, options: ListQueryOptions<Product> = {}) {
        if ((options.take ?? 100) < 1 || (options.take ?? 100) > 100) {
            throw new UserInputError('每次最多读取 100 个商品的店铺分配');
        }
        const isOwner = ctx.userHasPermissions([Permission.SuperAdmin]);
        const readableIds = (ctx.session?.user?.channelPermissions ?? [])
            .filter(item => item.permissions.includes(Permission.ReadProduct))
            .map(item => item.id);
        const channels =
            isOwner || readableIds.length
                ? await this.connection.getRepository(ctx, Channel).find({
                      ...(isOwner ? {} : { where: { id: In(readableIds) } }),
                      select: { id: true, code: true },
                      order: { code: 'ASC' },
                      loadEagerRelations: false,
                  })
                : [];
        const allowedIds = new Set(channels.map(channel => String(channel.id)));
        const page = await this.products.findAll(ctx, { ...options, take: options.take ?? 100 }, [
            'translations',
        ]);
        const assignments = page.items.length
            ? await this.connection
                  .getRepository(ctx, Product)
                  .createQueryBuilder('product')
                  .leftJoinAndSelect('product.channels', 'channel')
                  .where('product.id IN (:...ids)', { ids: page.items.map(product => product.id) })
                  .getMany()
            : [];
        const byId = new Map(assignments.map(product => [String(product.id), product.channels]));
        const toChannel = (channel: Channel) => ({
            id: channel.id,
            code: channel.code,
            isDefault: channel.code === DEFAULT_CHANNEL_CODE,
        });
        return {
            totalItems: page.totalItems,
            channels: channels.map(toChannel),
            items: page.items.map(product => ({
                id: product.id,
                name: product.name,
                enabled: product.enabled,
                channels: (byId.get(String(product.id)) ?? [])
                    .filter(channel => allowedIds.has(String(channel.id)))
                    .map(toChannel),
            })),
        };
    }
}

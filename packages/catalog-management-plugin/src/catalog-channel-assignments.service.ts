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

export type CatalogChannelAssignmentFilter = {
    mode?: 'ALL' | 'UNASSIGNED' | 'MULTI' | 'CHANNEL';
    channelId?: string | null;
};

/** Read-only assignment view. Core Product.channels intentionally hides other stores outside the default channel. */
@Injectable()
export class CatalogChannelAssignmentsService {
    constructor(
        private readonly connection: TransactionalConnection,
        private readonly products: ProductService,
    ) {}

    async list(
        ctx: RequestContext,
        options: ListQueryOptions<Product> = {},
        assignmentFilter: CatalogChannelAssignmentFilter = {},
    ) {
        const take = options.take ?? 50;
        const skip = options.skip ?? 0;
        if (take < 1 || take > 100) {
            throw new UserInputError('每次最多读取 100 个商品的店铺分配');
        }
        if (skip < 0) throw new UserInputError('分页起点不能小于 0');
        if (assignmentFilter.mode === 'CHANNEL' && !assignmentFilter.channelId) {
            throw new UserInputError('按店铺筛选时必须提供 channelId');
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
        const aggregateOptions = { ...options };
        delete aggregateOptions.skip;
        delete aggregateOptions.take;
        const products: Product[] = [];
        let catalogTotalItems = 0;
        for (let aggregateSkip = 0; ; aggregateSkip += 100) {
            const page = await this.products.findAll(
                ctx,
                { ...aggregateOptions, skip: aggregateSkip, take: 100 },
                ['translations'],
            );
            catalogTotalItems = page.totalItems;
            products.push(...page.items);
            if (products.length >= catalogTotalItems || page.items.length === 0) break;
        }

        const assignments: Product[] = [];
        for (let offset = 0; offset < products.length; offset += 500) {
            const ids = products.slice(offset, offset + 500).map(product => product.id);
            assignments.push(
                ...(await this.connection
                    .getRepository(ctx, Product)
                    .createQueryBuilder('product')
                    .leftJoinAndSelect('product.channels', 'channel')
                    .where('product.id IN (:...ids)', { ids })
                    .getMany()),
            );
        }
        const byId = new Map(assignments.map(product => [String(product.id), product.channels]));
        const toChannel = (channel: Channel) => ({
            id: channel.id,
            code: channel.code,
            isDefault: channel.code === DEFAULT_CHANNEL_CODE,
        });
        const items = products.map(product => ({
            id: product.id,
            name: product.name,
            enabled: product.enabled,
            channels: (byId.get(String(product.id)) ?? [])
                .filter(channel => allowedIds.has(String(channel.id)))
                .map(toChannel),
        }));
        const isUnassigned = (item: (typeof items)[number]) =>
            item.channels.length <= 1 && item.channels.some(channel => channel.isDefault);
        const channelCounts = channels.map(channel => ({
            channelId: channel.id,
            count: items.filter(item => item.channels.some(itemChannel => itemChannel.id === channel.id))
                .length,
        }));
        const mode = assignmentFilter.mode ?? 'ALL';
        const filteredItems = items.filter(item => {
            if (mode === 'UNASSIGNED') return isUnassigned(item);
            if (mode === 'MULTI') return item.channels.length > 1;
            if (mode === 'CHANNEL') {
                return item.channels.some(
                    channel => String(channel.id) === String(assignmentFilter.channelId),
                );
            }
            return true;
        });

        return {
            totalItems: filteredItems.length,
            channels: channels.map(toChannel),
            scopeChannel: toChannel(ctx.channel),
            summary: {
                totalItems: catalogTotalItems,
                unassignedItems: items.filter(isUnassigned).length,
                multiChannelItems: items.filter(item => item.channels.length > 1).length,
                channelCounts,
            },
            items: filteredItems.slice(skip, skip + take),
        };
    }
}

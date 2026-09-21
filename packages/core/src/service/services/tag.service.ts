import { Injectable } from '@nestjs/common';
import {
    CreateTagInput,
    DeletionResponse,
    DeletionResult,
    UpdateTagInput,
} from '@vendure/common/lib/generated-types';
import { ID, PaginatedList, Type } from '@vendure/common/lib/shared-types';
import { unique } from '@vendure/common/lib/unique';

import { RequestContext } from '../../api/common/request-context';
import { UserInputError } from '../../common';
import { Instrument } from '../../common/instrument-decorator';
import { ListQueryOptions, Taggable } from '../../common/types/common-types';
import { TransactionalConnection } from '../../connection/transactional-connection';
import { Asset } from '../../entity/asset/asset.entity';
import { VendureEntity } from '../../entity/base/base.entity';
import { Tag } from '../../entity/tag/tag.entity';
import { ListQueryBuilder } from '../helpers/list-query-builder/list-query-builder';

/**
 * @description
 * Contains methods relating to {@link Tag} entities.
 *
 * @docsCategory services
 */
@Injectable()
@Instrument()
export class TagService {
    constructor(
        private connection: TransactionalConnection,
        private listQueryBuilder: ListQueryBuilder,
    ) {}

    findAll(ctx: RequestContext, options?: ListQueryOptions<Tag>): Promise<PaginatedList<Tag>> {
        const qb = this.listQueryBuilder.build(Tag, options, { ctx, entityAlias: 'tag' });
        return this.scopeToChannel(qb, ctx)
            .getManyAndCount()
            .then(([items, totalItems]) => ({
                items,
                totalItems,
            }));
    }

    findOne(ctx: RequestContext, tagId: ID): Promise<Tag | undefined> {
        const scope = this.channelScopeSubquery(ctx);
        return this.connection
            .getRepository(ctx, Tag)
            .createQueryBuilder('tag')
            .where('tag.id = :tagId', { tagId })
            .andWhere(scope.sql, scope.parameters)
            .getOne()
            .then(result => result ?? undefined);
    }

    create(ctx: RequestContext, input: CreateTagInput) {
        return this.tagValueToTag(ctx, input.value);
    }

    async update(ctx: RequestContext, input: UpdateTagInput) {
        const tag = await this.getScopedTagOrThrow(ctx, input.id);
        await this.assertNotSharedAcrossChannels(ctx, tag.id);
        if (input.value) {
            tag.value = input.value;
            await this.connection.getRepository(ctx, Tag).save(tag);
        }
        return tag;
    }

    async delete(ctx: RequestContext, id: ID): Promise<DeletionResponse> {
        const tag = await this.getScopedTagOrThrow(ctx, id);
        await this.assertNotSharedAcrossChannels(ctx, tag.id);
        await this.connection.getRepository(ctx, Tag).remove(tag);
        return {
            result: DeletionResult.DELETED,
        };
    }

    async valuesToTags(ctx: RequestContext, values: string[]): Promise<Tag[]> {
        const tags: Tag[] = [];
        for (const value of unique(values)) {
            tags.push(await this.tagValueToTag(ctx, value));
        }
        return tags;
    }

    getTagsForEntity(ctx: RequestContext, entity: Type<VendureEntity & Taggable>, id: ID): Promise<Tag[]> {
        return this.connection
            .getRepository(ctx, entity)
            .createQueryBuilder()
            .relation(entity, 'tags')
            .of(id)
            .loadMany();
    }

    private async tagValueToTag(ctx: RequestContext, value: string): Promise<Tag> {
        const scope = this.channelScopeSubquery(ctx);
        const existing = await this.connection
            .getRepository(ctx, Tag)
            .createQueryBuilder('tag')
            .where('tag.value = :value', { value })
            .andWhere(scope.sql, scope.parameters)
            .getOne();
        if (existing) {
            return existing;
        }
        return await this.connection.getRepository(ctx, Tag).save(new Tag({ value }));
    }

    private scopeToChannel<T extends { andWhere: (...args: any[]) => T }>(
        queryBuilder: T,
        ctx: RequestContext,
    ) {
        const scope = this.channelScopeSubquery(ctx);
        return queryBuilder.andWhere(scope.sql, scope.parameters);
    }

    private channelScopeSubquery(ctx: RequestContext) {
        const currentChannelSubquery = this.connection
            .getRepository(ctx, Asset)
            .createQueryBuilder('tagAsset')
            .select('tagRelation.id')
            .innerJoin('tagAsset.tags', 'tagRelation')
            .innerJoin('tagAsset.channels', 'tagChannel')
            .where('tagChannel.id = :tagChannelId')
            .getQuery();
        const anyAssetSubquery = this.connection
            .getRepository(ctx, Asset)
            .createQueryBuilder('linkedAsset')
            .select('1')
            .innerJoin('linkedAsset.tags', 'linkedTag')
            .where('linkedTag.id = tag.id')
            .getQuery();
        return {
            sql: `(tag.id IN (${currentChannelSubquery}) OR NOT EXISTS (${anyAssetSubquery}))`,
            parameters: { tagChannelId: ctx.channelId },
        };
    }

    private async getScopedTagOrThrow(ctx: RequestContext, id: ID): Promise<Tag> {
        const tag = await this.findOne(ctx, id);
        if (!tag) throw new UserInputError('标签不属于当前店铺');
        return tag;
    }

    private async assertNotSharedAcrossChannels(ctx: RequestContext, id: ID): Promise<void> {
        const rows = await this.connection
            .getRepository(ctx, Asset)
            .createQueryBuilder('asset')
            .select('channel.id', 'channelId')
            .innerJoin('asset.tags', 'tag', 'tag.id = :tagId', { tagId: id })
            .innerJoin('asset.channels', 'channel')
            .distinct(true)
            .getRawMany<{ channelId: ID }>();
        if (new Set(rows.map(row => String(row.channelId))).size > 1) {
            throw new UserInputError('检测到历史跨店共享标签，请先运行店铺隔离修复');
        }
    }
}

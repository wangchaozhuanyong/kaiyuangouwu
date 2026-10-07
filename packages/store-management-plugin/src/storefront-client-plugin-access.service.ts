import { Injectable } from '@nestjs/common';
import { RequestContext, RequestContextService, UserInputError } from '@vendure/core';
import { StorefrontContentService } from '@vendure/storefront-content-plugin';

/** Admission reads committed published content, independent of public DTO and transaction caches. */
@Injectable()
export class StorefrontClientPluginAccessService {
    constructor(
        private readonly contexts: RequestContextService,
        private readonly content: StorefrontContentService,
    ) {}

    async isEnabled(ctx: RequestContext, pluginCode: string): Promise<boolean> {
        if (ctx.apiType !== 'shop') return true;
        try {
            // Do not inherit an older repeatable-read transaction snapshot.
            const fresh = await this.contexts.create({
                apiType: 'shop',
                channelOrToken: ctx.channel,
                languageCode: ctx.languageCode,
                currencyCode: ctx.currencyCode,
            });
            fresh.setReplicationMode('master');
            const blocks = await this.content.findPublished(fresh);
            return blocks.some(
                block =>
                    block.type === 'CLIENT_PLUGINS' &&
                    block.items.some(item => item.enabled && item.settings?.pluginCode === pluginCode),
            );
        } catch {
            throw new UserInputError('店铺插件配置读取失败，请重试');
        }
    }

    async assertEnabled(ctx: RequestContext, pluginCode: string): Promise<void> {
        if (!(await this.isEnabled(ctx, pluginCode))) {
            throw new UserInputError('当前店铺尚未开启此客户端插件');
        }
    }
}

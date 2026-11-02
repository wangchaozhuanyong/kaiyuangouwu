import { Args, Mutation, Query, Resolver } from '@nestjs/graphql';
import { Allow, Ctx, Permission, PermissionDefinition, RequestContext } from '@vendure/core';
import { EditorialProviderService } from '@vendure/image-generation-plugin';
import { BlogDraft, BlogListInput } from '@vendure/storefront-content-plugin';

import { BlogRunInput, BlogService } from './blog.service';
export const manageNewsBlog = new PermissionDefinition({
    name: 'ManageNewsBlog',
    description: '管理当前店铺的新闻博客草稿、来源和采集任务',
});
export const publishNewsBlog = new PermissionDefinition({
    name: 'PublishNewsBlog',
    description: '审核、发布及撤回当前店铺的新闻博客文章',
});
export { adminSchema, shopSchema } from './schema';
@Resolver()
export class BlogAdminResolver {
    constructor(
        private readonly blog: BlogService,
        private readonly provider: EditorialProviderService,
    ) {}
    @Query() @Allow(manageNewsBlog.Permission) newsBlogSettings(@Ctx() ctx: RequestContext) {
        return this.blog.settingsView(ctx);
    }
    @Query() @Allow(manageNewsBlog.Permission) newsBlogSources(@Ctx() ctx: RequestContext) {
        return this.blog.sources(ctx);
    }
    @Query() @Allow(manageNewsBlog.Permission) newsBlogSourceItems(@Ctx() ctx: RequestContext) {
        return this.blog.sourceItems(ctx);
    }
    @Query() @Allow(manageNewsBlog.Permission) newsBlogArticleList(
        @Ctx() ctx: RequestContext,
        @Args() args: { input?: { term?: string; state?: string; skip?: number; take?: number } },
    ) {
        return this.blog.articleList(ctx, args.input);
    }
    @Query() @Allow(manageNewsBlog.Permission) newsBlogArticles(
        @Ctx() ctx: RequestContext,
        @Args() args: { state?: string },
    ) {
        return this.blog.articles(ctx, args.state);
    }
    @Query() @Allow(manageNewsBlog.Permission) async newsBlogArticle(
        @Ctx() ctx: RequestContext,
        @Args() args: { id: string },
    ) {
        return this.blog.view(await this.blog.get(ctx, args.id));
    }
    @Query() @Allow(manageNewsBlog.Permission) newsBlogHistory(
        @Ctx() ctx: RequestContext,
        @Args() args: { id: string },
    ) {
        return this.blog.history(ctx, args.id);
    }
    @Query() @Allow(manageNewsBlog.Permission) newsBlogRuns(@Ctx() ctx: RequestContext) {
        return this.blog.runs(ctx);
    }
    @Query() @Allow(Permission.SuperAdmin) newsBlogProviderOptions(@Ctx() ctx: RequestContext) {
        return this.provider.options(ctx);
    }
    @Mutation() @Allow(Permission.SuperAdmin) reconcileNewsBlogRun(
        @Ctx() ctx: RequestContext,
        @Args() args: { id: string; actualCostMicros: number },
    ) {
        return this.blog.reconcile(ctx, args.id, args.actualCostMicros);
    }
    @Mutation() @Allow(manageNewsBlog.Permission) retryNewsBlogTask(
        @Ctx() ctx: RequestContext,
        @Args() args: { id: string; requestKey: string },
    ) {
        return this.blog.retry(ctx, args.id, args.requestKey);
    }
    @Mutation() @Allow(Permission.SuperAdmin) saveNewsBlogSettings(
        @Ctx() ctx: RequestContext,
        @Args() args: { settings: Record<string, unknown>; expectedVersion: number },
    ) {
        return this.blog.saveSettings(ctx, args.settings, args.expectedVersion);
    }
    @Mutation() @Allow(manageNewsBlog.Permission) saveNewsBlogSource(
        @Ctx() ctx: RequestContext,
        @Args() args: { code: string; enabled: boolean; expectedVersion: number },
    ) {
        return this.blog.saveSource(ctx, args.code, args.enabled, args.expectedVersion);
    }
    @Mutation() @Allow(manageNewsBlog.Permission) saveNewsBlogArticle(
        @Ctx() ctx: RequestContext,
        @Args() args: { input: { id?: string; slug: string; expectedVersion: number; draft: BlogDraft } },
    ) {
        return this.blog.save(ctx, args.input);
    }
    @Mutation() @Allow(manageNewsBlog.Permission) requestNewsBlogTask(
        @Ctx() ctx: RequestContext,
        @Args() args: { input: BlogRunInput & { kind: string; requestKey: string } },
    ) {
        return this.blog.request(ctx, args.input.kind, args.input.requestKey, args.input);
    }
    @Mutation() @Allow(publishNewsBlog.Permission) publishNewsBlogArticle(
        @Ctx() ctx: RequestContext,
        @Args() args: { id: string; expectedVersion: number; acceptIssues: boolean },
    ) {
        return this.blog.publish(ctx, args.id, args.expectedVersion, false, args.acceptIssues);
    }
    @Mutation() @Allow(publishNewsBlog.Permission) withdrawNewsBlogArticle(
        @Ctx() ctx: RequestContext,
        @Args() args: { id: string; expectedVersion: number },
    ) {
        return this.blog.publish(ctx, args.id, args.expectedVersion, true);
    }
}
@Resolver()
export class BlogShopResolver {
    constructor(private readonly blog: BlogService) {}
    @Query() @Allow(Permission.Public) newsBlogArticles(
        @Ctx() ctx: RequestContext,
        @Args() args: { input?: BlogListInput },
    ) {
        return this.blog.read(ctx, args.input ?? {});
    }
    @Query() @Allow(Permission.Public) async newsBlogArticle(
        @Ctx() ctx: RequestContext,
        @Args() args: { slug: string },
    ) {
        return (await this.blog.read(ctx, {}, args.slug)).article;
    }
}

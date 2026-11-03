import { PluginCommonModule, VendurePlugin } from '@vendure/core';
import { ImageGenerationPlugin } from '@vendure/image-generation-plugin';
import { StoreManagementPlugin } from '@vendure/store-management-plugin';
import { BLOG_READER, StorefrontContentPlugin } from '@vendure/storefront-content-plugin';

import {
    adminSchema,
    BlogAdminResolver,
    BlogShopResolver,
    manageNewsBlog,
    publishNewsBlog,
    shopSchema,
} from './api';
import { BlogService } from './blog.service';
import { blogEntities } from './entities';
import { BlogMediaService } from './media';
import { BlogQueueService, collectNewsBlogTask } from './queue.service';
import { BlogSkillEditorialService } from './skill-editorial.service';
import { BlogSkillsCatalog } from './skills-catalog';
import { BlogSkillsHttp } from './skills-http';
import { BlogSkillsService } from './skills.service';
import { BlogSourceHttp } from './source-http';
@VendurePlugin({
    imports: [PluginCommonModule, ImageGenerationPlugin, StoreManagementPlugin, StorefrontContentPlugin],
    entities: blogEntities,
    providers: [
        BlogService,
        BlogSkillsService,
        BlogSkillEditorialService,
        BlogSkillsCatalog,
        BlogSkillsHttp,
        BlogQueueService,
        BlogMediaService,
        BlogSourceHttp,
        { provide: BLOG_READER, useExisting: BlogService },
    ],
    exports: [BlogService, BlogSkillEditorialService, BLOG_READER],
    configuration: config => {
        config.authOptions.customPermissions.push(manageNewsBlog, publishNewsBlog);
        config.schedulerOptions.tasks.push(collectNewsBlogTask);
        return config;
    },
    adminApiExtensions: { schema: adminSchema, resolvers: [BlogAdminResolver] },
    shopApiExtensions: { schema: shopSchema, resolvers: [BlogShopResolver] },
    compatibility: '^3.0.0',
})
export class NewsBlogPlugin {}
